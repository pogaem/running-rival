// 캠프 참가자 기록 변환(lib/camp-import.ts) 시험
import { describe, expect, it } from "vitest";
import { toCampRecord, type RawSample } from "./camp-import";
import { validateRunRecord } from "./record";

/** 적도에서 경도 1도 ≈ 111,195m. 초속 3m로 직선 달리기를 만든다 */
const METERS_PER_DEGREE = 111194.9;

function straightRun(seconds: number, withElevation: boolean): RawSample[] {
  const samples: RawSample[] = [];
  for (let t = 0; t <= seconds; t++) {
    samples.push({
      t: 1_700_000_000 + t, // 실제 시각처럼 큰 값: 변환하면 0초부터 시작해야 한다
      lat: 0,
      lon: (3 * t) / METERS_PER_DEGREE,
      // 처음 100초는 10m 올라가고, 다음 100초는 10m 내려오고, 그 뒤는 평지
      ele: withElevation ? (t <= 100 ? t * 0.1 : t <= 200 ? 10 - (t - 100) * 0.1 : 0) : undefined,
    });
  }
  return samples;
}

const META = { id: "참가자-A", registrationOrder: 100 };

describe("toCampRecord (위치 기록 → 참가자 기록)", () => {
  it("1200m를 달린 기록을 250m마다의 시간으로 줄인다", () => {
    const record = toCampRecord(straightRun(400, true), META);
    expect(validateRunRecord(record)).toEqual([]);
    expect(record.source).toBe("camp");
    expect(record.completedDistanceM).toBeCloseTo(1200, 0);
    // 250m 지점은 초속 3m로 약 83.3초
    expect(record.points[1].d).toBe(250);
    expect(record.points[1].t).toBeCloseTo(83.3, 0);
    // 250, 500, 750, 1000 + 시작 + 끝 = 6개
    expect(record.points).toHaveLength(6);
  });

  it("출발 시각을 지우고 0초부터 시작한다", () => {
    const record = toCampRecord(straightRun(400, true), META);
    expect(record.points[0]).toEqual({ t: 0, d: 0 });
    expect(record.points[record.points.length - 1].t).toBeLessThan(1000);
  });

  it("좌표·날짜·이름 같은 칸이 결과에 없다", () => {
    const record = toCampRecord(straightRun(400, true), META);
    expect(Object.keys(record).sort()).toEqual(
      ["completedDistanceM", "id", "points", "registrationOrder", "source", "totalElevationGainM"],
    );
    for (const point of record.points) expect(Object.keys(point).sort()).toEqual(["d", "t"]);
  });

  it("올라간 높이만 더해서 총 상승 고도를 구한다", () => {
    const record = toCampRecord(straightRun(400, true), META);
    expect(record.totalElevationGainM).toBeCloseTo(10, 0);
  });

  it("고도가 하나라도 없으면 '고도 정보 없음'(null)이다", () => {
    expect(toCampRecord(straightRun(400, false), META).totalElevationGainM).toBeNull();
  });

  it("점이 2개보다 적으면 오류를 던진다", () => {
    expect(() => toCampRecord([{ t: 0, lat: 0, lon: 0 }], META)).toThrow("2개 이상");
  });

  it("시간이 거꾸로 가면 오류를 던진다", () => {
    const samples: RawSample[] = [
      { t: 10, lat: 0, lon: 0 },
      { t: 5, lat: 0, lon: 0.001 },
    ];
    expect(() => toCampRecord(samples, META)).toThrow("시간이 앞 점보다 커야");
  });

  it("250m보다 짧은 기록도 변환된다", () => {
    const record = toCampRecord(straightRun(50, false), META);
    expect(validateRunRecord(record)).toEqual([]);
    expect(record.points).toHaveLength(2);
  });
});
