// 차별점 검증 시뮬레이션(lib/simulation/rival-sim.ts) 시험
// 여기서는 "시뮬레이션이 약속대로 돌아가는가"만 본다. 어느 방식이 역전이 더 많은지는 단정하지 않는다.
import { describe, expect, it } from "vitest";
import { virtualRunners } from "../runners";
import { profileFromRecord } from "../matching/profile";
import { countReversals, jitterRecord, matchByPaceOnly, runSimulation, seededRandom } from "./rival-sim";

describe("시뮬레이션 재료", () => {
  it("같은 시드면 같은 기록이 나오고, 다른 시드면 다르다", () => {
    const base = virtualRunners[0];
    const a = jitterRecord(base, seededRandom(1), 0.03, 0.04);
    const b = jitterRecord(base, seededRandom(1), 0.03, 0.04);
    const c = jitterRecord(base, seededRandom(2), 0.03, 0.04);
    expect(a).toEqual(b);
    expect(a.points).not.toEqual(c.points);
    expect(a.points[a.points.length - 1].d).toBe(5000);
  });

  it("흔들기 0이면 기본형 그대로의 페이스와 모양이다", () => {
    const base = virtualRunners[2];
    const same = jitterRecord(base, seededRandom(3), 0, 0);
    const p0 = profileFromRecord(base, 5000)!;
    const p1 = profileFromRecord(same, 5000)!;
    expect(p1.avgPaceSecPerKm).toBeCloseTo(p0.avgPaceSecPerKm, 0);
    p1.ratios.forEach((r, i) => expect(r).toBeCloseTo(p0.ratios[i], 1));
  });

  it("페이스만 보고 고르면 평균 페이스가 가장 가까운 상대가 나온다", () => {
    const picked = matchByPaceOnly(virtualRunners.slice(0, 9), 5000, 331);
    expect(picked?.id).toBe("가상러너-03"); // 5:30
  });

  it("같은 두 기록을 다시 재생하면 역전 횟수가 같다", () => {
    expect(countReversals(virtualRunners[1], virtualRunners[2], 5000)).toBe(countReversals(virtualRunners[1], virtualRunners[2], 5000));
  });
});

describe("runSimulation", () => {
  it("같은 설정이면 같은 결과이고, 표본 수는 러너 수 × 거리 2 × 반복 횟수다", () => {
    const a = runSimulation({ trials: 5 });
    const b = runSimulation({ trials: 5 });
    expect(a).toEqual(b);
    expect(a.races).toBe(virtualRunners.length * 2 * 5);
    expect(a.pacesOnly.meanReversals).toBeGreaterThanOrEqual(0);
    expect(a.prediction.shareWithReversal).toBeLessThanOrEqual(1);
  }, 30000); // 계산이 많아 컴퓨터가 바쁠 때 5초를 넘을 수 있다
});
