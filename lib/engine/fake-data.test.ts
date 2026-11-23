// 가짜 데이터 검증 (PLAN.md 작업 7, DESIGN.md 9번 "엔진 단위")
// 밖에 나가 뛰지 않고도 엔진이 맞게 판단하는지 확인한다.
// 격차가 이렇게 변하면 역전 사건이 몇 번, 어떤 종류로 나와야 하는지를 숫자로 정해 두고 엔진에 넣어 본다.
//
// 격차의 +는 내가 앞섬, −는 내가 뒤처짐이다. 격차가 10m 이상 벌어져야 앞선 쪽이 바뀐 것으로 본다.
// 레이스 시작 후 처음 앞서는 것은 역전으로 세지 않는다.
import { describe, expect, it } from "vitest";
import { distanceAtTime, type RunRecord } from "../record";
import { createGapEngine, type LeadEvent } from "./gap";

/** 5km를 25분(1500초)에 일정하게 달린 상대 (초당 3.333m) */
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

/** 가짜 데이터를 넣은 결과 */
type Outcome = {
  events: LeadEvent[];
  /** 각 시점에 엔진이 잰 격차. 넣은 가짜 격차와 같아야 한다 */
  measuredGaps: number[];
  /** 마지막에 앞서 있다고 확정된 쪽 */
  leader: "me" | "opponent" | null;
};

/**
 * 격차 목록을 1초 간격으로 엔진에 넣는다.
 * 상대의 그 시점 거리에 격차를 더한 값을 "나의 누적 거리"로 만들어 넣기 때문에, 엔진이 재는 격차가 넣은 값과 같아진다.
 */
function feed(gaps: number[], startSec = 100): Outcome {
  const engine = createGapEngine({ opponent: OPPONENT, raceDistanceM: 5000 });
  const events: LeadEvent[] = [];
  const measuredGaps: number[] = [];
  gaps.forEach((gap, i) => {
    const t = startSec + i;
    const { snapshot, event } = engine.update(t, distanceAtTime(OPPONENT, t) + gap);
    measuredGaps.push(snapshot.gapM);
    if (event) events.push(event);
  });
  return { events, measuredGaps, leader: engine.leader };
}

describe("가짜 격차로 역전 사건 검증 (PLAN 작업 7)", () => {
  it("+5, +8, +12, +3, −6, −12로 변하면 역전은 한 번만 나온다 (마지막에 상대가 앞서는 추월당함)", () => {
    const { events, measuredGaps, leader } = feed([5, 8, 12, 3, -6, -12]);
    expect(measuredGaps.map((g) => Math.round(g))).toEqual([5, 8, 12, 3, -6, -12]); // 넣은 값이 그대로 재졌는지
    // +12에서 처음 내가 앞선 것은 역전이 아니고, +3과 −6은 기준(10m) 안쪽이라 앞선 쪽이 그대로다.
    // 마지막 −12에서 처음으로 상대가 10m 이상 앞선다.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "overtaken", t: 105 });
    expect(events[0].gapM).toBeCloseTo(-12, 6);
    expect(leader).toBe("opponent");
  });

  it("방향을 거꾸로 하면(−5, −8, −12, −3, +6, +12) 추월이 한 번만 나온다", () => {
    const { events, leader } = feed([-5, -8, -12, -3, 6, 12]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "overtake", t: 105 });
    expect(leader).toBe("me");
  });

  it("처음부터 상대가 앞서다가 내가 따라잡아 앞서면 추월 한 번이다 (상대가 처음 앞선 것은 세지 않는다)", () => {
    const { events } = feed([-12, -8, 0, 4, 9, 11]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "overtake", t: 105 });
  });

  it("앞선 쪽이 바뀔 때마다 사건이 하나씩 나온다 (+12, −12, +12, −12 → 추월당함, 추월, 추월당함)", () => {
    const { events } = feed([12, -12, 12, -12]);
    expect(events.map((e) => e.type)).toEqual(["overtaken", "overtake", "overtaken"]);
    expect(events.map((e) => e.t)).toEqual([101, 102, 103]);
  });

  it("격차가 ±9m 안쪽에서만 오르내리면 사건이 없고 앞선 쪽도 정해지지 않는다", () => {
    const { events, leader } = feed([9, -9, 9, -9, 5, 0, -5]);
    expect(events).toHaveLength(0);
    expect(leader).toBeNull();
  });

  it("경계값: 정확히 10m는 앞선 것이고, 9.99m는 아니다", () => {
    // +10에서 내가 앞섬(처음이라 사건 없음) → +9.99와 −9.99는 안쪽이라 그대로 → −10에서 바뀜
    const { events } = feed([10, 9.99, -9.99, -10]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "overtaken", t: 103 });
  });

  it("한쪽이 같은 방향으로 계속 벌려 나가면 처음 앞선 것 말고는 사건이 없다", () => {
    expect(feed([12, 20, 40, 80]).events).toHaveLength(0);
    expect(feed([-15, -20, -30, -45]).events).toHaveLength(0);
  });

  it("GPS 오차(±3m)가 섞여도, 천천히 역전하는 동안 사건은 한 번만 나온다", () => {
    // 격차가 +20m에서 −20m까지 1m씩 줄어드는 동안 매초 ±3m의 오차가 번갈아 섞인다
    const gaps = Array.from({ length: 41 }, (_, i) => 20 - i + (i % 2 === 0 ? 3 : -3));
    const { events, leader } = feed(gaps);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("overtaken");
    expect(events[0].gapM).toBeLessThanOrEqual(-10);
    expect(leader).toBe("opponent");
  });

  it("오차가 더 커서 기준 밖(±12m)으로 한 번 튀었다 돌아오면, 돌아온 만큼 사건이 생긴다 (보정이 걸러야 하는 경우)", () => {
    // 이 엔진은 들어온 격차를 그대로 믿는다. 튀는 값을 버리는 일은 GPS 보정(작업 15)의 몫이다.
    const { events } = feed([15, 15, -12, 15, 15]);
    expect(events.map((e) => e.type)).toEqual(["overtaken", "overtake"]);
  });
});
