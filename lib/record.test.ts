// 기록 데이터 형식(lib/record.ts) 시험
import { describe, expect, it } from "vitest";
import {
  distanceAtTime,
  timeToReachDistance,
  validateRunRecord,
  type RunRecord,
} from "./record";

/** 시험용 기록: 5km를 25분(1500초)에 완주 */
function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "러너-A",
    source: "virtual",
    registrationOrder: 1,
    completedDistanceM: 5000,
    totalElevationGainM: 30,
    points: [
      { t: 0, d: 0 },
      { t: 600, d: 2000 },
      { t: 1200, d: 4000 },
      { t: 1500, d: 5000 },
    ],
    ...overrides,
  };
}

describe("validateRunRecord (기록 모양 검사)", () => {
  it("올바른 기록은 문제가 없다", () => {
    expect(validateRunRecord(makeRecord())).toEqual([]);
  });

  it("고도 정보가 없는 기록(null)도 올바르다", () => {
    expect(validateRunRecord(makeRecord({ totalElevationGainM: null }))).toEqual([]);
  });

  it("첫 점이 (0초, 0m)가 아니면 문제로 잡는다", () => {
    const record = makeRecord({
      points: [
        { t: 5, d: 10 },
        { t: 600, d: 5000 },
      ],
    });
    expect(validateRunRecord(record)).toContain("첫 점은 (0초, 0m)여야 한다");
  });

  it("시간이 거꾸로 가면 문제로 잡는다", () => {
    const record = makeRecord({
      points: [
        { t: 0, d: 0 },
        { t: 600, d: 2000 },
        { t: 500, d: 5000 },
      ],
    });
    expect(validateRunRecord(record).join()).toContain("시간이 앞 점보다 커야 한다");
  });

  it("누적 거리가 줄어들면 문제로 잡는다", () => {
    const record = makeRecord({
      completedDistanceM: 1500,
      points: [
        { t: 0, d: 0 },
        { t: 600, d: 2000 },
        { t: 1200, d: 1500 },
      ],
    });
    expect(validateRunRecord(record).join()).toContain("줄어들면 안 된다");
  });

  it("완주 거리가 마지막 점과 다르면 문제로 잡는다", () => {
    expect(validateRunRecord(makeRecord({ completedDistanceM: 3000 }))).toContain(
      "완주 거리는 마지막 점의 누적 거리와 같아야 한다",
    );
  });

  it("점이 2개보다 적으면 문제로 잡는다", () => {
    expect(validateRunRecord(makeRecord({ points: [{ t: 0, d: 0 }] }))).toContain(
      "누적 거리 점이 2개 이상 있어야 한다",
    );
  });

  it("등록 순번이 0이거나 소수면 문제로 잡는다", () => {
    expect(validateRunRecord(makeRecord({ registrationOrder: 0 }))).toHaveLength(1);
    expect(validateRunRecord(makeRecord({ registrationOrder: 1.5 }))).toHaveLength(1);
  });
});

describe("distanceAtTime (시점의 누적 거리)", () => {
  it("점과 점 사이는 직선으로 이어서 구한다", () => {
    // 600초에 2000m, 1200초에 4000m → 900초는 3000m
    expect(distanceAtTime(makeRecord(), 900)).toBe(3000);
  });

  it("출발 전은 0m이다", () => {
    expect(distanceAtTime(makeRecord(), -10)).toBe(0);
    expect(distanceAtTime(makeRecord(), 0)).toBe(0);
  });

  it("기록이 끝난 뒤에는 완주 거리를 그대로 돌려준다", () => {
    expect(distanceAtTime(makeRecord(), 1500)).toBe(5000);
    expect(distanceAtTime(makeRecord(), 9999)).toBe(5000);
  });
});

describe("timeToReachDistance (거리에 닿은 시간)", () => {
  it("5km 기록이 3km에 닿은 시간을 구한다 (3km 대결에 쓸 수 있다)", () => {
    expect(timeToReachDistance(makeRecord(), 3000)).toBe(900);
  });

  it("완주 거리에는 마지막 시간에 닿는다", () => {
    expect(timeToReachDistance(makeRecord(), 5000)).toBe(1500);
  });

  it("기록보다 먼 거리에는 닿지 못해서 null이다", () => {
    expect(timeToReachDistance(makeRecord(), 6000)).toBeNull();
  });

  it("0m 이하는 0초이다", () => {
    expect(timeToReachDistance(makeRecord(), 0)).toBe(0);
  });
});
