// 구간 프로필과 예상 역전(lib/matching/profile.ts) 시험
import { describe, expect, it } from "vitest";
import type { RunRecord } from "../record";
import { virtualRunners } from "../runners";
import { constantProfile, forecastReversals, profileFromRecord, timeAtDistance, type SegmentProfile } from "./profile";

/** 4구간 페이스 비율로 5km 기록을 만든다 */
function makeRecord(id: string, avgPace: number, ratios: number[], totalM = 5000): RunRecord {
  const points = [{ t: 0, d: 0 }];
  let t = 0;
  const segmentM = totalM / ratios.length;
  ratios.forEach((ratio, i) => {
    t += (segmentM / 1000) * avgPace * ratio;
    points.push({ t, d: segmentM * (i + 1) });
  });
  return { id, source: "virtual", registrationOrder: 1, completedDistanceM: totalM, totalElevationGainM: 0, points };
}

describe("profileFromRecord", () => {
  it("대결 거리를 4구간으로 나눠 평균 대비 비율을 구한다", () => {
    const profile = profileFromRecord(makeRecord("a", 330, [0.9, 0.97, 1.04, 1.09]), 5000)!;
    expect(profile.avgPaceSecPerKm).toBeCloseTo(330, 6);
    profile.ratios.forEach((ratio, i) => expect(ratio).toBeCloseTo([0.9, 0.97, 1.04, 1.09][i], 6));
  });

  it("5km 기록을 3km 대결로 자르면 앞 3km만 쓴다", () => {
    const profile = profileFromRecord(makeRecord("a", 300, [0.8, 0.8, 1.2, 1.2]), 3000)!;
    // 앞 3km = 2.5km(0.8배) + 0.5km(1.2배)가 아니라 750m씩 4구간으로 다시 나눈다
    expect(profile.distanceM).toBe(3000);
    expect(profile.ratios).toHaveLength(4);
    expect(profile.ratios[0]).toBeLessThan(profile.ratios[3]);
    expect(profile.avgPaceSecPerKm).toBeCloseTo(300 * ((0.8 * 2.5 + 1.2 * 0.5) / 3), 4);
  });

  it("기록이 대결 거리에 닿지 못하면 null이다", () => {
    expect(profileFromRecord(makeRecord("a", 330, [1, 1, 1, 1], 3000), 5000)).toBeNull();
  });

  it("가상 러너 9명 모두 5km·3km 프로필이 만들어지고 비율 평균이 1이다", () => {
    for (const runner of virtualRunners) {
      for (const distance of [3000, 5000]) {
        const profile = profileFromRecord(runner, distance)!;
        expect(profile.ratios.reduce((a, b) => a + b, 0) / 4).toBeCloseTo(1, 6);
      }
    }
  });
});

describe("timeAtDistance", () => {
  it("일정한 페이스는 거리에 비례한다", () => {
    const profile = constantProfile(5000, 300);
    expect(timeAtDistance(profile, 0)).toBe(0);
    expect(timeAtDistance(profile, 1000)).toBeCloseTo(300, 6);
    expect(timeAtDistance(profile, 5000)).toBeCloseTo(1500, 6);
  });
});

describe("forecastReversals (예상 역전 횟수)", () => {
  const constant = constantProfile(5000, 330);
  const withRatios = (ratios: number[], avg = 330): SegmentProfile => ({ distanceM: 5000, avgPaceSecPerKm: avg, ratios });

  it("같은 일정한 페이스끼리는 역전이 없다", () => {
    expect(forecastReversals(constant, constant)).toEqual({ count: 0, lastAtFraction: null });
  });

  it("초반 질주형 상대는 초반에 앞서다 내가 앞서는 역전 1회가 예상된다", () => {
    const forecast = forecastReversals(constant, withRatios([0.9, 0.97, 1.04, 1.09], 332));
    expect(forecast.count).toBe(1);
    expect(forecast.lastAtFraction).toBeGreaterThan(0.2);
    expect(forecast.lastAtFraction).toBeLessThan(1);
  });

  it("후반 스퍼트형 상대는 초반에 내가 앞서다 상대가 따라잡는 역전 1회가 예상된다", () => {
    const forecast = forecastReversals(constant, withRatios([1.08, 1.03, 0.97, 0.92], 325));
    expect(forecast.count).toBe(1);
  });

  it("앞선 쪽이 계속 바뀌면 역전이 여러 번 예상된다", () => {
    // 상대가 느렸다 빨랐다를 반복하며 조금 더 빠르다
    const forecast = forecastReversals(constant, withRatios([1.06, 0.94, 1.06, 0.94], 329));
    expect(forecast.count).toBeGreaterThanOrEqual(3);
  });

  it("거리가 다른 프로필끼리는 비교하지 않는다", () => {
    expect(() => forecastReversals(constantProfile(3000, 330), constant)).toThrow();
  });
});
