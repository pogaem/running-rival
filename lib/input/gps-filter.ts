// GPS 보정 (PLAN.md 작업 15, DESIGN.md 2번 "위치 보정")
// 실제 GPS는 가끔 엉뚱한 곳으로 튀거나 정확도가 나빠진다. 그대로 거리를 더하면 거리가 부풀고 "헛역전"이 나온다.
//  1) 위치 정확도가 나쁜 점(오차 반경이 큰 점)은 버린다.
//  2) 마지막으로 받아들인 점에서 시속 25km를 넘는 속도로 움직인 점은 버린다(순간 이동).
//  3) 받아들인 점들은 최근 몇 개의 평균 위치로 다듬는다(이동 평균).
// 이 파일은 계산만 한다. 입력(GPS/데모)이나 화면을 모른다.
import { distanceBetweenM } from "../geo";
import type { PositionSample } from "./types";

/** 이보다 정확도 값(오차 반경, 미터)이 크면 버린다 (초안) */
export const MAX_ACCURACY_M = 30;
/** 이 속도(km/h)를 넘어 움직인 점은 순간 이동으로 보고 버린다 (PLAN: 시속 25km) */
export const MAX_SPEED_KMH = 25;
/** 이동 평균에 쓰는 최근 점의 개수 (초안) */
export const SMOOTHING_WINDOW = 5;
/** 이 시간(초) 넘게 점이 끊겼다 돌아오면 이동 평균을 처음부터 다시 시작한다 (끊기기 전 점들이 위치를 뒤로 끌지 않게) */
export const GAP_RESET_SEC = 3;

export type RejectReason = "accuracy" | "speed";

export type FilterResult =
  | { accepted: true; sample: PositionSample }
  | { accepted: false; reason: RejectReason };

export type FilterOptions = {
  maxAccuracyM?: number;
  maxSpeedKmh?: number;
  smoothingWindow?: number;
};

export type PositionFilter = {
  /** 점 하나를 넣는다. 받아들이면 다듬은 점을, 버리면 이유를 돌려준다 */
  push(sample: PositionSample): FilterResult;
  /** 지금까지 버린 점의 수 */
  readonly rejected: { accuracy: number; speed: number };
};

export function createPositionFilter(options: FilterOptions = {}): PositionFilter {
  const maxAccuracyM = options.maxAccuracyM ?? MAX_ACCURACY_M;
  const maxSpeedMps = ((options.maxSpeedKmh ?? MAX_SPEED_KMH) * 1000) / 3600;
  const windowSize = Math.max(1, Math.floor(options.smoothingWindow ?? SMOOTHING_WINDOW));

  /** 받아들인 원래 점들(다듬기 전). 마지막 점이 속도 비교의 기준이다 */
  let lastAccepted: PositionSample | null = null;
  const window: PositionSample[] = [];
  const rejected = { accuracy: 0, speed: 0 };

  return {
    rejected,

    push(sample) {
      if (!(sample.accuracyM <= maxAccuracyM)) {
        rejected.accuracy += 1;
        return { accepted: false, reason: "accuracy" };
      }

      if (lastAccepted) {
        const elapsedSec = sample.t - lastAccepted.t;
        // 시간이 같거나 거꾸로 간 점은 속도를 잴 수 없다. 거리가 조금이라도 있으면 순간 이동으로 본다
        const moved = distanceBetweenM(lastAccepted, sample);
        const tooFast = elapsedSec > 0 ? moved / elapsedSec > maxSpeedMps : moved > 0;
        if (tooFast) {
          rejected.speed += 1;
          return { accepted: false, reason: "speed" };
        }
      }

      if (lastAccepted && sample.t - lastAccepted.t > GAP_RESET_SEC) window.length = 0;
      lastAccepted = sample;
      window.push(sample);
      if (window.length > windowSize) window.shift();

      const count = window.length;
      const lat = window.reduce((sum, p) => sum + p.lat, 0) / count;
      const lon = window.reduce((sum, p) => sum + p.lon, 0) / count;
      return { accepted: true, sample: { ...sample, lat, lon } };
    },
  };
}
