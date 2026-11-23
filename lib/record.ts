// 기록 데이터 형식 (DESIGN.md 3번 "데이터 형식")
// 상대 기록, 가상 러너, 내 기록이 모두 이 모양을 쓴다.
// 위치(GPS 좌표)와 이동 경로는 담지 않고, "시간별 누적 거리"만 담는다.

/** 기록의 출처: 가상 러너 / 캠프 참가자 / 나 / 다른 사용자가 동의하고 공유한 기록 */
export type RunSource = "virtual" | "camp" | "mine" | "shared";

/** 시간별 누적 거리의 한 점: 출발 후 t초 시점에 d미터를 달렸다 */
export type DistancePoint = {
  /** 출발 후 지난 시간(초) */
  t: number;
  /** 출발 후 달린 누적 거리(미터) */
  d: number;
};

export type RunRecord = {
  /** 익명 이름표. 실제 이름은 담지 않는다 */
  id: string;
  source: RunSource;
  /** 등록 순번. 날짜와 시작 시각 대신 "최근에 등록된 기록"을 가리는 데 쓴다 (1부터) */
  registrationOrder: number;
  /** 완주 거리(미터). 5km 기록도 3km 대결에 쓸 수 있어서 "대결 거리"가 아니라 "완주 거리"로 적는다 */
  completedDistanceM: number;
  /** 총 상승 고도(미터). 기기가 고도를 주지 않았으면 null("고도 정보 없음") */
  totalElevationGainM: number | null;
  /** 시간별 누적 거리. 시간 순서대로 (0초, 0m)에서 시작한다 */
  points: DistancePoint[];
};

/** 완주 거리와 마지막 점의 거리가 이 값(미터) 이하로 다르면 같은 것으로 본다 */
const DISTANCE_TOLERANCE_M = 1;

/**
 * 기록이 약속된 모양을 지키는지 검사한다.
 * 문제가 없으면 빈 목록을, 있으면 문제를 한국어 문장으로 돌려준다.
 */
export function validateRunRecord(record: RunRecord): string[] {
  const problems: string[] = [];
  const { points } = record;

  if (record.id.trim() === "") {
    problems.push("익명 이름표(id)가 비어 있다");
  }
  if (!Number.isInteger(record.registrationOrder) || record.registrationOrder < 1) {
    problems.push("등록 순번은 1 이상의 정수여야 한다");
  }
  if (
    record.totalElevationGainM !== null &&
    (!Number.isFinite(record.totalElevationGainM) || record.totalElevationGainM < 0)
  ) {
    problems.push("총 상승 고도는 0 이상이거나 null(고도 정보 없음)이어야 한다");
  }

  if (points.length < 2) {
    problems.push("누적 거리 점이 2개 이상 있어야 한다");
    return problems;
  }

  if (points[0].t !== 0 || points[0].d !== 0) {
    problems.push("첫 점은 (0초, 0m)여야 한다");
  }
  for (let i = 1; i < points.length; i++) {
    if (points[i].t <= points[i - 1].t) {
      problems.push(`${i + 1}번째 점의 시간이 앞 점보다 커야 한다`);
    }
    if (points[i].d < points[i - 1].d) {
      problems.push(`${i + 1}번째 점의 누적 거리가 앞 점보다 줄어들면 안 된다`);
    }
  }

  const lastDistance = points[points.length - 1].d;
  if (Math.abs(record.completedDistanceM - lastDistance) > DISTANCE_TOLERANCE_M) {
    problems.push("완주 거리는 마지막 점의 누적 거리와 같아야 한다");
  }

  return problems;
}

/**
 * t초 시점의 누적 거리(미터)를 구한다. 점과 점 사이는 직선으로 이어서 계산한다.
 * 출발 전(0초 이하)은 0m, 기록이 끝난 뒤는 완주 거리를 그대로 돌려준다.
 */
export function distanceAtTime(record: RunRecord, t: number): number {
  const { points } = record;
  const last = points[points.length - 1];
  if (t <= 0) return 0;
  if (t >= last.t) return last.d;

  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1];
    const after = points[i];
    if (t <= after.t) {
      const ratio = (t - before.t) / (after.t - before.t);
      return before.d + ratio * (after.d - before.d);
    }
  }
  return last.d;
}

/**
 * 누적 거리가 distanceM(미터)에 처음 닿은 시간(초)을 구한다.
 * "상대 기록은 대결 거리에 도달한 시점까지만 쓴다"는 규칙에 쓴다.
 * 끝까지 닿지 못하면 null을 돌려준다.
 */
export function timeToReachDistance(record: RunRecord, distanceM: number): number | null {
  const { points } = record;
  if (distanceM <= 0) return 0;

  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1];
    const after = points[i];
    if (after.d >= distanceM) {
      const ratio = (distanceM - before.d) / (after.d - before.d);
      return before.t + ratio * (after.t - before.t);
    }
  }
  return null;
}
