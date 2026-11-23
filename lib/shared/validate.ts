// 공유 기록 검증 (PLAN.md 작업 23, DESIGN.md 3번)
// 서버는 올라온 기록을 믿지 않고 모양과 값의 범위를 다시 검사한다.
// 받아서 남기는 것은 "시간별 누적 거리"와 "총 상승 고도"뿐이다. 좌표·경로·날짜·이름은 받지도 않고 남기지도 않는다.
import type { DistancePoint } from "../record";

/** 공유할 수 있는 완주 거리(m): 대결 거리와 같다 */
export const SHARE_DISTANCES_M = [1000, 3000] as const;
export const MAX_SHARE_POINTS = 400;
/** 평균 페이스가 이 범위(초/km) 밖이면 사람의 기록으로 보지 않는다 */
export const MIN_PACE_SEC_PER_KM = 150;
export const MAX_PACE_SEC_PER_KM = 1200;
/** 한 구간의 페이스가 이보다 빠르면(시속 25km 초과) 받지 않는다 */
export const FASTEST_SEGMENT_SEC_PER_KM = 144;
export const MAX_ELEVATION_GAIN_M = 3000;

export type ShareSubmission = {
  completedDistanceM: number;
  totalElevationGainM: number | null;
  points: DistancePoint[];
};

export type SubmissionResult = { ok: true; value: ShareSubmission } | { ok: false; message: string };

const fail = (message: string): SubmissionResult => ({ ok: false, message });
const round1 = (x: number) => Math.round(x * 10) / 10;

/** 받은 값을 검사하고, 필요한 칸만 다듬어 돌려준다 */
export function validateSubmission(body: unknown): SubmissionResult {
  if (typeof body !== "object" || body === null) return fail("요청 내용이 올바르지 않습니다");
  const raw = body as Record<string, unknown>;

  const distance = raw.completedDistanceM;
  if (typeof distance !== "number" || !(SHARE_DISTANCES_M as readonly number[]).includes(distance)) {
    return fail("완주 거리는 1000 또는 3000이어야 합니다");
  }

  const elevation = raw.totalElevationGainM;
  if (elevation !== null && elevation !== undefined) {
    if (typeof elevation !== "number" || !Number.isFinite(elevation) || elevation < 0 || elevation > MAX_ELEVATION_GAIN_M) {
      return fail("총 상승 고도가 올바르지 않습니다");
    }
  }

  const rawPoints = raw.points;
  if (!Array.isArray(rawPoints) || rawPoints.length < 2 || rawPoints.length > MAX_SHARE_POINTS) {
    return fail(`기록 점은 2개 이상 ${MAX_SHARE_POINTS}개 이하여야 합니다`);
  }

  const points: DistancePoint[] = [];
  for (const item of rawPoints) {
    if (typeof item !== "object" || item === null) return fail("기록 점의 모양이 올바르지 않습니다");
    const { t, d } = item as Record<string, unknown>;
    if (typeof t !== "number" || typeof d !== "number" || !Number.isFinite(t) || !Number.isFinite(d) || t < 0 || d < 0) {
      return fail("기록 점의 시간과 거리는 0 이상의 숫자여야 합니다");
    }
    points.push({ t: round1(t), d: round1(d) });
  }

  if (points[0].t !== 0 || points[0].d !== 0) return fail("첫 점은 (0초, 0m)여야 합니다");
  for (let i = 1; i < points.length; i++) {
    if (points[i].t <= points[i - 1].t) return fail("시간은 앞으로만 흘러야 합니다");
    if (points[i].d < points[i - 1].d) return fail("누적 거리는 줄어들 수 없습니다");
    const segmentDistance = points[i].d - points[i - 1].d;
    const segmentSec = points[i].t - points[i - 1].t;
    if (segmentDistance > 0 && (segmentSec / segmentDistance) * 1000 < FASTEST_SEGMENT_SEC_PER_KM) {
      return fail("사람이 달릴 수 없는 속도의 구간이 있습니다");
    }
  }

  const last = points[points.length - 1];
  if (Math.abs(last.d - distance) > 1) return fail("마지막 점의 거리가 완주 거리와 같아야 합니다");
  const pace = (last.t / last.d) * 1000;
  if (pace < MIN_PACE_SEC_PER_KM || pace > MAX_PACE_SEC_PER_KM) return fail("평균 페이스가 올바른 범위를 벗어났습니다");

  return {
    ok: true,
    value: {
      completedDistanceM: distance,
      totalElevationGainM: typeof elevation === "number" ? round1(elevation) : null,
      points,
    },
  };
}
