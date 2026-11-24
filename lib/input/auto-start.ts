// 자동 출발 감지 (실제 GPS) — 서 있는데 위치가 튀어서 출발하는 것을 막는다
// 예전 방식은 "점 사이 속도가 3번 연속 달리기 속도"였다. 정확도가 나쁜 GPS는 서 있어도 몇 m씩 튀어서 이 조건이 맞을 수 있었다.
// 지금은 최근 몇 초 동안 "실제로 이동한 거리"를 본다: 처음 점과 마지막 점 사이가 두 점의 평균 오차 반경보다 멀고,
// 평균 속도가 달리기 범위일 때만 출발로 본다. 이 조건이 연속으로 몇 번 맞아야 한다.
// 계산만 한다. 화면·GPS를 모른다.
import { distanceBetweenM } from "../geo";
import type { PositionSample } from "./types";

export type AutoStartOptions = {
  /** 이 정확도(m)보다 나쁜 점은 쓰지 않는다 */
  maxAccuracyM: number;
  /** 달리기로 볼 평균 속도 범위(m/s) */
  minSpeedMps: number;
  maxSpeedMps: number;
  /** 이 시간(초) 만큼 떨어진 점끼리 비교한다 */
  windowSec: number;
  /** 연속으로 몇 번 맞아야 출발인가 */
  count: number;
  /** 이동한 거리는 두 점의 오차 반경 합의 몇 배(0.5 = 평균)보다 커야 하는가 */
  accuracyFactor: number;
};

export type AutoStart = {
  /** 점 하나를 넣는다. 출발로 판단되면 true */
  push(sample: PositionSample): boolean;
};

export function createAutoStart(options: AutoStartOptions): AutoStart {
  let recent: PositionSample[] = [];
  let hits = 0;
  return {
    push(sample) {
      if (!(sample.accuracyM <= options.maxAccuracyM)) return false;
      recent.push(sample);
      recent = recent.filter((p) => p.t >= sample.t - options.windowSec - 3);
      // windowSec 이상 전의 가장 가까운 점과 비교한다
      let base: PositionSample | null = null;
      for (const p of recent) {
        if (p.t <= sample.t - options.windowSec) base = p;
        else break;
      }
      if (!base) return false; // 아직 비교할 만큼 오래된 점이 없다
      const elapsed = sample.t - base.t;
      const moved = distanceBetweenM(base, sample);
      const speed = moved / elapsed;
      const farEnough = moved > (base.accuracyM + sample.accuracyM) * options.accuracyFactor;
      const running = speed >= options.minSpeedMps && speed <= options.maxSpeedMps;
      hits = farEnough && running ? hits + 1 : 0;
      return hits >= options.count;
    },
  };
}
