// 경기 흐름 분석 엔진 ①(lib/engine/gap.ts) 시험
import { describe, expect, it } from "vitest";
import { distanceBetweenM } from "../geo";
import { makeDemoTrack } from "../input/synthetic-track";
import type { RunRecord } from "../record";
import { virtualRunners } from "../runners";
import {
  createGapEngine,
  createLeadTracker,
  LEAD_THRESHOLD_M,
  measureGap,
  type LeadEvent,
  type RaceSetup,
} from "./gap";

/** 시험용 상대: 5km를 25분(1500초)에 일정한 속도로 달린 기록 (초당 3.333m) */
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

const SETUP_5K: RaceSetup = { opponent: OPPONENT, raceDistanceM: 5000 };
const SETUP_3K: RaceSetup = { opponent: OPPONENT, raceDistanceM: 3000 };

describe("measureGap (같은 시점의 격차)", () => {
  it("같은 시점의 상대 거리와 비교한다: 내가 앞서면 +", () => {
    // 300초에 상대는 1000m
    const snapshot = measureGap(SETUP_5K, 300, 1100);
    expect(snapshot.opponentDistanceM).toBeCloseTo(1000, 6);
    expect(snapshot.gapM).toBeCloseTo(100, 6);
  });

  it("내가 뒤처지면 −이고, 같으면 0이다", () => {
    expect(measureGap(SETUP_5K, 300, 900).gapM).toBeCloseTo(-100, 6);
    expect(measureGap(SETUP_5K, 300, 1000).gapM).toBeCloseTo(0, 6);
  });

  it("출발 직후(0초)에는 둘 다 0m라서 격차가 0이다", () => {
    expect(measureGap(SETUP_5K, 0, 0).gapM).toBe(0);
  });

  it("상대 기록은 대결 거리에 닿은 뒤로는 대결 거리에 서 있는 것으로 본다 (5km 기록으로 3km 대결)", () => {
    // 1500초 기준 3000m 도달은 900초. 1200초에 상대 기록은 4000m이지만 3km 대결이라 3000m로 자른다
    const snapshot = measureGap(SETUP_3K, 1200, 2900);
    expect(snapshot.opponentDistanceM).toBe(3000);
    expect(snapshot.gapM).toBeCloseTo(-100, 6);
  });

  it("나도 대결 거리를 넘으면 대결 거리로 잘라서 비교한다", () => {
    const snapshot = measureGap(SETUP_3K, 1200, 3100);
    expect(snapshot.myDistanceM).toBe(3000);
    expect(snapshot.gapM).toBe(0);
  });

  it("음수 거리는 0m로 본다", () => {
    expect(measureGap(SETUP_5K, 10, -5).myDistanceM).toBe(0);
  });
});

describe("createLeadTracker (10m 역전 판정)", () => {
  it("기본 기준은 10m이다", () => {
    expect(LEAD_THRESHOLD_M).toBe(10);
  });

  it("처음 앞서는 것은 역전이 아니다 (사건이 없다)", () => {
    const tracker = createLeadTracker();
    expect(tracker.update(40, -12)).toBeNull();
    expect(tracker.leader).toBe("opponent");
  });

  it("기준 안쪽(10m 미만)의 오르내림은 앞선 쪽을 바꾸지 않는다", () => {
    const tracker = createLeadTracker();
    tracker.update(10, 15); // 내가 앞섬 확정
    for (const gap of [9.9, 5, 0, -5, -9.9]) {
      expect(tracker.update(20, gap)).toBeNull();
    }
    expect(tracker.leader).toBe("me");
  });

  it("정확히 10m는 기준을 채운 것으로 본다", () => {
    const tracker = createLeadTracker();
    tracker.update(10, 10);
    expect(tracker.leader).toBe("me");
    const event = tracker.update(20, -10);
    expect(event).toEqual({ type: "overtaken", t: 20, gapM: -10 });
  });

  it("상대가 앞서다 내가 10m 이상 앞서면 추월(+)이다", () => {
    const tracker = createLeadTracker();
    tracker.update(10, -20);
    expect(tracker.update(500, 4)).toBeNull();
    expect(tracker.update(520, 11)).toEqual({ type: "overtake", t: 520, gapM: 11 });
    expect(tracker.leader).toBe("me");
  });

  it("내가 앞서다 상대가 10m 이상 앞서면 추월당함(−)이다", () => {
    const tracker = createLeadTracker();
    tracker.update(10, 30);
    expect(tracker.update(700, -15)).toEqual({ type: "overtaken", t: 700, gapM: -15 });
  });

  it("GPS 오차처럼 ±9m 사이를 오가도 역전이 남발되지 않는다", () => {
    const tracker = createLeadTracker();
    tracker.update(10, 12);
    let events = 0;
    for (let t = 11; t < 400; t++) {
      if (tracker.update(t, t % 2 === 0 ? 9 : -9)) events += 1;
    }
    expect(events).toBe(0);
  });

  it("앞선 쪽이 같은 쪽으로 계속 벌어지면 사건이 다시 나지 않는다", () => {
    const tracker = createLeadTracker();
    tracker.update(10, 12);
    expect(tracker.update(11, 30)).toBeNull();
    expect(tracker.update(12, 80)).toBeNull();
  });

  it("역전 기준을 바꿀 수 있고, 0 이하는 오류를 던진다", () => {
    const tracker = createLeadTracker(20);
    tracker.update(1, 15);
    expect(tracker.leader).toBeNull();
    expect(() => createLeadTracker(0)).toThrow("0보다 커야");
  });
});

describe("createGapEngine (격차 계산 + 역전 판정)", () => {
  it("격차와 역전 사건을 한 번에 돌려준다", () => {
    const engine = createGapEngine(SETUP_5K);
    // 상대는 300초에 1000m, 600초에 2000m
    expect(engine.update(300, 980).event).toBeNull(); // −20m: 상대가 처음 앞섬
    expect(engine.leader).toBe("opponent");
    const { snapshot, event } = engine.update(600, 2030); // +30m
    expect(snapshot.gapM).toBeCloseTo(30, 6);
    expect(event).toEqual({ type: "overtake", t: 600, gapM: expect.closeTo(30, 6) });
  });

  it("상대 기록이 대결 거리보다 짧으면 오류를 던진다", () => {
    const short: RunRecord = { ...OPPONENT, completedDistanceM: 3000, points: [{ t: 0, d: 0 }, { t: 900, d: 3000 }] };
    expect(() => createGapEngine({ opponent: short, raceDistanceM: 5000 })).toThrow("대결 거리보다 짧다");
  });

  it("대결 거리가 0 이하이면 오류를 던진다", () => {
    expect(() => createGapEngine({ opponent: OPPONENT, raceDistanceM: 0 })).toThrow("0보다 커야");
  });
});

describe("데모 경로와 가상러너-03의 레이스 (발표 시연용 흐름)", () => {
  it("1초마다 거리를 넣으면 역전(추월)이 정확히 한 번 나오고, 10배속으로 3분 안에 일어난다", () => {
    const rival = virtualRunners.find((r) => r.id === "가상러너-03");
    expect(rival).toBeDefined();
    const engine = createGapEngine({ opponent: rival!, raceDistanceM: 5000 });

    // 데모 경로의 점마다 누적 거리를 구해 1초 간격으로 엔진에 넣는다
    const track = makeDemoTrack();
    let traveled = 0;
    const events: LeadEvent[] = [];
    for (let i = 0; i < track.length; i++) {
      if (i > 0) traveled += distanceBetweenM(track[i - 1], track[i]);
      const { event } = engine.update(track[i].t, traveled);
      if (event) events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("overtake");
    expect(events[0].gapM).toBeGreaterThanOrEqual(10);
    expect(events[0].t / 10).toBeLessThan(180);
    expect(engine.leader).toBe("me"); // 결국 내가 앞서 끝난다
  });
});
