// 경기 흐름 분석 엔진 ②(lib/engine/catchup.ts) 시험
import { describe, expect, it } from "vitest";
import { distanceBetweenM } from "../geo";
import { makeDemoTrack } from "../input/synthetic-track";
import { distanceAtTime, type RunRecord } from "../record";
import { virtualRunners } from "../runners";
import { measureGap, type RaceSetup } from "./gap";
import {
  createPaceTracker,
  createPredictor,
  decideSpeak,
  findCatchUp,
  PREDICTION_MAX_ANNOUNCE_SEC,
  PREDICTION_MAX_VARIATION,
  PREDICTION_MIN_RACE_TIME_SEC,
} from "./catchup";

/** 만든 기록: 점들을 주면 같은 모양의 상대 기록을 만든다 */
function makeRecord(points: { t: number; d: number }[]): RunRecord {
  return {
    id: "시험상대",
    source: "virtual",
    registrationOrder: 1,
    completedDistanceM: points[points.length - 1].d,
    totalElevationGainM: null,
    points,
  };
}

/** 5km를 25분(1500초)에 일정하게 달린 상대 (초당 3.333m) */
const STEADY = makeRecord([
  { t: 0, d: 0 },
  { t: 1500, d: 5000 },
]);
const SETUP: RaceSetup = { opponent: STEADY, raceDistanceM: 5000 };

describe("PREDICTION 설정값", () => {
  it("PRD 5번의 값과 같다", () => {
    expect(PREDICTION_MIN_RACE_TIME_SEC).toBe(60);
    expect(PREDICTION_MAX_ANNOUNCE_SEC).toBe(60);
    expect(PREDICTION_MAX_VARIATION).toBe(0.1);
  });
});

describe("createPaceTracker (최근 60초 페이스)", () => {
  /** 매초 speed(t)만큼 달린 것으로 0~endSec초까지 넣는다 */
  function run(tracker: ReturnType<typeof createPaceTracker>, endSec: number, speedAt: (t: number) => number) {
    let d = 0;
    tracker.add(0, 0);
    for (let t = 1; t <= endSec; t++) {
      d += speedAt(t);
      tracker.add(t, d);
    }
  }

  it("60초치 기록이 쌓이기 전에는 null이다", () => {
    const tracker = createPaceTracker();
    run(tracker, 59, () => 3);
    expect(tracker.recent()).toBeNull();
  });

  it("60초가 되면 최근 속도와 페이스를 알려 준다", () => {
    const tracker = createPaceTracker();
    run(tracker, 60, () => 3);
    const pace = tracker.recent()!;
    expect(pace.speedMps).toBeCloseTo(3, 9);
    expect(pace.paceSecPerKm).toBeCloseTo(333.33, 1);
    expect(pace.variation).toBeCloseTo(0, 9);
    expect(pace.segmentSpeedsMps).toHaveLength(6);
  });

  it("최근 60초만 본다 (앞의 60초는 2m/s, 뒤의 60초는 4m/s였다면 4m/s)", () => {
    const tracker = createPaceTracker();
    run(tracker, 120, (t) => (t <= 60 ? 2 : 4));
    expect(tracker.recent()!.speedMps).toBeCloseTo(4, 9);
  });

  it("10초씩 2m/s와 4m/s를 번갈아 달리면 흔들림(변동계수)은 1/3이다", () => {
    const tracker = createPaceTracker();
    run(tracker, 60, (t) => (Math.floor((t - 1) / 10) % 2 === 0 ? 2 : 4));
    const pace = tracker.recent()!;
    expect(pace.speedMps).toBeCloseTo(3, 9);
    expect(pace.variation).toBeCloseTo(1 / 3, 6);
  });

  it("신호가 6초 끊겨 점이 빠져도 직선으로 이어서 계산한다", () => {
    const tracker = createPaceTracker();
    for (let t = 0; t <= 100; t++) {
      if (t > 30 && t < 36) continue; // 31~35초 점 없음
      tracker.add(t, 3 * t);
    }
    const pace = tracker.recent()!;
    expect(pace.speedMps).toBeCloseTo(3, 9);
    expect(pace.variation).toBeCloseTo(0, 9);
  });

  it("누적 거리가 줄어드는 값이 들어와도 줄어들지 않게 다룬다", () => {
    const tracker = createPaceTracker();
    tracker.add(0, 0);
    tracker.add(30, 90);
    tracker.add(31, 50); // 거꾸로 간 값: 90m로 본다
    tracker.add(60, 180);
    const pace = tracker.recent()!;
    expect(pace.speedMps).toBeCloseTo(3, 9);
    expect(pace.segmentSpeedsMps.every((v) => v >= 0)).toBe(true);
  });

  it("시간이 거꾸로 가면 오류를 던진다", () => {
    const tracker = createPaceTracker();
    tracker.add(10, 30);
    expect(() => tracker.add(9, 40)).toThrow("거꾸로");
  });

  it("조각으로 똑같이 나눌 수 없는 길이는 오류를 던진다", () => {
    expect(() => createPaceTracker(60, 25)).toThrow("똑같이 나눌 수");
  });
});

describe("findCatchUp (추월 예상 시점)", () => {
  it("뒤처진 내가 더 빨리 달리면 따라잡는 시점(추월)을 구한다", () => {
    // 100초에 상대 333.3m, 나 300m(−33.3m). 나는 4m/s, 상대는 3.333m/s → 격차가 초당 0.667m씩 줄어 50초 뒤
    const found = findCatchUp(SETUP, 100, 300, 4)!;
    expect(found.type).toBe("overtake");
    expect(found.inSec).toBeCloseTo(50, 6);
  });

  it("앞선 내가 더 느리면 상대가 따라잡는 시점(추월당함)을 구한다", () => {
    // 100초에 나 400m(+66.7m), 나는 3m/s → 격차가 초당 0.333m씩 줄어 200초 뒤
    const found = findCatchUp(SETUP, 100, 400, 3)!;
    expect(found.type).toBe("overtaken");
    expect(found.inSec).toBeCloseTo(200, 6);
  });

  it("만나지 못하는 경우는 null이다 (뒤처졌는데 더 느림 / 앞섰는데 더 빠름)", () => {
    expect(findCatchUp(SETUP, 100, 300, 3)).toBeNull();
    expect(findCatchUp(SETUP, 100, 400, 4)).toBeNull();
  });

  it("멈춰 있거나, 격차가 정확히 0이거나, 이미 도착했으면 null이다", () => {
    expect(findCatchUp(SETUP, 100, 300, 0)).toBeNull();
    expect(findCatchUp(SETUP, 300, distanceAtTime(STEADY, 300), 4)).toBeNull();
    expect(findCatchUp(SETUP, 1400, 5000, 4)).toBeNull();
  });

  it("상대의 남은 기록이 중간에 느려지는 것도 반영한다", () => {
    // 상대: 500초까지 4m/s로 달려 2000m, 이후 2m/s로 1750초에 4500m, 2000초에 5000m
    const slowing = makeRecord([
      { t: 0, d: 0 },
      { t: 500, d: 2000 },
      { t: 1750, d: 4500 },
      { t: 2000, d: 5000 },
    ]);
    // 400초에 상대 1600m, 나 1000m(−600m), 나는 3m/s.
    // 100초 뒤까지는 상대가 더 빨라 격차가 −700m로 벌어지고, 이후 상대가 느려져 초당 1m씩 줄어 800초 뒤 만난다
    const found = findCatchUp({ opponent: slowing, raceDistanceM: 5000 }, 400, 1000, 3)!;
    expect(found.type).toBe("overtake");
    expect(found.inSec).toBeCloseTo(800, 6);
  });

  it("지금은 느려 보여도 상대가 뒤에서 빨라지면 따라잡지 못한다 (상대의 후반 스퍼트 반영)", () => {
    // 상대: 1000초까지 2m/s(2000m), 이후 6m/s로 1500초에 5000m
    const sprinter = makeRecord([
      { t: 0, d: 0 },
      { t: 1000, d: 2000 },
      { t: 1500, d: 5000 },
    ]);
    // 900초에 상대 1800m, 나 1500m(−300m), 나는 3m/s.
    // 상대 속도가 지금(2m/s) 그대로라고만 보면 300초 뒤 따라잡지만, 실제로는 1000초부터 6m/s라서 못 따라잡는다
    expect(findCatchUp({ opponent: sprinter, raceDistanceM: 5000 }, 900, 1500, 3)).toBeNull();
  });

  it("3km 대결에서는 상대 기록을 3km에서 자른다", () => {
    // 5km 기록(3.333m/s)의 3km 도착은 900초. 나는 800초에 2600m(상대 2666.7m, −66.7m), 4m/s → 100초 뒤 도착하며 만난다
    const found = findCatchUp({ opponent: STEADY, raceDistanceM: 3000 }, 800, 2600, 4);
    expect(found).not.toBeNull();
    expect(found!.type).toBe("overtake");
    expect(found!.inSec).toBeCloseTo(100, 0);
  });
});

describe("decideSpeak (숫자로 말해도 되는지)", () => {
  it("예상 시점이 60초 이내이고 흔들림이 작을 때만 숫자로 말한다", () => {
    expect(decideSpeak(40, 0.02)).toBe("number");
    expect(decideSpeak(60, 0.1)).toBe("number"); // 경계값 포함
  });

  it("예상 시점이 60초보다 멀면 숫자 없이 말한다", () => {
    expect(decideSpeak(60.1, 0.02)).toBe("vague");
    expect(decideSpeak(300, 0)).toBe("vague");
  });

  it("흔들림이 크면 가까워도 숫자 없이 말한다", () => {
    expect(decideSpeak(30, 0.11)).toBe("vague");
    expect(decideSpeak(30, Infinity)).toBe("vague");
  });
});

describe("createPredictor (예측 한 번에 묶기)", () => {
  /** 1초마다 나의 거리를 넣고 마지막 결과를 돌려준다. 앞 100초는 일정하게, 그 뒤 60초는 speedAt대로 달린다 */
  function runUntil160(speedAfter100: (second: number) => number) {
    const predictor = createPredictor(SETUP);
    const first100 = 318.33333333 / 100; // 100초에 318.33m
    let d = 0;
    let last = predictor.update(0, 0);
    for (let t = 1; t <= 160; t++) {
      d += t <= 100 ? first100 : speedAfter100(t - 100);
      last = predictor.update(t, d);
    }
    return last;
  }

  it("레이스 시작 후 60초가 지나기 전에는 예측하지 않는다", () => {
    const predictor = createPredictor(SETUP);
    for (let t = 0; t < 60; t++) {
      const { recentPace, prediction } = predictor.update(t, 4 * t);
      expect(recentPace).toBeNull();
      expect(prediction).toBeNull();
    }
    // 60초가 되면 최근 페이스가 나온다. 내가 앞서 있고 더 빨라서 만날 일이 없으므로 예측은 여전히 없다
    const atSixty = predictor.update(60, 240);
    expect(atSixty.recentPace).not.toBeNull();
    expect(atSixty.prediction).toBeNull();
  });

  it("페이스가 일정하고 예상 시점이 30초 뒤면 숫자로 말한다", () => {
    // 160초에 −5m, 최근 60초 3.5m/s → 상대(3.333m/s)보다 초당 0.167m씩 따라붙어 30초 뒤
    const { prediction, recentPace } = runUntil160(() => 3.5);
    expect(recentPace!.variation).toBeCloseTo(0, 6);
    expect(prediction!.type).toBe("overtake");
    expect(prediction!.inSec).toBeCloseTo(30, 0);
    expect(prediction!.atRaceTimeSec).toBeCloseTo(160 + prediction!.inSec, 9);
    expect(prediction!.speak).toBe("number");
  });

  it("같은 상황이라도 최근 페이스가 들쭉날쭉(2m/s와 5m/s를 번갈아)하면 숫자 없이 말한다", () => {
    const { prediction, recentPace } = runUntil160((second) => (Math.floor((second - 1) / 10) % 2 === 0 ? 2 : 5));
    expect(recentPace!.speedMps).toBeCloseTo(3.5, 6);
    expect(recentPace!.variation).toBeGreaterThan(PREDICTION_MAX_VARIATION);
    expect(prediction!.inSec).toBeCloseTo(30, 0); // 예상 시점은 같다
    expect(prediction!.speak).toBe("vague");
  });

  it("상대 기록이 대결 거리보다 짧으면 오류를 던진다", () => {
    const short = makeRecord([
      { t: 0, d: 0 },
      { t: 900, d: 3000 },
    ]);
    expect(() => createPredictor({ opponent: short, raceDistanceM: 5000 })).toThrow("대결 거리보다 짧다");
  });
});

describe("데모 경로와 가상러너-03의 레이스에서 예측 (발표 시연용 흐름)", () => {
  const rival = virtualRunners.find((r) => r.id === "가상러너-03")!;
  const setup: RaceSetup = { opponent: rival, raceDistanceM: 5000 };

  // 데모 경로를 1초씩 넣으면서 시점별 결과를 모아 둔다
  const track = makeDemoTrack();
  const predictor = createPredictor(setup);
  const results = new Map<number, ReturnType<typeof predictor.update>>();
  let traveled = 0;
  let trueCrossing = -1; // 내가 처음으로 상대와 같아지거나 앞서는 시각(초)
  for (let i = 0; i < track.length; i++) {
    if (i > 0) traveled += distanceBetweenM(track[i - 1], track[i]);
    results.set(track[i].t, predictor.update(track[i].t, traveled));
    if (trueCrossing < 0 && track[i].t > 0 && measureGap(setup, track[i].t, traveled).gapM >= 0) {
      trueCrossing = track[i].t;
    }
  }

  it("60초 전에는 예측이 없고, 60초부터는 아직 먼 추월을 숫자 없이 말한다", () => {
    expect(results.get(59)!.prediction).toBeNull();
    const atSixty = results.get(60)!.prediction!;
    expect(atSixty.type).toBe("overtake");
    expect(atSixty.speak).toBe("vague");
  });

  it("추월 2분 전쯤(1100초)에는 아직 숫자 없이 말한다", () => {
    const prediction = results.get(1100)!.prediction!;
    expect(prediction.inSec).toBeGreaterThan(PREDICTION_MAX_ANNOUNCE_SEC);
    expect(prediction.speak).toBe("vague");
  });

  it("추월 35초 전에는 숫자로 말하고, 예상 시점이 실제 추월과 2초 안으로 맞는다", () => {
    expect(trueCrossing).toBeGreaterThan(0);
    const prediction = results.get(trueCrossing - 35)!.prediction!;
    expect(prediction.speak).toBe("number");
    expect(Math.abs(prediction.atRaceTimeSec - trueCrossing)).toBeLessThanOrEqual(2);
  });

  it("추월한 뒤에는 상대가 따라잡을 일이 없어서 예측이 없다", () => {
    expect(results.get(trueCrossing + 60)!.prediction).toBeNull();
  });
});
