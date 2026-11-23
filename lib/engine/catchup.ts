// 경기 흐름 분석 엔진 ② (PLAN.md 작업 5, PRD 5번 A "추월 예상 시점"·"예측을 말하는 규칙")
// 내 최근 60초 페이스가 이어진다고 가정하고, 상대의 "실제 남은 기록"과 만나는 시점을 계산한다.
// 상대는 이미 끝난 기록이라 남은 구간을 정확히 알기 때문에, 상대가 후반에 빨라지거나 느려지는 것도 그대로 반영된다.
//
// 이 파일도 계산만 한다. 음성·진동·화면·GPS를 모른다(DESIGN.md 4번 규칙).
// 시간(t)은 모두 "레이스 안의 시간"(초)이다.
import { distanceAtTime, timeToReachDistance } from "../record";
import { assertRaceSetup, type RaceSetup } from "./gap";

/** 레이스 시작 후 이 시간(초)이 지나기 전에는 데이터가 부족해서 예측을 하지 않는다 */
export const PREDICTION_MIN_RACE_TIME_SEC = 60;
/** 최근 페이스를 재는 시간 길이(초) */
export const PACE_WINDOW_SEC = 60;
/** 최근 페이스의 흔들림을 재려고 최근 구간을 나누는 길이(초). 60초를 6조각으로 나눈다 */
export const PACE_SEGMENT_SEC = 10;
/** "N초 뒤 추월"처럼 숫자로 말해도 되는 예상 시점의 한계(초). 이보다 먼 예측은 숫자 없이 말한다 */
export const PREDICTION_MAX_ANNOUNCE_SEC = 60;
/**
 * "N초 뒤 추월"처럼 숫자로 말해도 되는 페이스 흔들림의 한계. 10초 구간 속도들의 표준편차 ÷ 평균(변동계수)이다.
 * PRD에서 "개발 중 정한다"고 한 값의 초안이고, 테스트 기록으로 조정한다.
 */
export const PREDICTION_MAX_VARIATION = 0.1;

/** 최근 페이스 */
export type RecentPace = {
  /** 최근 60초 평균 속도(m/s) */
  speedMps: number;
  /** 최근 60초 평균 페이스(초/km). 멈춰 있으면 Infinity */
  paceSecPerKm: number;
  /** 페이스의 흔들림: 최근 60초를 10초씩 6조각으로 나눈 속도들의 변동계수(표준편차 ÷ 평균). 0이면 일정하다 */
  variation: number;
  /** 10초 조각별 속도(m/s). 예상 승률(작업 6)이 흔들림을 구할 때도 쓴다 */
  segmentSpeedsMps: number[];
};

export type PaceTracker = {
  /** 나의 (시간, 누적 거리)를 알려 준다. 시간은 거꾸로 갈 수 없고, 누적 거리는 줄어들지 않게 다룬다 */
  add(t: number, distanceM: number): void;
  /** 최근 페이스. 아직 60초치 기록이 없으면 null */
  recent(): RecentPace | null;
};

/** 최근 windowSec초의 페이스를 따라가는 도구 */
export function createPaceTracker(
  windowSec: number = PACE_WINDOW_SEC,
  segmentSec: number = PACE_SEGMENT_SEC,
): PaceTracker {
  const segmentCount = Math.round(windowSec / segmentSec);
  if (!(windowSec > 0) || segmentCount < 2 || Math.abs(segmentCount * segmentSec - windowSec) > 1e-9) {
    throw new Error("조각 길이는 전체 시간을 둘 이상으로 똑같이 나눌 수 있어야 한다");
  }

  const history: { t: number; d: number }[] = [];

  /** 기록된 점들 사이를 직선으로 이어 t초의 누적 거리를 구한다 */
  const distanceAt = (t: number): number => {
    const last = history[history.length - 1];
    if (t >= last.t) return last.d;
    for (let i = 1; i < history.length; i++) {
      if (t <= history[i].t) {
        const before = history[i - 1];
        const after = history[i];
        return before.d + ((t - before.t) / (after.t - before.t)) * (after.d - before.d);
      }
    }
    return last.d;
  };

  return {
    add(t, distanceM) {
      const last = history[history.length - 1];
      let d = distanceM;
      if (last) {
        if (t < last.t) throw new Error("시간이 거꾸로 갈 수 없다");
        d = Math.max(d, last.d); // 누적 거리는 줄어들지 않는다
        if (t === last.t) {
          last.d = d;
          return;
        }
      }
      history.push({ t, d });
      // 60초 계산에 더 이상 필요 없는 오래된 점을 버린다 (60초 전보다 앞선 점 하나는 남긴다)
      while (history.length > 2 && history[1].t <= t - windowSec) history.shift();
    },

    recent() {
      const last = history[history.length - 1];
      if (!last) return null;
      const start = last.t - windowSec;
      if (history[0].t > start + 1e-9) return null; // 아직 windowSec초치 기록이 없다

      const segmentSpeeds: number[] = [];
      for (let k = 0; k < segmentCount; k++) {
        const from = start + k * segmentSec;
        segmentSpeeds.push((distanceAt(from + segmentSec) - distanceAt(from)) / segmentSec);
      }
      const speed = (distanceAt(last.t) - distanceAt(start)) / windowSec;
      const variance = segmentSpeeds.reduce((sum, v) => sum + (v - speed) ** 2, 0) / segmentCount;
      return {
        speedMps: speed,
        paceSecPerKm: speed > 0 ? 1000 / speed : Infinity,
        variation: speed > 0 ? Math.sqrt(variance) / speed : Infinity,
        segmentSpeedsMps: segmentSpeeds,
      };
    },
  };
}

/** 두 사람이 만나는 시점 */
export type CatchUp = {
  /** overtake: 내가 상대를 따라잡음(추월) / overtaken: 상대가 나를 따라잡음(추월당함) */
  type: "overtake" | "overtaken";
  /** 지금부터 만나기까지 남은 시간(초) */
  inSec: number;
};

/**
 * 내가 지금부터 speedMps(m/s)로 일정하게 달린다고 가정하고, 상대의 실제 남은 기록과 처음 만나는 시점을 구한다.
 * - 지금 내가 뒤처져 있으면 "내가 따라잡는" 시점(overtake), 앞서 있으면 "상대가 따라잡는" 시점(overtaken)이다.
 * - 한쪽이 결승선에 닿기 전까지만 본다. 그 안에 만나지 않으면 null이다.
 * - 지금 격차가 정확히 0이거나, 내가 멈춰 있거나, 이미 도착했으면 null이다.
 */
export function findCatchUp(
  setup: RaceSetup,
  t: number,
  myDistanceM: number,
  speedMps: number,
): CatchUp | null {
  const race = setup.raceDistanceM;
  const mine0 = Math.min(Math.max(myDistanceM, 0), race);
  if (!(speedMps > 0) || mine0 >= race) return null;

  const opponent0 = Math.min(distanceAtTime(setup.opponent, t), race);
  const gap0 = mine0 - opponent0;
  if (gap0 === 0) return null;

  // 누군가 결승선에 닿으면 레이스가 끝나므로 그때까지만 본다
  const myEnd = (race - mine0) / speedMps;
  const opponentEnd = (timeToReachDistance(setup.opponent, race) ?? Infinity) - t;
  const horizon = Math.min(myEnd, opponentEnd);
  if (!(horizon > 0)) return null;

  const gapAfter = (tau: number) =>
    Math.min(mine0 + speedMps * tau, race) - Math.min(distanceAtTime(setup.opponent, t + tau), race);

  // 상대 기록은 점과 점 사이가 직선이라, 점이 바뀌는 시각마다 끊어 보면 각 조각 안에서 격차가 직선으로 변한다
  const cuts = [
    0,
    ...setup.opponent.points.map((p) => p.t - t).filter((tau) => tau > 0 && tau < horizon),
    horizon,
  ];
  let previousTau = 0;
  let previousGap = gap0;
  for (const tau of cuts.slice(1)) {
    const gap = gapAfter(tau);
    const crossed = (previousGap < 0 && gap >= 0) || (previousGap > 0 && gap <= 0);
    if (crossed) {
      const fraction = previousGap / (previousGap - gap);
      return {
        type: gap0 < 0 ? "overtake" : "overtaken",
        inSec: previousTau + fraction * (tau - previousTau),
      };
    }
    previousTau = tau;
    previousGap = gap;
  }
  return null;
}

/**
 * 만나는 시점을 숫자로 말해도 되는지 정한다.
 * - number: "40초 뒤 추월"처럼 숫자로 말해도 된다 (예상 시점이 60초 이내이고 페이스 흔들림이 작을 때만)
 * - vague: 숫자 없이 "따라붙고 있습니다"처럼 말한다
 */
export function decideSpeak(inSec: number, variation: number): "number" | "vague" {
  return inSec <= PREDICTION_MAX_ANNOUNCE_SEC && variation <= PREDICTION_MAX_VARIATION ? "number" : "vague";
}

/** 예측 한 건 */
export type Prediction = CatchUp & {
  /** 만나는 시점의 레이스 시간(초) */
  atRaceTimeSec: number;
  speak: "number" | "vague";
};

export type PredictorUpdate = {
  /** 최근 60초 페이스. 아직 60초치 기록이 없으면 null (예상 승률 계산에도 쓴다) */
  recentPace: RecentPace | null;
  /** 예측. 말할 만한 예측이 없으면 null */
  prediction: Prediction | null;
};

export type Predictor = {
  /** 1초마다 나의 누적 거리를 알려 주면 최근 페이스와 (있다면) 예측을 돌려준다 */
  update(t: number, myDistanceM: number): PredictorUpdate;
};

export function createPredictor(setup: RaceSetup): Predictor {
  assertRaceSetup(setup);
  const tracker = createPaceTracker();

  return {
    update(t, myDistanceM) {
      tracker.add(t, myDistanceM);
      const recentPace = tracker.recent();
      // 레이스 시작 후 60초가 지나기 전에는 예측하지 않는다
      if (!recentPace || t < PREDICTION_MIN_RACE_TIME_SEC) {
        return { recentPace, prediction: null };
      }
      const catchUp = findCatchUp(setup, t, myDistanceM, recentPace.speedMps);
      if (!catchUp) return { recentPace, prediction: null };

      return {
        recentPace,
        prediction: {
          ...catchUp,
          atRaceTimeSec: t + catchUp.inSec,
          speak: decideSpeak(catchUp.inSec, recentPace.variation),
        },
      };
    },
  };
}
