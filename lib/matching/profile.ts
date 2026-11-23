// 구간 프로필과 예상 역전 횟수 (PLAN.md 작업 13, PRD 5번 B "역전 예측 매칭")
//  - 구간 프로필: 대결 거리를 같은 길이의 4구간으로 나누고, 구간별 페이스를 "평균 페이스 대비 비율"로 적는다.
//  - 예상 역전 횟수: 나와 상대의 프로필을 겹쳐 같은 거리에서 누가 앞서는지를 보고, 앞선 쪽이 바뀌는 횟수를 센다.
//    중계의 10m 역전 판정과는 별개로, 단순한 부호 변화만 센다.
// 이 파일은 계산만 한다. 화면·브라우저 기능을 모른다.
import { timeToReachDistance, type RunRecord } from "../record";

export const SEGMENT_COUNT = 4;

export type SegmentProfile = {
  /** 이 프로필이 다루는 거리(미터) = 대결 거리 */
  distanceM: number;
  /** 대결 거리 전체의 평균 페이스(초/km) */
  avgPaceSecPerKm: number;
  /** 구간별 페이스 ÷ 평균 페이스. 1보다 크면 평균보다 느린 구간 */
  ratios: number[];
};

/** 일정한 페이스로 달리는 프로필(기록이 없는 사용자). 비율이 모두 1이다 */
export function constantProfile(distanceM: number, paceSecPerKm: number): SegmentProfile {
  return { distanceM, avgPaceSecPerKm: paceSecPerKm, ratios: Array(SEGMENT_COUNT).fill(1) };
}

/**
 * 기록을 대결 거리까지만 잘라 4구간 프로필로 만든다.
 * 기록이 대결 거리에 닿지 못하면 null.
 */
export function profileFromRecord(record: RunRecord, distanceM: number): SegmentProfile | null {
  const times: number[] = [];
  for (let i = 0; i <= SEGMENT_COUNT; i++) {
    const t = timeToReachDistance(record, (distanceM * i) / SEGMENT_COUNT);
    if (t === null) return null;
    times.push(t);
  }
  const total = times[SEGMENT_COUNT];
  if (!(total > 0)) return null;
  const avgPaceSecPerKm = (total / distanceM) * 1000;
  const segmentM = distanceM / SEGMENT_COUNT;
  const ratios = Array.from({ length: SEGMENT_COUNT }, (_, i) => {
    const segmentPace = ((times[i + 1] - times[i]) / segmentM) * 1000;
    return segmentPace / avgPaceSecPerKm;
  });
  return { distanceM, avgPaceSecPerKm, ratios };
}

/** 프로필대로 달렸을 때 x미터 지점에 닿는 시간(초). 한 구간 안에서는 같은 페이스로 달린다 */
export function timeAtDistance(profile: SegmentProfile, x: number): number {
  const segmentM = profile.distanceM / SEGMENT_COUNT;
  let time = 0;
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const start = i * segmentM;
    if (x <= start) break;
    const covered = Math.min(x, start + segmentM) - start;
    time += (covered / 1000) * profile.avgPaceSecPerKm * profile.ratios[i];
  }
  return time;
}

export type ReversalForecast = {
  /** 예상 역전 횟수(앞선 쪽이 바뀌는 횟수) */
  count: number;
  /** 마지막 역전이 일어나는 지점이 대결 거리의 몇 %쯤인지(0~1). 역전이 없으면 null */
  lastAtFraction: number | null;
};

/** 비교할 지점 수: 대결 거리를 이만큼 잘게 나눠서 앞선 쪽을 본다 */
const SAMPLE_STEPS = 200;
/** 이 차이(초) 안이면 "같이 달리는 중"으로 보고 앞선 쪽을 바꾸지 않는다 */
const TIE_SEC = 0.05;

/**
 * 나와 상대의 프로필을 겹쳐 예상 역전을 센다. 두 프로필은 같은 거리여야 한다.
 * 같은 지점에 먼저 닿는 쪽이 앞서는 쪽이다.
 */
export function forecastReversals(me: SegmentProfile, opponent: SegmentProfile): ReversalForecast {
  if (me.distanceM !== opponent.distanceM) {
    throw new Error("나와 상대의 프로필은 같은 거리여야 한다");
  }
  let leader = 0; // +1 내가 앞, −1 상대가 앞
  let count = 0;
  let lastAt: number | null = null;
  for (let step = 1; step < SAMPLE_STEPS; step++) {
    const x = (me.distanceM * step) / SAMPLE_STEPS;
    const diff = timeAtDistance(opponent, x) - timeAtDistance(me, x); // 양수면 내가 먼저 닿음
    if (Math.abs(diff) <= TIE_SEC) continue;
    const now = diff > 0 ? 1 : -1;
    if (leader !== 0 && now !== leader) {
      count += 1;
      lastAt = step / SAMPLE_STEPS;
    }
    leader = now;
  }
  return { count, lastAtFraction: lastAt };
}
