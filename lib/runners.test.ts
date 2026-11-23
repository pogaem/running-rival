// 상대 기록 불러오기(lib/runners.ts) 시험
import { describe, expect, it } from "vitest";
import {
  assertUniqueRecords,
  campRecords,
  getOpponentRecords,
  parseRunRecords,
  virtualRunners,
} from "./runners";
import { timeToReachDistance, validateRunRecord, type RunRecord } from "./record";

/** 기록을 4구간(1250m씩)으로 나눠 구간별 페이스(초/km)를 구한다 */
function quarterPaces(record: RunRecord): number[] {
  const paces: number[] = [];
  for (let q = 0; q < 4; q++) {
    const start = timeToReachDistance(record, q * 1250) as number;
    const end = timeToReachDistance(record, (q + 1) * 1250) as number;
    paces.push(((end - start) / 1250) * 1000);
  }
  return paces;
}

/** 4구간 페이스로 달리는 모양을 가려낸다 (기록에 적지 않는 라벨을 시험에서만 확인하려는 용도) */
function shapeOf(record: RunRecord): "일정형" | "초반 질주형" | "후반 스퍼트형" | "중반 처짐형" | "기타" {
  const [q1, q2, q3, q4] = quarterPaces(record);
  const average = (q1 + q2 + q3 + q4) / 4;
  const within = (value: number) => Math.abs(value - average) / average;
  if ([q1, q2, q3, q4].every((q) => within(q) < 0.02)) return "일정형";
  if (q1 < q2 && q2 < q3 && q3 < q4) return "초반 질주형";
  if (q1 > q2 && q2 > q3 && q3 > q4) return "후반 스퍼트형";
  if (q2 > q1 && q3 > q4 && q2 > average && q3 > average) return "중반 처짐형";
  return "기타";
}

describe("가상 러너", () => {
  it("5~10명이다", () => {
    expect(virtualRunners.length).toBeGreaterThanOrEqual(5);
    expect(virtualRunners.length).toBeLessThanOrEqual(10);
  });

  it("모두 기록 모양을 지킨다", () => {
    for (const record of virtualRunners) {
      expect(validateRunRecord(record)).toEqual([]);
      expect(record.source).toBe("virtual");
    }
  });

  it("실제 이름 대신 익명 이름표를 쓰고 서로 겹치지 않는다", () => {
    const ids = virtualRunners.map((record) => record.id);
    for (const id of ids) expect(id).toMatch(/^가상러너-\d{2}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모두 5km를 완주해서 3km 대결과 5km 대결 모두에 쓸 수 있다", () => {
    for (const record of virtualRunners) {
      expect(record.completedDistanceM).toBe(5000);
      expect(timeToReachDistance(record, 3000)).not.toBeNull();
      expect(timeToReachDistance(record, 5000)).not.toBeNull();
    }
  });

  it("평균 페이스가 서로 다양하다 (가장 빠른 러너와 느린 러너가 60초/km 넘게 차이난다)", () => {
    const paces = virtualRunners.map(
      (record) => (record.points[record.points.length - 1].t / record.completedDistanceM) * 1000,
    );
    expect(Math.max(...paces) - Math.min(...paces)).toBeGreaterThan(60);
  });

  it("달리는 모양 네 가지가 모두 있다", () => {
    const shapes = new Set(virtualRunners.map(shapeOf));
    expect(shapes).toContain("일정형");
    expect(shapes).toContain("초반 질주형");
    expect(shapes).toContain("후반 스퍼트형");
    expect(shapes).toContain("중반 처짐형");
    expect(shapes).not.toContain("기타");
  });

  it("고도 정보가 없는 러너(null)와 있는 러너가 섞여 있다", () => {
    expect(virtualRunners.some((record) => record.totalElevationGainM === null)).toBe(true);
    expect(virtualRunners.some((record) => (record.totalElevationGainM ?? -1) >= 0)).toBe(true);
  });

  it("좌표나 날짜, 이름 같은 칸이 없다", () => {
    for (const record of virtualRunners) {
      expect(Object.keys(record).sort()).toEqual(
        ["completedDistanceM", "id", "points", "registrationOrder", "source", "totalElevationGainM"],
      );
      for (const point of record.points) expect(Object.keys(point).sort()).toEqual(["d", "t"]);
    }
  });
});

describe("캠프 참가자 기록", () => {
  it("아직 동의받은 기록이 없으면 빈 목록이고, 있으면 형식을 지킨다", () => {
    expect(Array.isArray(campRecords)).toBe(true);
    for (const record of campRecords) {
      expect(validateRunRecord(record)).toEqual([]);
      expect(record.source).toBe("camp");
    }
  });
});

describe("대결 상대 전체", () => {
  it("가상 러너가 모두 들어 있고 이름표·등록 순번이 겹치지 않는다", () => {
    const all = getOpponentRecords();
    expect(all.length).toBeGreaterThanOrEqual(virtualRunners.length);
    expect(() => assertUniqueRecords(all)).not.toThrow();
  });

  it("이름표나 등록 순번이 겹치면 오류를 던진다", () => {
    const [first] = virtualRunners;
    expect(() => assertUniqueRecords([first, { ...first, registrationOrder: 99 }])).toThrow("이름표");
    expect(() => assertUniqueRecords([first, { ...first, id: "가상러너-99" }])).toThrow("등록 순번");
  });
});

describe("parseRunRecords (파일 내용 검사)", () => {
  it("목록이 아니면 오류를 던진다", () => {
    expect(() => parseRunRecords({}, "virtual", "시험 파일")).toThrow("기록 목록");
  });

  it("출처가 다르면 오류를 던진다", () => {
    expect(() => parseRunRecords(virtualRunners, "camp", "시험 파일")).toThrow("출처");
  });

  it("기록 모양이 아니면 몇 번째인지 알려 준다", () => {
    expect(() => parseRunRecords([{ id: 3 }], "virtual", "시험 파일")).toThrow("1번째 기록");
  });

  it("기록 내용이 잘못되면 무엇이 문제인지 알려 준다", () => {
    const broken = { ...virtualRunners[0], completedDistanceM: 1234 };
    expect(() => parseRunRecords([broken], "virtual", "시험 파일")).toThrow("완주 거리");
  });
});
