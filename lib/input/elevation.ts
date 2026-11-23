// 총 상승 고도 재기 (PLAN.md 작업 17: 결과 화면의 "기록 조건")
// 위치 입력의 고도를 더해서, 올라간 높이의 합을 구한다. 고도 값의 작은 흔들림(GPS 고도는 잘 흔들린다)이 쌓이지 않게
// 기준 고도에서 5m 이상 벗어났을 때만 반영한다. 기기가 고도를 주지 않으면 null("고도 정보 없음").

/** 이만큼(미터) 이상 달라져야 고도가 바뀐 것으로 본다 (초안) */
export const ELEVATION_STEP_M = 5;

export type ElevationTracker = {
  /** 고도 한 점을 넣는다. 고도가 없으면(null) 건너뛴다 */
  update(ele: number | null): void;
  /** 지금까지의 총 상승 고도(미터). 고도 값을 한 번도 못 받았으면 null */
  readonly gainM: number | null;
};

export function createElevationTracker(): ElevationTracker {
  let reference: number | null = null;
  let gain = 0;
  return {
    update(ele) {
      if (ele === null || !Number.isFinite(ele)) return;
      if (reference === null) {
        reference = ele;
        return;
      }
      if (Math.abs(ele - reference) >= ELEVATION_STEP_M) {
        if (ele > reference) gain += ele - reference;
        reference = ele;
      }
    },
    get gainM() {
      return reference === null ? null : gain;
    },
  };
}
