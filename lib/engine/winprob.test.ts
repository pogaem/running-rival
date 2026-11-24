// 경기 흐름 분석 엔진 ③(lib/engine/winprob.ts) 시험
import { describe, expect, it } from "vitest";
import { distanceBetweenM } from "../geo";
import { makeDemoTrack } from "../input/synthetic-track";
import { distanceAtTime, type RunRecord } from "../record";
import { virtualRunners } from "../runners";
import { createPredictor, type RecentPace } from "./catchup";
import type { RaceSetup } from "./gap";
import {
  ADVANTAGE_MIN,
  createWinStageTracker,
  createWinTracker,
  DISADVANTAGE_MAX,
  displayPercent,
  estimateWinProbability,
  normalCdf,
  stageOf,
  STAGE_HYSTERESIS,
  WIN_CORRECTION_K,
  WIN_MIN_SIGMA_SEC,
  WIN_STAGE_LABEL,
} from "./winprob";

/** 5km를 25분(1500초)에 일정하게 달린 상대 (초당 3.333m) */
const STEADY: RunRecord = {
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
const SETUP: RaceSetup = { opponent: STEADY, raceDistanceM: 5000 };

/** 시험용 최근 페이스 */
const pace = (speedMps: number, variation: number): RecentPace => ({
  speedMps,
  paceSecPerKm: speedMps > 0 ? 1000 / speedMps : Infinity,
  variation,
  segmentSpeedsMps: [],
});

describe("normalCdf (표준정규 누적확률)", () => {
  it("잘 알려진 값과 맞는다", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.8413447, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.1586553, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 6);
    expect(normalCdf(-3)).toBeCloseTo(0.0013499, 6);
  });

  it("끝으로 갈수록 0과 1에 가까워지고, 값이 커질수록 확률도 커진다", () => {
    expect(normalCdf(8)).toBeCloseTo(1, 9);
    expect(normalCdf(-8)).toBeCloseTo(0, 9);
    expect(normalCdf(0.5)).toBeGreaterThan(normalCdf(0.2));
  });
});

describe("설정값", () => {
  it("초안 값이다 (PRD: k는 1 이상)", () => {
    expect(WIN_CORRECTION_K).toBeGreaterThanOrEqual(1);
    expect(WIN_MIN_SIGMA_SEC).toBeGreaterThan(0);
    expect(ADVANTAGE_MIN).toBeGreaterThan(DISADVANTAGE_MAX);
  });
});

describe("estimateWinProbability (예상 승률)", () => {
  // 160초에 상대는 533.3m. 나는 528.3m 지점에서 최근 3.5m/s로 달리는 중
  const T = 160;
  const MINE = 528.3333;

  it("최근 60초 페이스가 아직 없으면 null이다", () => {
    expect(estimateWinProbability(SETUP, 30, 100, null)).toBeNull();
  });

  it("식 Φ((T상대 − T̂나) ÷ (k·σ))대로 계산한다", () => {
    const estimate = estimateWinProbability(SETUP, T, MINE, pace(3.5, 0.3))!;
    // 상대는 1340초 남음, 나는 (5000−528.33)÷3.5 = 1277.6초 남음 → 내가 62.4초 먼저 도착
    expect(estimate.opponentRemainingSec).toBeCloseTo(1340, 3);
    expect(estimate.myRemainingSec).toBeCloseTo(1277.62, 1);
    // σ = 0.3 × √(10 × 1277.6) ≈ 33.9초, k·σ ≈ 50.9초, z ≈ 1.23 → Φ(z) ≈ 0.89
    expect(estimate.sigmaSec).toBeCloseTo(33.91, 1);
    expect(estimate.probability).toBeCloseTo(0.89, 2);
  });

  it("내가 더 늦게 도착할 것 같으면 50% 아래, 같은 시각이면 50%이다", () => {
    expect(estimateWinProbability(SETUP, T, MINE, pace(3.0, 0.1))!.probability).toBeLessThan(0.1);
    const same = (5000 - distanceAtTime(STEADY, T)) / 1340; // 남은 시간이 정확히 같아지는 속도
    expect(estimateWinProbability(SETUP, T, distanceAtTime(STEADY, T), pace(same, 0.2))!.probability).toBeCloseTo(
      0.5,
      3,
    );
  });

  it("페이스가 들쭉날쭉할수록 같은 유리함도 덜 확신한다", () => {
    const steady = estimateWinProbability(SETUP, T, MINE, pace(3.5, 0.05))!.probability;
    const medium = estimateWinProbability(SETUP, T, MINE, pace(3.5, 0.3))!.probability;
    const shaky = estimateWinProbability(SETUP, T, MINE, pace(3.5, 0.4))!.probability;
    expect(steady).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(shaky);
    expect(shaky).toBeGreaterThan(0.5);
  });

  it("보정 계수 k가 클수록 50%에 가까워진다", () => {
    const k1 = estimateWinProbability(SETUP, T, MINE, pace(3.5, 0.3), { k: 1 })!.probability;
    const k15 = estimateWinProbability(SETUP, T, MINE, pace(3.5, 0.3), { k: 1.5 })!.probability;
    const k3 = estimateWinProbability(SETUP, T, MINE, pace(3.5, 0.3), { k: 3 })!.probability;
    expect(k1).toBeGreaterThan(k15);
    expect(k15).toBeGreaterThan(k3);
    expect(() => estimateWinProbability(SETUP, T, MINE, pace(3.5, 0.3), { k: 0.9 })).toThrow("1 이상");
  });

  it("페이스가 완전히 일정해도 σ에 바닥값을 둬서 0%·100%로 딱 잘리지 않는다", () => {
    const estimate = estimateWinProbability(SETUP, T, MINE, pace(3.5, 0))!;
    expect(estimate.sigmaSec).toBe(WIN_MIN_SIGMA_SEC);
    expect(estimate.probability).toBeLessThanOrEqual(1);
    expect(Number.isFinite(estimate.probability)).toBe(true);
  });

  it("이미 결승선에 닿았으면: 상대가 아직 달리는 중이면 100%, 상대가 먼저 닿았으면 0%", () => {
    expect(estimateWinProbability(SETUP, 1400, 5000, pace(3.5, 0.1))!.probability).toBe(1);
    expect(estimateWinProbability(SETUP, 1600, 5000, pace(3.5, 0.1))!.probability).toBe(0);
  });

  it("상대가 먼저 도착했는데 나는 아직 달리는 중이면 0%이다 (거의 다 왔어도)", () => {
    expect(estimateWinProbability(SETUP, 1600, 4900, pace(3.3, 0.1))!.probability).toBe(0);
    expect(estimateWinProbability(SETUP, 1600, 4999.5, pace(3.3, 0.1))!.probability).toBe(0);
  });

  it("거리 계산 오차로 4999.9999999m로 나와도 도착한 것으로 본다", () => {
    expect(estimateWinProbability(SETUP, 1400, 4999.9999999, pace(3.5, 0.1))!.probability).toBe(1);
    expect(estimateWinProbability(SETUP, 1600, 4999.9999999, pace(3.5, 0.1))!.probability).toBe(0);
  });

  it("멈춰 있으면 0%이다", () => {
    const estimate = estimateWinProbability(SETUP, T, MINE, pace(0, Infinity))!;
    expect(estimate.probability).toBe(0);
  });
});

describe("stageOf · displayPercent (3단계와 화면 퍼센트)", () => {
  it("70% 이상은 우세, 30% 이하는 열세, 그 사이는 접전이다", () => {
    expect(stageOf(0.7)).toBe("advantage");
    expect(stageOf(0.69)).toBe("close");
    expect(stageOf(0.31)).toBe("close");
    expect(stageOf(0.3)).toBe("disadvantage");
    expect(stageOf(1)).toBe("advantage");
    expect(stageOf(0)).toBe("disadvantage");
  });

  it("한국어 이름은 우세·접전·열세이다", () => {
    expect(WIN_STAGE_LABEL).toEqual({ advantage: "우세", close: "접전", disadvantage: "열세" });
  });

  it("화면 퍼센트는 추정치라서 1~99로 자른다", () => {
    expect(displayPercent(0)).toBe(1);
    expect(displayPercent(1)).toBe(99);
    expect(displayPercent(0.5)).toBe(50);
    expect(displayPercent(0.894)).toBe(89);
  });
});

describe("createWinStageTracker (단계 변화)", () => {
  it("처음 단계가 정해질 때는 사건이 없다", () => {
    const tracker = createWinStageTracker();
    expect(tracker.stage).toBeNull();
    expect(tracker.update(60, 0.5)).toEqual({ stage: "close", change: null });
  });

  it("기준을 넘으면 접전에서 우세로 바뀐다", () => {
    const tracker = createWinStageTracker();
    tracker.update(60, 0.5);
    expect(tracker.update(70, 0.69).change).toBeNull();
    expect(tracker.update(80, 0.72).change).toEqual({ t: 80, from: "close", to: "advantage", probability: 0.72 });
  });

  it("우세에서는 기준보다 여유 폭만큼 더 내려가야 바뀐다 (기준 근처에서 자꾸 바뀌지 않는다)", () => {
    const tracker = createWinStageTracker();
    tracker.update(60, 0.8);
    const justBelow = ADVANTAGE_MIN - STAGE_HYSTERESIS / 2; // 67.5%
    expect(tracker.update(70, justBelow).change).toBeNull();
    expect(tracker.stage).toBe("advantage");
    expect(tracker.update(80, ADVANTAGE_MIN - STAGE_HYSTERESIS - 0.01)?.change?.to).toBe("close");
  });

  it("열세에서도 마찬가지로 여유 폭이 있다", () => {
    const tracker = createWinStageTracker();
    tracker.update(60, 0.1);
    expect(tracker.update(70, DISADVANTAGE_MAX + STAGE_HYSTERESIS / 2).change).toBeNull();
    expect(tracker.update(80, DISADVANTAGE_MAX + STAGE_HYSTERESIS + 0.01).change?.to).toBe("close");
  });

  it("우세에서 열세로, 열세에서 우세로 한 번에 바뀔 수도 있다", () => {
    const tracker = createWinStageTracker();
    tracker.update(60, 0.9);
    expect(tracker.update(70, 0.1).change).toMatchObject({ from: "advantage", to: "disadvantage" });
    expect(tracker.update(80, 0.95).change).toMatchObject({ from: "disadvantage", to: "advantage" });
  });

  it("승률이 기준 근처에서 ±2%p 오르내려도 사건이 남발되지 않는다", () => {
    const tracker = createWinStageTracker();
    tracker.update(60, 0.72);
    let changes = 0;
    for (let t = 61; t < 300; t++) {
      if (tracker.update(t, t % 2 === 0 ? 0.69 : 0.72).change) changes += 1;
    }
    expect(changes).toBe(0);
  });

  it("여유 폭이 음수면 오류를 던진다", () => {
    expect(() => createWinStageTracker(-0.1)).toThrow("0 이상");
  });
});

describe("createWinTracker (승률 계산 + 단계 변화)", () => {
  it("최근 페이스가 없으면 승률도 단계도 없다", () => {
    const tracker = createWinTracker(SETUP);
    expect(tracker.update(30, 100, null)).toEqual({ estimate: null, stage: null, change: null });
  });

  it("페이스가 생기면 승률과 단계를 돌려준다", () => {
    const tracker = createWinTracker(SETUP);
    const result = tracker.update(160, 528.3333, pace(3.5, 0.05));
    expect(result.estimate!.probability).toBeGreaterThan(0.7);
    expect(result.stage).toBe("advantage");
    expect(result.change).toBeNull();
  });

  it("상대 기록이 대결 거리보다 짧으면 오류를 던진다", () => {
    const short: RunRecord = { ...STEADY, completedDistanceM: 3000, points: [{ t: 0, d: 0 }, { t: 900, d: 3000 }] };
    expect(() => createWinTracker({ opponent: short, raceDistanceM: 5000 })).toThrow("대결 거리보다 짧다");
  });
});

describe("데모 경로의 레이스에서 예상 승률 (예측 엔진과 함께)", () => {
  /** 데모 경로를 1초씩 넣어 시점별 승률 결과를 모은다 */
  function raceAgainst(rivalId: string) {
    const rival = virtualRunners.find((r) => r.id === rivalId)!;
    const setup: RaceSetup = { opponent: rival, raceDistanceM: 5000 };
    const predictor = createPredictor(setup);
    const winTracker = createWinTracker(setup);
    const track = makeDemoTrack();
    const results = new Map<number, ReturnType<typeof winTracker.update>>();
    const changes: unknown[] = [];
    let traveled = 0;
    for (let i = 0; i < track.length; i++) {
      if (i > 0) traveled += distanceBetweenM(track[i - 1], track[i]);
      const { recentPace } = predictor.update(track[i].t, traveled);
      const result = winTracker.update(track[i].t, traveled, recentPace);
      results.set(track[i].t, result);
      if (result.change) changes.push(result.change);
    }
    return { results, changes };
  }

  it("나(5:20/km)보다 빠른 가상러너-01(5:00/km)과 붙으면 60초부터 끝까지 열세이고 승률이 낮다", () => {
    const { results, changes } = raceAgainst("가상러너-01");
    expect(results.get(59)!.estimate).toBeNull();
    expect(results.get(60)!.stage).toBe("disadvantage");
    expect(results.get(800)!.estimate!.probability).toBeLessThan(0.05);
    expect(results.get(1600)!.stage).toBe("disadvantage");
    expect(changes).toHaveLength(0);
  });

  it("나보다 느린 가상러너-09(7:00/km)와 붙으면 60초부터 끝까지 우세하다", () => {
    const { results } = raceAgainst("가상러너-09");
    expect(results.get(60)!.stage).toBe("advantage");
    expect(results.get(800)!.estimate!.probability).toBeGreaterThan(0.95);
    expect(results.get(1600)!.estimate!.probability).toBe(1); // 내가 먼저 도착
  });
});

describe("createWinStageTracker 유지 시간", () => {
  it("다른 단계가 잠깐 나왔다 돌아오면 바뀐 것으로 알리지 않는다", () => {
    const tracker = createWinStageTracker(0.05, 10);
    tracker.update(0, 0.5);
    for (let t = 1; t <= 30; t++) {
      expect(tracker.update(t, t % 2 === 0 ? 0.1 : 0.5).change).toBeNull();
    }
  });

  it("새 단계가 유지 시간 동안 이어지면 그때 한 번 알린다", () => {
    const tracker = createWinStageTracker(0.05, 10);
    tracker.update(0, 0.5);
    const changes = [];
    for (let t = 1; t <= 20; t++) {
      const { change } = tracker.update(t, 0.1);
      if (change) changes.push(change);
    }
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ from: "close", to: "disadvantage", t: 11 });
  });
});
