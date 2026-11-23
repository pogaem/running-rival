// 내 경기의 "시간별 누적 거리" 모으기 (PLAN.md 작업 24)
// 결승선을 지났을 때 공유할 수 있게, 250m마다 한 점만 남긴다. 위치 좌표는 받지 않고 거리와 시간만 본다.
import type { DistancePoint } from "./record";

export const TRACK_STEP_M = 250;

export type TrackRecorder = {
  /** 레이스 시간(초)과 누적 거리(m)를 넣는다 */
  add(t: number, distanceM: number): void;
  /** 지금까지 모은 점들 (0초, 0m에서 시작) */
  readonly points: DistancePoint[];
};

export function createTrackRecorder(stepM = TRACK_STEP_M): TrackRecorder {
  const points: DistancePoint[] = [{ t: 0, d: 0 }];
  let previous: DistancePoint = { t: 0, d: 0 };
  return {
    add(t, distanceM) {
      // 지난 점 이후에 넘어선 250m 단위마다, 두 샘플 사이를 직선으로 이어 그 시점의 시간을 구한다
      let next = (Math.floor(previous.d / stepM) + 1) * stepM;
      while (distanceM >= next && distanceM > previous.d && t > previous.t) {
        const ratio = (next - previous.d) / (distanceM - previous.d);
        points.push({ t: Math.round((previous.t + ratio * (t - previous.t)) * 10) / 10, d: next });
        next += stepM;
      }
      if (t > previous.t && distanceM >= previous.d) previous = { t, d: distanceM };
    },
    get points() {
      return points;
    },
  };
}
