// 경기 흐름 분석 엔진 묶음(lib/engine/race-engine.ts) 시험
import { describe, expect, it } from "vitest";
import { distanceBetweenM } from "../geo";
import { makeDemoTrack } from "../input/synthetic-track";
import { distanceAtTime, type RunRecord } from "../record";
import { virtualRunners } from "../runners";
import { CLOSE_ENTER_M, CLOSE_LEAVE_M, createRaceEngine, type RaceEvent, type RaceTick } from "./race-engine";
import type { RaceSetup } from "./gap";

/** 데모 경로를 1초씩 엔진에 넣어, 끝날 때까지(또는 결승선 통과까지)의 결과를 모은다 */
function runDemo(rivalId: string, raceDistanceM = 5000) {
  const rival = virtualRunners.find((r) => r.id === rivalId)!;
  const engine = createRaceEngine({ opponent: rival, raceDistanceM });
  const track = makeDemoTrack();
  const ticks: RaceTick[] = [];
  let traveled = 0;
  for (let i = 0; i < track.length; i++) {
    if (i > 0) traveled += distanceBetweenM(track[i - 1], track[i]);
    const tick = engine.update(track[i].t, traveled);
    ticks.push(tick);
    if (tick.finished) break;
  }
  const events = ticks.flatMap((tick) => tick.events);
  return { engine, ticks, events };
}

const typesOf = (events: RaceEvent[], wanted: RaceEvent["type"][]) =>
  events.filter((e) => wanted.includes(e.type)).map((e) => e.type);

describe("데모 경로 vs 가상러너-03 (발표 시연 흐름)", () => {
  const { ticks, events } = runDemo("가상러너-03");

  it("사건이 이 순서로 나온다: 벌어짐 → 접전 → 추월 → 벌어짐 → 마지막 200m → 결승", () => {
    expect(typesOf(events, ["closeLeave", "closeEnter", "overtake", "overtaken", "last200m", "finish"])).toEqual([
      "closeLeave",
      "closeEnter",
      "overtake",
      "closeLeave",
      "last200m",
      "finish",
    ]);
  });

  it("사건의 시각이 순서대로 늘어난다", () => {
    const times = events.map((e) => e.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("1km 통과는 1~4km만 나온다 (5km는 결승으로 대신한다)", () => {
    const kms = events.filter((e): e is Extract<RaceEvent, { type: "km" }> => e.type === "km").map((e) => e.km);
    expect(kms).toEqual([1, 2, 3, 4]);
  });

  it("결승에서 내가 이긴 것으로 나오고, 그 틱이 마지막이다", () => {
    const finish = events.find((e) => e.type === "finish");
    expect(finish).toMatchObject({ type: "finish", won: true });
    expect(ticks[ticks.length - 1].finished).toBe(true);
    expect(ticks.filter((tick) => tick.finished)).toHaveLength(1);
  });

  it("추월은 10배속으로 3분 안에 일어나고, 접전이 추월보다 먼저 나온다", () => {
    const enter = events.find((e) => e.type === "closeEnter")!;
    const overtake = events.find((e) => e.type === "overtake")!;
    expect(enter.t).toBeLessThan(overtake.t);
    expect(overtake.t / 10).toBeLessThan(180);
  });

  it("60초 전에는 예측·승률이 없고, 60초부터 나온다", () => {
    expect(ticks[59].prediction).toBeNull();
    expect(ticks[59].estimate).toBeNull();
    expect(ticks[60].estimate).not.toBeNull();
    expect(ticks[60].prediction).not.toBeNull();
  });

  it("승률 단계는 처음 정해질 때 사건이 없고, 끝까지 바뀌지 않는다 (우세)", () => {
    expect(events.some((e) => e.type === "winStage")).toBe(false);
    expect(ticks[ticks.length - 1].stage).toBe("advantage");
  });
});

describe("더 빠른 가상러너-01과의 레이스", () => {
  it("추월은 없고, 결승에서 내가 진 것으로 나온다", () => {
    const { events } = runDemo("가상러너-01");
    expect(events.some((e) => e.type === "overtake")).toBe(false);
    expect(events.find((e) => e.type === "finish")).toMatchObject({ won: false });
  });
});

describe("3km 대결 (5km 기록을 3km에서 자른다)", () => {
  it("1km, 2km 통과 뒤 3km에서 결승으로 끝난다", () => {
    const { events, ticks } = runDemo("가상러너-03", 3000);
    const kms = events.filter((e): e is Extract<RaceEvent, { type: "km" }> => e.type === "km").map((e) => e.km);
    expect(kms).toEqual([1, 2]);
    expect(events[events.length - 1].type).toBe("finish");
    expect(ticks[ticks.length - 1].snapshot.myDistanceM).toBe(3000);
  });
});

describe("결승 뒤", () => {
  it("결승선을 통과한 뒤에는 더 넣어도 이벤트가 없고 결과가 그대로다", () => {
    const { engine, ticks } = runDemo("가상러너-03");
    const last = ticks[ticks.length - 1];
    const after = engine.update(last.t + 1, 5100);
    expect(after.events).toEqual([]);
    expect(after.finished).toBe(true);
    expect(after.snapshot).toEqual(last.snapshot);
  });
});

describe("접전 사건 (가짜 격차)", () => {
  const OPPONENT: RunRecord = {
    id: "시험상대",
    source: "virtual",
    registrationOrder: 1,
    completedDistanceM: 5000,
    totalElevationGainM: null,
    points: [
      { t: 0, d: 0 },
      { t: 1500, d: 5000 },
    ],
  };
  const SETUP: RaceSetup = { opponent: OPPONENT, raceDistanceM: 5000 };

  /** 격차 목록을 1초 간격으로 넣어 접전 사건만 모은다 */
  function closeEvents(gaps: number[]) {
    const engine = createRaceEngine(SETUP);
    const events: RaceEvent[] = [];
    gaps.forEach((gap, i) => {
      const t = 100 + i;
      events.push(...engine.update(t, distanceAtTime(OPPONENT, t) + gap).events);
    });
    return events.filter((e) => e.type === "closeEnter" || e.type === "closeLeave");
  }

  it("기준은 10m 안으로 들어올 때, 15m를 넘어 벌어질 때이다", () => {
    expect(CLOSE_ENTER_M).toBe(10);
    expect(CLOSE_LEAVE_M).toBe(15);
  });

  it("벌어져 있다가 10m 이내로 들어오면 접전 사건, 15m를 넘으면 벗어남 사건이다", () => {
    const events = closeEvents([30, 8, 12, 14, 16, 12, 9]);
    expect(events.map((e) => e.type)).toEqual(["closeEnter", "closeLeave", "closeEnter"]);
    expect(events.map((e) => e.t)).toEqual([101, 104, 106]);
  });

  it("출발 직후처럼 처음부터 가까운 것은 사건이 아니고, 벌어질 때부터 센다", () => {
    const events = closeEvents([0, 5, 9, 20]);
    expect(events.map((e) => e.type)).toEqual(["closeLeave"]);
  });

  it("10~15m 사이를 오르내리는 동안에는 사건이 나지 않는다", () => {
    expect(closeEvents([30, 8, 12, 14, 11, 13, 9, 14])).toHaveLength(1); // 처음 들어온 것 하나만
  });
});

describe("끊기지 않는 중계: 출발·절반·중간 상황", () => {
  it("1km 대결에서도 출발, 절반, 300m마다 중간 상황이 나오고 결승 직전에는 그치며, 앞서든 뒤처지든 나온다", () => {
    for (const rivalId of ["가상러너-01", "가상러너-09"]) {
      const { events } = runDemo(rivalId, 1000);
      expect(events[0].type).toBe("start");
      expect(events.filter((e) => e.type === "half")).toHaveLength(1);
      const statuses = events.filter((e) => e.type === "status");
      expect(statuses.length).toBeGreaterThanOrEqual(1); // 300m (절반 500m·마지막 200m와 겹치는 자리는 건너뜀)
      const finishAt = events.find((e) => e.type === "finish")!.t;
      expect(statuses[statuses.length - 1].t).toBeLessThan(finishAt);
    }
  });

  it("출발과 절반은 한 번씩만 나온다", () => {
    const { events } = runDemo("가상러너-05", 3000);
    expect(events.filter((e) => e.type === "start")).toHaveLength(1);
    expect(events.filter((e) => e.type === "half")).toHaveLength(1);
  });
});
