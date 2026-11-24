// 자동 출발 감지 시험: 서 있을 때 위치가 튀어도 출발하지 않고, 실제로 뛰기 시작하면 출발한다
import { describe, expect, it } from "vitest";
import { METERS_PER_DEGREE_LAT } from "../geo";
import { AUTO_START_ACCURACY_FACTOR, AUTO_START_COUNT, AUTO_START_MAX_ACCURACY_M, AUTO_START_MAX_SPEED_MPS, AUTO_START_MIN_SPEED_MPS, AUTO_START_WINDOW_SEC } from "../config";
import { createAutoStart } from "./auto-start";
import type { PositionSample } from "./types";

const OPTIONS = {
  maxAccuracyM: AUTO_START_MAX_ACCURACY_M,
  minSpeedMps: AUTO_START_MIN_SPEED_MPS,
  maxSpeedMps: AUTO_START_MAX_SPEED_MPS,
  windowSec: AUTO_START_WINDOW_SEC,
  count: AUTO_START_COUNT,
  accuracyFactor: AUTO_START_ACCURACY_FACTOR,
};
const M = 1 / METERS_PER_DEGREE_LAT; // 위도 1m
const at = (t: number, northM: number, accuracyM = 8): PositionSample => ({ t, lat: 37.5 + northM * M, lon: 127, accuracyM, ele: null });

function firstStart(samples: PositionSample[]): number | null {
  const detector = createAutoStart(OPTIONS);
  for (const s of samples) if (detector.push(s)) return s.t;
  return null;
}

describe("자동 출발 감지", () => {
  it("서 있는데 위치가 8~10m씩 튀어도(정확도 30m) 출발하지 않는다", () => {
    const jitter = [0, 9, -8, 10, -9, 8, -10, 9, 0, 10, -8, 9, -9, 8, 0, 10, -10, 9, -8, 10, 0, 9, -9, 8, -10, 10, 0, 8, -8, 9];
    const samples = jitter.map((m, i) => at(i, m, 25));
    expect(firstStart(samples)).toBeNull();
  });

  it("초속 3m로 뛰기 시작하면 몇 초 안에 출발한다", () => {
    const samples = Array.from({ length: 20 }, (_, i) => at(i, i < 5 ? 0 : (i - 5) * 3));
    const start = firstStart(samples);
    expect(start).not.toBeNull();
    expect(start as number).toBeLessThanOrEqual(12);
  });

  it("걷는 속도(초속 1.2m)는 출발이 아니다", () => {
    const samples = Array.from({ length: 30 }, (_, i) => at(i, i * 1.2));
    expect(firstStart(samples)).toBeNull();
  });

  it("정확도가 30m보다 나쁜 점은 쓰지 않는다", () => {
    const samples = Array.from({ length: 20 }, (_, i) => at(i, i * 3, 50));
    expect(firstStart(samples)).toBeNull();
  });

  it("이동 거리(4초에 12m)가 두 점의 평균 오차 반경(15m)보다 작으면 출발이 아니다", () => {
    const samples = Array.from({ length: 20 }, (_, i) => at(i, i * 3, 15));
    expect(firstStart(samples)).toBeNull();
  });
});
