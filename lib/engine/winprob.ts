// 경기 흐름 분석 엔진 ③ (PLAN.md 작업 6, PRD 5번 A "예상 승리 확률")
// 내가 최근 60초 페이스로 계속 달린다고 가정했을 때의 "예상 승률"을 계산하고, 우세·접전·열세 3단계로 바꾼다.
//
// ※ 실제 확률이 아니다. '최근 페이스가 이어진다'는 가정 아래의 추정치다. 그래서 화면에는 '예상 승률'로만 표시하고,
//   음성으로는 퍼센트 없이 우세·접전·열세 3단계로만 전한다. 아직 실제 완주 기록으로 맞는지 검증하지 않았다.
//
// 이 파일도 계산만 한다. 음성·진동·화면·GPS를 모른다(DESIGN.md 4번 규칙). 시간은 레이스 안의 시간(초)이다.
import { timeToReachDistance } from "../record";
import { PACE_SEGMENT_SEC, type RecentPace } from "./catchup";
import { assertRaceSetup, type RaceSetup } from "./gap";

/**
 * 흔들림 보정 계수 k (PRD: 1 이상). 페이스는 앞뒤 구간이 서로 이어져 있어서, 구간들이 서로 독립이라고 보고 구한
 * 흔들림보다 실제 불확실성이 크다. 그만큼 키우는 값이다. 값은 초안이고 테스트 기록으로 조정한다.
 */
export const WIN_CORRECTION_K = 1.5;
/** 남은 시간 흔들림(σ)의 최솟값(초). 페이스가 아주 일정해 보여도 승률이 0%/100%로 딱 잘리지 않게 하는 바닥값(초안) */
export const WIN_MIN_SIGMA_SEC = 2;
/** 결승선까지 남은 거리가 이 값(미터) 이하이면 도착한 것으로 본다 (계산 오차 때문에 5000m가 4999.9999999m로 나오는 경우를 위해) */
const ARRIVED_TOLERANCE_M = 1e-6;
/** 승률이 이 값 이상이면 "우세" (초안) */
export const ADVANTAGE_MIN = 0.7;
/** 승률이 이 값 이하이면 "열세" (초안). 그 사이는 "접전" */
export const DISADVANTAGE_MAX = 0.3;
/** 단계가 자꾸 바뀌지 않게 하는 여유 폭(초안). 우세에서 내려오려면 70%보다 5%p 더 내려가야 한다 */
export const STAGE_HYSTERESIS = 0.05;

/** 표준정규분포의 누적확률 Φ(z): z 이하의 값이 나올 확률 */
export function normalCdf(z: number): number {
  // erf의 근사식(Abramowitz-Stegun 7.1.26, 오차 1.5e-7 이하)을 쓴다
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** 예상 승률 계산 결과 */
export type WinEstimate = {
  /** 예상 승률(0~1) */
  probability: number;
  /** 내가 최근 페이스로 달릴 때 남은 시간(초). T̂나 */
  myRemainingSec: number;
  /** 상대가 결승선에 닿기까지 남은 시간(초). 확정값. 이미 닿았으면 0 */
  opponentRemainingSec: number;
  /** 남은 시간의 흔들림(초). 보정 계수 k를 곱하기 전의 σ */
  sigmaSec: number;
};

export type WinOptions = {
  k?: number;
  minSigmaSec?: number;
};

/**
 * 예상 승률 = Φ( (T상대 − T̂나) / (k · σ) )
 * - T상대: 상대가 결승선에 닿기까지 남은 시간. 상대는 끝난 기록이라 확정값이다.
 * - T̂나: 남은 거리 ÷ 내 최근 60초 속도
 * - σ: 최근 페이스의 흔들림(변동계수 CV)으로 구한 남은 시간의 흔들림.
 *   남은 시간 동안의 평균 속도는 10초 조각 n = T̂나 ÷ 10개의 평균이라, 조각들이 독립이라고 보면
 *   표준편차가 1/√n로 줄어든다. 그래서 σ ≈ T̂나 × CV ÷ √n = CV × √(10 × T̂나). (너무 작으면 바닥값을 쓴다)
 *   이 값은 독립 가정이라 실제보다 작으므로 k(1 이상)를 곱해 키운다.
 * 최근 60초 페이스가 아직 없으면(레이스 시작 후 60초 전) null이다.
 */
export function estimateWinProbability(
  setup: RaceSetup,
  t: number,
  myDistanceM: number,
  recentPace: RecentPace | null,
  options: WinOptions = {},
): WinEstimate | null {
  if (!recentPace) return null;
  const k = options.k ?? WIN_CORRECTION_K;
  const minSigma = options.minSigmaSec ?? WIN_MIN_SIGMA_SEC;
  if (!(k >= 1)) throw new Error("보정 계수 k는 1 이상이어야 한다");

  const race = setup.raceDistanceM;
  const opponentFinishAt = timeToReachDistance(setup.opponent, race) ?? Infinity;
  const opponentRemaining = Math.max(0, opponentFinishAt - t);
  const myRemainingDistance = race - Math.min(Math.max(myDistanceM, 0), race);

  // 이미 결승선에 닿았다: 상대가 아직 달리고 있었으면 내가 이긴 것이다
  // (거리 계산의 아주 작은 오차로 "조금 모자라 못 닿은 것"이 되지 않도록 작은 여유를 둔다)
  if (myRemainingDistance <= ARRIVED_TOLERANCE_M) {
    return {
      probability: opponentRemaining > 0 ? 1 : 0,
      myRemainingSec: 0,
      opponentRemainingSec: opponentRemaining,
      sigmaSec: 0,
    };
  }
  // 상대가 이미 먼저 도착했고 나는 아직 달리는 중이면 이길 수 없다
  if (opponentRemaining <= 0) {
    return {
      probability: 0,
      myRemainingSec: recentPace.speedMps > 0 ? myRemainingDistance / recentPace.speedMps : Infinity,
      opponentRemainingSec: 0,
      sigmaSec: 0,
    };
  }
  // 멈춰 있으면 끝까지 갈 수 없다고 본다
  if (!(recentPace.speedMps > 0)) {
    return { probability: 0, myRemainingSec: Infinity, opponentRemainingSec: opponentRemaining, sigmaSec: Infinity };
  }

  const myRemaining = myRemainingDistance / recentPace.speedMps;
  const sigma = Math.max(minSigma, recentPace.variation * Math.sqrt(PACE_SEGMENT_SEC * myRemaining));
  const z = (opponentRemaining - myRemaining) / (k * sigma);
  return {
    probability: normalCdf(z),
    myRemainingSec: myRemaining,
    opponentRemainingSec: opponentRemaining,
    sigmaSec: sigma,
  };
}

/** 승률을 말로 바꾼 3단계: 우세 / 접전 / 열세 */
export type WinStage = "advantage" | "close" | "disadvantage";

/** 화면과 음성에 쓸 한국어 이름 */
export const WIN_STAGE_LABEL: Record<WinStage, string> = {
  advantage: "우세",
  close: "접전",
  disadvantage: "열세",
};

/** 승률(0~1)을 3단계로 바꾼다 (여유 폭 없이 기준만 본다) */
export function stageOf(probability: number): WinStage {
  if (probability >= ADVANTAGE_MIN) return "advantage";
  if (probability <= DISADVANTAGE_MAX) return "disadvantage";
  return "close";
}

/**
 * 화면에 보여 줄 퍼센트(정수). 추정치라서 0%나 100%로 장담하지 않게 1~99로 자른다.
 */
export function displayPercent(probability: number): number {
  return Math.min(99, Math.max(1, Math.round(probability * 100)));
}

/** 단계가 바뀐 사건 */
export type WinStageChange = {
  t: number;
  from: WinStage;
  to: WinStage;
  probability: number;
};

export type WinStageTracker = {
  /** 지금 단계. 아직 승률을 받은 적이 없으면 null */
  readonly stage: WinStage | null;
  /** 승률을 알려 주면 현재 단계와, 단계가 바뀐 경우의 사건을 돌려준다. 처음 단계가 정해질 때는 사건이 없다 */
  update(t: number, probability: number): { stage: WinStage; change: WinStageChange | null };
};

/**
 * 단계가 바뀌는 것을 따라가는 도구. 기준 근처에서 승률이 조금씩 오르내려도 단계가 자꾸 바뀌지 않도록
 * 현재 단계에서 벗어날 때는 기준보다 hysteresis만큼 더 가야 바뀐 것으로 본다.
 */
export function createWinStageTracker(hysteresis: number = STAGE_HYSTERESIS): WinStageTracker {
  if (!(hysteresis >= 0)) throw new Error("여유 폭은 0 이상이어야 한다");
  let stage: WinStage | null = null;

  const next = (current: WinStage, p: number): WinStage => {
    if (current === "advantage") {
      return p < ADVANTAGE_MIN - hysteresis ? stageOf(p) : current;
    }
    if (current === "disadvantage") {
      return p > DISADVANTAGE_MAX + hysteresis ? stageOf(p) : current;
    }
    return stageOf(p); // 접전에서는 기준을 넘으면 바로 바뀐다
  };

  return {
    get stage() {
      return stage;
    },
    update(t, probability) {
      if (stage === null) {
        stage = stageOf(probability);
        return { stage, change: null };
      }
      const nextStage = next(stage, probability);
      if (nextStage === stage) return { stage, change: null };
      const change: WinStageChange = { t, from: stage, to: nextStage, probability };
      stage = nextStage;
      return { stage, change };
    },
  };
}

export type WinTrackerUpdate = {
  /** 예상 승률. 최근 페이스가 아직 없으면 null */
  estimate: WinEstimate | null;
  /** 지금 단계. 승률이 아직 없으면 null */
  stage: WinStage | null;
  /** 이번에 단계가 바뀌었다면 그 사건 */
  change: WinStageChange | null;
};

export type WinTracker = {
  /** 1초마다 나의 누적 거리와 최근 페이스(예측 엔진이 돌려준 값)를 알려 준다 */
  update(t: number, myDistanceM: number, recentPace: RecentPace | null): WinTrackerUpdate;
};

/** 예상 승률 계산과 단계 변화 추적을 한 번에 묶은 도구 */
export function createWinTracker(setup: RaceSetup, options: WinOptions = {}): WinTracker {
  assertRaceSetup(setup);
  const stageTracker = createWinStageTracker();

  return {
    update(t, myDistanceM, recentPace) {
      const estimate = estimateWinProbability(setup, t, myDistanceM, recentPace, options);
      if (!estimate) return { estimate: null, stage: stageTracker.stage, change: null };
      const { stage, change } = stageTracker.update(t, estimate.probability);
      return { estimate, stage, change };
    },
  };
}
