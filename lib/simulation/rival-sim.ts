// 차별점 검증 시뮬레이션 (PLAN.md 작업 21, PRD 3번 "차별점 검증 계획", DESIGN.md 시험 표)
// 질문: "역전 예측 매칭"이 "페이스만 보고 매칭"보다 실제 경기에서 역전을 더 많이 만드는가?
//
// 방법
//  - 가상 러너 9명을 기본형으로 삼아, 러너마다 페이스와 달리는 모양을 조금씩 흔든 기록을 두 벌 만든다.
//      "이전 기록" = 매칭에 쓴다 (나와 상대 후보 모두)
//      "새 기록"   = 매칭이 끝난 뒤 경기를 재생해 역전을 세는 데만 쓴다 (매칭에 쓰지 않는다 = 데이터 분리)
//  - 모든 러너가 한 번씩 "나" 역할을 맡는다. 상대 후보는 나를 뺀 8명의 이전 기록이다.
//  - 같은 조건(나, 대결 거리)에서 두 방식이 각자 상대를 고른다.
//      페이스만: 후보 중 평균 페이스 차이가 가장 작은 상대
//      역전 예측: matchOpponent (앱이 쓰는 그 코드)
//  - 고른 상대의 "새 기록"과 나의 "새 기록"으로 레이스 엔진을 돌려, 엔진이 내보낸 추월·추월당함 이벤트 수를 센다.
//  - 흔드는 정도와 반복 횟수(seed 수)를 바꿔 가며 같은 계산을 되풀이한다.
// 한계: 가상 러너 9명의 모양이 사람이 만든 것이고, 실제 러너 기록이 아니다. 숫자는 "시뮬레이션 결과"이지 실사용 결과가 아니다.
import { createRaceEngine } from "../engine/race-engine";
import { matchOpponent } from "../matching/match";
import { profileFromRecord, SEGMENT_COUNT, timeAtDistance, type SegmentProfile } from "../matching/profile";
import { distanceAtTime, timeToReachDistance, type RunRecord } from "../record";
import { virtualRunners } from "../runners";

export type SimOptions = {
  /** 반복 횟수: 시드마다 이전/새 기록을 새로 만든다 */
  trials: number;
  /** 평균 페이스를 흔드는 정도(비율의 표준편차). 0.03이면 약 ±3% */
  paceJitter: number;
  /** 구간 모양을 흔드는 정도 */
  shapeJitter: number;
  seed: number;
  distancesM?: number[];
};

export const DEFAULT_SIM_OPTIONS: SimOptions = { trials: 200, paceJitter: 0.03, shapeJitter: 0.04, seed: 1 };

/** 시드가 같으면 늘 같은 수가 나오는 난수 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** 기본형 기록을 흔들어 새 기록(250m마다 한 점)을 만든다. 5km 완주 기록 */
export function jitterRecord(base: RunRecord, random: () => number, paceJitter: number, shapeJitter: number): RunRecord {
  const profile = profileFromRecord(base, 5000)!;
  const pace = profile.avgPaceSecPerKm * (1 + paceJitter * gaussian(random));
  const raw = profile.ratios.map((ratio) => Math.max(0.5, ratio * (1 + shapeJitter * gaussian(random))));
  const mean = raw.reduce((sum, r) => sum + r, 0) / raw.length;
  const shaped: SegmentProfile = { distanceM: 5000, avgPaceSecPerKm: pace, ratios: raw.map((r) => r / mean) };
  const points = [];
  for (let d = 0; d <= 5000; d += 250) points.push({ t: Math.round(timeAtDistance(shaped, d) * 10) / 10, d });
  return { ...base, points };
}

/** 한 경기를 재생해 엔진이 내보낸 추월·추월당함 이벤트 수를 센다 */
export function countReversals(me: RunRecord, opponent: RunRecord, distanceM: number): number {
  const engine = createRaceEngine({ opponent, raceDistanceM: distanceM });
  const myFinish = timeToReachDistance(me, distanceM)!;
  let count = 0;
  for (let t = 1; t <= Math.ceil(myFinish) + 1; t++) {
    const result = engine.update(t, Math.min(distanceM, distanceAtTime(me, t)));
    for (const event of result.events) if (event.type === "overtake" || event.type === "overtaken") count += 1;
    if (result.finished) break;
  }
  return count;
}

/** 페이스만 보고 고른다: 후보 중 평균 페이스 차이가 가장 작은 상대(같으면 최근 등록 순) */
export function matchByPaceOnly(pool: RunRecord[], distanceM: number, myPaceSecPerKm: number): RunRecord | null {
  let best: { record: RunRecord; diff: number } | null = null;
  for (const record of pool) {
    const profile = profileFromRecord(record, distanceM);
    if (!profile) continue;
    const diff = Math.abs(profile.avgPaceSecPerKm - myPaceSecPerKm);
    if (!best || diff < best.diff || (diff === best.diff && record.registrationOrder > best.record.registrationOrder)) {
      best = { record, diff };
    }
  }
  return best?.record ?? null;
}

export type MethodStats = {
  /** 평균 역전 횟수(경기당) */
  meanReversals: number;
  /** 역전이 한 번이라도 있었던 경기의 비율 */
  shareWithReversal: number;
  /** 고른 상대와의 평균 페이스 차이(초/km, 절댓값) */
  meanAbsPaceDiff: number;
};

export type SimResult = {
  options: SimOptions;
  /** 비교한 경기 수(방식마다 같은 수) */
  races: number;
  pacesOnly: MethodStats;
  prediction: MethodStats;
  /** 두 방식이 서로 다른 상대를 고른 경기의 비율 */
  shareDifferentOpponent: number;
  /** 경기별 (역전 예측 - 페이스만) 역전 횟수 차이의 평균과 표준오차 */
  meanDifference: number;
  standardError: number;
  /** 두 방식의 상대가 다른 경기만 따로 본 평균 역전 횟수 */
  onlyDifferent: { races: number; pacesOnly: number; prediction: number };
};

export function runSimulation(partial: Partial<SimOptions> = {}): SimResult {
  const options: SimOptions = { ...DEFAULT_SIM_OPTIONS, ...partial };
  const distances = options.distancesM ?? [1000, 3000];
  const diffs: number[] = [];
  const A = { rev: 0, withRev: 0, paceDiff: 0 };
  const B = { rev: 0, withRev: 0, paceDiff: 0 };
  let different = 0;
  const diffOnly = { races: 0, a: 0, b: 0 };

  for (let trial = 0; trial < options.trials; trial++) {
    const random = seededRandom(options.seed * 100003 + trial);
    const olds = virtualRunners.map((base) => jitterRecord(base, random, options.paceJitter, options.shapeJitter));
    const news = virtualRunners.map((base) => jitterRecord(base, random, options.paceJitter, options.shapeJitter));

    for (let me = 0; me < virtualRunners.length; me++) {
      for (const distanceM of distances) {
        const myProfile = profileFromRecord(olds[me], distanceM)!;
        const pool = olds.filter((_, index) => index !== me);
        const byPace = matchByPaceOnly(pool, distanceM, myProfile.avgPaceSecPerKm);
        const byPrediction = matchOpponent(pool, {
          distanceM,
          paceSecPerKm: myProfile.avgPaceSecPerKm,
          myProfile,
          myElevationGainM: olds[me].totalElevationGainM,
        })?.opponent;
        if (!byPace || !byPrediction) continue;

        // 고른 상대의 "새 기록"과 나의 "새 기록"으로 경기를 재생한다 (이전 기록은 재생에 쓰지 않는다)
        const newOf = (record: RunRecord) => news[olds.findIndex((old) => old.id === record.id)];
        const revA = countReversals(news[me], newOf(byPace), distanceM);
        const revB = countReversals(news[me], newOf(byPrediction), distanceM);
        const paceOf = (record: RunRecord) => Math.abs(profileFromRecord(record, distanceM)!.avgPaceSecPerKm - myProfile.avgPaceSecPerKm);

        A.rev += revA;
        B.rev += revB;
        A.withRev += revA > 0 ? 1 : 0;
        B.withRev += revB > 0 ? 1 : 0;
        A.paceDiff += paceOf(byPace);
        B.paceDiff += paceOf(byPrediction);
        diffs.push(revB - revA);
        if (byPace.id !== byPrediction.id) {
          different += 1;
          diffOnly.races += 1;
          diffOnly.a += revA;
          diffOnly.b += revB;
        }
      }
    }
  }

  const n = diffs.length;
  const meanDifference = diffs.reduce((s, x) => s + x, 0) / n;
  const variance = diffs.reduce((s, x) => s + (x - meanDifference) ** 2, 0) / Math.max(1, n - 1);
  const stats = (m: typeof A): MethodStats => ({
    meanReversals: m.rev / n,
    shareWithReversal: m.withRev / n,
    meanAbsPaceDiff: m.paceDiff / n,
  });
  return {
    options,
    races: n,
    pacesOnly: stats(A),
    prediction: stats(B),
    shareDifferentOpponent: different / n,
    meanDifference,
    standardError: Math.sqrt(variance / n),
    onlyDifferent: {
      races: diffOnly.races,
      pacesOnly: diffOnly.races ? diffOnly.a / diffOnly.races : 0,
      prediction: diffOnly.races ? diffOnly.b / diffOnly.races : 0,
    },
  };
}

export { SEGMENT_COUNT };
