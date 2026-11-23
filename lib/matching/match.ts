// 역전 예측 매칭 (PLAN.md 작업 13, PRD 5번 B, DESIGN.md 2번)
// 같은 대결 거리와 비슷한 페이스의 후보 중에서, 경기 중 역전이 일어날 것으로 예상되는 상대를 고른다.
//  1) 후보: 대결 거리 이상을 완주했고 대결 거리까지의 평균 페이스 차이가 ±15초/km 이내인 기록
//  2) 우선순위: 예상 역전이 1회 이상이고 마지막 역전이 중반(50%) 이후인 상대 → 예상 역전이 많은 순
//     → (비슷하면) 총 상승 고도가 내 고도와 가까운 순(고도 정보가 없으면 이 비교에서 뺀다) → 최근 등록 순
//  3) 후보가 없으면 같은 거리 기록 중 평균 페이스 차이가 가장 작은 기록으로 매칭하고 "가장 가까운 기록"으로 알린다
//  4) 기록이 없는 사용자는 일정한 페이스로 달린다고 가정한다
// "이 매칭이 역전을 더 많이 만든다"는 시뮬레이션(작업 21) 전에는 단정하지 않는다. 여기서는 "예상"만 한다.
import type { RunRecord } from "../record";
import { constantProfile, forecastReversals, profileFromRecord, type ReversalForecast, type SegmentProfile } from "./profile";

/** 후보로 보는 평균 페이스 차이(초/km) */
export const MATCH_PACE_RANGE_SEC = 15;
/** 이 지점(대결 거리의 비율) 이후에 마지막 역전이 있으면 "중반 이후"로 본다 */
export const LATE_REVERSAL_FRACTION = 0.5;

export type MatchRequest = {
  /** 대결 거리(미터) */
  distanceM: number;
  /** 내 평소 페이스(초/km) */
  paceSecPerKm: number;
  /** 내 프로필. 없으면(기록이 없는 사용자) 일정한 페이스로 달린다고 가정한다 */
  myProfile?: SegmentProfile;
  /** 내 총 상승 고도(미터). 모르면 고도 비교를 하지 않는다 */
  myElevationGainM?: number | null;
};

export type MatchResult = {
  opponent: RunRecord;
  /** reversal: 역전이 예상되는 상대 / closest: 조건에 맞는 상대가 없어 가장 가까운 기록으로 매칭 */
  kind: "reversal" | "closest";
  /** 대결 거리까지의 평균 페이스 차이(초/km, 상대가 느리면 +) */
  paceDiffSecPerKm: number;
  forecast: ReversalForecast;
};

type Scored = {
  record: RunRecord;
  profile: SegmentProfile;
  paceDiff: number;
  forecast: ReversalForecast;
  late: boolean;
};

export function matchOpponent(records: RunRecord[], request: MatchRequest): MatchResult | null {
  const me = request.myProfile ?? constantProfile(request.distanceM, request.paceSecPerKm);

  const scored: Scored[] = [];
  for (const record of records) {
    if (record.completedDistanceM < request.distanceM) continue;
    const profile = profileFromRecord(record, request.distanceM);
    if (!profile) continue;
    const forecast = forecastReversals(me, profile);
    scored.push({
      record,
      profile,
      paceDiff: profile.avgPaceSecPerKm - me.avgPaceSecPerKm,
      forecast,
      late: forecast.lastAtFraction !== null && forecast.lastAtFraction >= LATE_REVERSAL_FRACTION,
    });
  }
  if (scored.length === 0) return null;

  const toResult = (item: Scored, kind: MatchResult["kind"]): MatchResult => ({
    opponent: item.record,
    kind,
    paceDiffSecPerKm: item.paceDiff,
    forecast: item.forecast,
  });

  const myElevation = request.myElevationGainM ?? null;
  const elevationGap = (item: Scored) =>
    myElevation === null || item.record.totalElevationGainM === null
      ? Infinity // 고도 정보가 없으면 이 비교에서는 가장 뒤로 둔다
      : Math.abs(item.record.totalElevationGainM - myElevation);

  const preferred = scored
    .filter((item) => Math.abs(item.paceDiff) <= MATCH_PACE_RANGE_SEC && item.forecast.count >= 1 && item.late)
    .sort(
      (a, b) =>
        b.forecast.count - a.forecast.count ||
        elevationGap(a) - elevationGap(b) ||
        b.record.registrationOrder - a.record.registrationOrder ||
        a.record.id.localeCompare(b.record.id),
    );
  if (preferred.length > 0) return toResult(preferred[0], "reversal");

  const closest = [...scored].sort(
    (a, b) =>
      Math.abs(a.paceDiff) - Math.abs(b.paceDiff) ||
      b.record.registrationOrder - a.record.registrationOrder ||
      a.record.id.localeCompare(b.record.id),
  );
  return toResult(closest[0], "closest");
}
