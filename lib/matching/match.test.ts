// 역전 예측 매칭(lib/matching/match.ts) 시험
import { describe, expect, it } from "vitest";
import type { RunRecord } from "../record";
import { virtualRunners } from "../runners";

/** 처음 만든 가상 러너 9명(01~09). 느리거나 빠른 쪽을 채우려고 뒤에 더한 러너는 뺀다 */
const ORIGINAL_NINE = virtualRunners.slice(0, 9);
import { LATE_REVERSAL_FRACTION, matchOpponent, MATCH_PACE_RANGE_SEC } from "./match";

function makeRecord(id: string, avgPace: number, ratios: number[], options: { order?: number; elevation?: number | null; totalM?: number } = {}): RunRecord {
  const totalM = options.totalM ?? 5000;
  const points = [{ t: 0, d: 0 }];
  let t = 0;
  ratios.forEach((ratio, i) => {
    t += (totalM / ratios.length / 1000) * avgPace * ratio;
    points.push({ t, d: (totalM / ratios.length) * (i + 1) });
  });
  return {
    id,
    source: "virtual",
    registrationOrder: options.order ?? 1,
    completedDistanceM: totalM,
    totalElevationGainM: options.elevation === undefined ? 0 : options.elevation,
    points,
  };
}

const FLAT = [1, 1, 1, 1];
const LATE_SPURT = [1.08, 1.03, 0.97, 0.92]; // 초반에 내가 앞서고 후반에 따라잡힌다
const EARLY_SPRINT = [0.9, 0.97, 1.04, 1.09];

describe("matchOpponent · 후보 조건", () => {
  it("페이스 ±15초/km 밖의 기록은 역전이 예상돼도 고르지 않는다", () => {
    const far = makeRecord("멀다", 330 + MATCH_PACE_RANGE_SEC + 5, LATE_SPURT);
    const near = makeRecord("가깝다", 330, FLAT);
    const result = matchOpponent([far, near], { distanceM: 5000, paceSecPerKm: 330 });
    expect(result?.opponent.id).toBe("가깝다");
    expect(result?.kind).toBe("closest");
  });

  it("대결 거리보다 짧게 완주한 기록은 후보가 아니다", () => {
    const short = makeRecord("짧다", 330, LATE_SPURT, { totalM: 3000 });
    expect(matchOpponent([short], { distanceM: 5000, paceSecPerKm: 330 })).toBeNull();
  });

  it("5km 기록은 3km 대결의 후보가 된다", () => {
    const record = makeRecord("오km", 325, LATE_SPURT);
    expect(matchOpponent([record], { distanceM: 3000, paceSecPerKm: 330 })?.opponent.id).toBe("오km");
  });
});

describe("matchOpponent · 우선순위", () => {
  it("역전이 예상되는 상대를 역전이 없는 상대보다 먼저 고른다", () => {
    const flat = makeRecord("일정", 330, FLAT);
    const spurt = makeRecord("스퍼트", 325, LATE_SPURT);
    const result = matchOpponent([flat, spurt], { distanceM: 5000, paceSecPerKm: 330 });
    expect(result).toMatchObject({ kind: "reversal" });
    expect(result?.opponent.id).toBe("스퍼트");
    expect(result?.forecast.count).toBe(1);
    expect(result?.forecast.lastAtFraction).toBeGreaterThanOrEqual(LATE_REVERSAL_FRACTION);
  });

  it("역전이 초반에만 있는 상대는 '중반 이후' 조건에 맞지 않아 가장 가까운 기록 쪽으로 간다", () => {
    // 상대가 초반에 아주 빠르다가 곧 내가 앞서는 모양(역전이 대결 거리의 앞쪽에서 끝난다)
    const earlyOnly = makeRecord("초반만", 330, [0.7, 1.1, 1.1, 1.1]);
    const flat = makeRecord("일정", 331, FLAT);
    const result = matchOpponent([earlyOnly, flat], { distanceM: 5000, paceSecPerKm: 330 });
    expect(result?.kind).toBe("closest");
  });

  it("예상 역전이 같으면 상승 고도가 내 고도와 가까운 기록을 먼저 고른다", () => {
    const a = makeRecord("고도50", 325, LATE_SPURT, { elevation: 50, order: 5 });
    const b = makeRecord("고도10", 325, LATE_SPURT, { elevation: 10, order: 1 });
    const result = matchOpponent([a, b], { distanceM: 5000, paceSecPerKm: 330, myElevationGainM: 15 });
    expect(result?.opponent.id).toBe("고도10");
  });

  it("고도 정보가 없으면(상대 또는 나) 고도 비교는 하지 않고 최근에 등록된 기록을 고른다", () => {
    const old = makeRecord("오래됨", 325, LATE_SPURT, { elevation: 10, order: 1 });
    const recent = makeRecord("최근", 325, LATE_SPURT, { elevation: null, order: 9 });
    expect(matchOpponent([old, recent], { distanceM: 5000, paceSecPerKm: 330, myElevationGainM: 10 })?.opponent.id).toBe("오래됨");
    expect(matchOpponent([old, recent], { distanceM: 5000, paceSecPerKm: 330, myElevationGainM: null })?.opponent.id).toBe("최근");
  });

  it("예상 역전 횟수가 더 많은 상대를 먼저 고른다", () => {
    const one = makeRecord("한번", 325, LATE_SPURT);
    const many = makeRecord("여러번", 329, [1.06, 0.94, 1.06, 0.94]);
    expect(matchOpponent([one, many], { distanceM: 5000, paceSecPerKm: 330 })?.opponent.id).toBe("여러번");
  });
});

describe("matchOpponent · 후보가 없을 때", () => {
  it("역전이 예상되는 후보가 없으면 평균 페이스 차이가 가장 작은 기록으로 매칭하고 알린다", () => {
    const a = makeRecord("a", 335, FLAT);
    const b = makeRecord("b", 322, FLAT);
    const result = matchOpponent([a, b], { distanceM: 5000, paceSecPerKm: 330 });
    expect(result).toMatchObject({ kind: "closest" });
    expect(result?.opponent.id).toBe("a"); // 5초 차이 < 8초 차이
    expect(result?.paceDiffSecPerKm).toBeCloseTo(5, 6);
  });

  it("±15초/km 안에 후보가 하나도 없어도 같은 거리 기록 중 가장 가까운 것으로 매칭한다", () => {
    const result = matchOpponent([makeRecord("멀다", 400, FLAT)], { distanceM: 5000, paceSecPerKm: 300 });
    expect(result).toMatchObject({ kind: "closest" });
  });

  it("기록이 하나도 없으면 null이다", () => {
    expect(matchOpponent([], { distanceM: 5000, paceSecPerKm: 330 })).toBeNull();
  });
});

describe("matchOpponent · 내 프로필", () => {
  it("내 프로필이 주어지면 그 모양으로 겹쳐 본다(기록 없는 사용자는 일정한 페이스)", () => {
    // 나도 상대와 같은 초반 질주형이면 둘의 격차 부호가 바뀌지 않아 역전이 없다
    const sprint = makeRecord("초반질주", 332, EARLY_SPRINT);
    const same = { distanceM: 5000, avgPaceSecPerKm: 330, ratios: EARLY_SPRINT };
    expect(matchOpponent([sprint], { distanceM: 5000, paceSecPerKm: 330, myProfile: same })?.kind).toBe("closest");
    expect(matchOpponent([sprint], { distanceM: 5000, paceSecPerKm: 330 })?.kind).toBe("reversal");
  });
});

describe("가상 러너 9명으로 매칭 (결과가 매번 같다)", () => {
  it("같은 입력이면 항상 같은 상대가 나온다", () => {
    const first = matchOpponent(ORIGINAL_NINE, { distanceM: 5000, paceSecPerKm: 320 });
    for (let i = 0; i < 5; i++) {
      expect(matchOpponent(ORIGINAL_NINE, { distanceM: 5000, paceSecPerKm: 320 })?.opponent.id).toBe(first?.opponent.id);
    }
    expect(first?.opponent.id).toBe("가상러너-03");
  });

  it("5:20/km 5km는 가상러너-03(초반 질주형)과 매칭되어 예상 역전이 1회다", () => {
    const result = matchOpponent(ORIGINAL_NINE, { distanceM: 5000, paceSecPerKm: 320 });
    expect(result).toMatchObject({ kind: "reversal" });
    expect(result?.forecast.count).toBe(1);
  });
});
