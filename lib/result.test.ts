import { describe, expect, it } from "vitest";
import { virtualRunners } from "./runners";
import {
  appendGapPoint,
  buildRaceSummary,
  computeGraphGeometry,
  describeElevation,
  formatMargin,
  parseSummary,
  serializeSummary,
  type GapPoint,
  type RaceSummary,
} from "./result";

const settings = { source: "demo", distanceM: 3000, paceSecPerKm: 320, intensity: "normal" } as const;
const opponent = virtualRunners.find((r) => r.id === "가상러너-03")!;

function makeSummary(partial: Partial<RaceSummary> = {}): RaceSummary {
  return {
    settings,
    opponent: { id: opponent.id, source: "virtual", elevationGainM: 40 },
    won: true,
    myTimeSec: 1600,
    opponentTimeSec: 1650,
    myElevationGainM: null,
    gapSeries: [
      { t: 0, gapM: 0 },
      { t: 400, gapM: -30 },
      { t: 800, gapM: 15 },
      { t: 1600, gapM: 60 },
    ],
    reversals: [{ t: 700, type: "overtake" }],
    ...partial,
  };
}

describe("appendGapPoint", () => {
  it("일정 시간이 지나야 새 점을 넣는다", () => {
    const series: GapPoint[] = [];
    appendGapPoint(series, { t: 0, gapM: 0 });
    appendGapPoint(series, { t: 1, gapM: 1 });
    appendGapPoint(series, { t: 2, gapM: 2 });
    expect(series.map((p) => p.t)).toEqual([0, 2]);
  });
});

describe("buildRaceSummary", () => {
  it("결승 이벤트와 상대 기록으로 승패·시간·역전을 요약한다", () => {
    const summary = buildRaceSummary({
      settings,
      opponent,
      finishEvent: { type: "finish", t: 1600, won: true },
      gapSeries: [{ t: 0, gapM: 0 }],
      events: [
        { type: "km", t: 320, km: 1 },
        { type: "overtake", t: 700, gapM: 12 },
        { type: "overtaken", t: 900, gapM: -11 },
      ],
      myElevationGainM: 12,
    })!;
    expect(summary).toMatchObject({ won: true, myTimeSec: 1600, myElevationGainM: 12, opponent: { id: "가상러너-03", elevationGainM: 40 } });
    expect(summary.opponentTimeSec).toBeCloseTo(943, 0); // 상대 기록에서 3km 지점에 닿는 시간
    expect(summary.reversals).toEqual([
      { t: 700, type: "overtake" },
      { t: 900, type: "overtaken" },
    ]);
  });

  it("개인정보가 될 만한 값(좌표·이름)이 요약에 들어 있지 않다", () => {
    const text = serializeSummary(makeSummary());
    expect(text).not.toMatch(/lat|lon|latitude|longitude/);
  });
});

describe("serializeSummary · parseSummary", () => {
  it("저장했다 읽으면 같다", () => {
    const summary = makeSummary();
    expect(parseSummary(serializeSummary(summary))).toEqual(summary);
  });

  it("없거나 망가진 글은 null이다", () => {
    expect(parseSummary(null)).toBeNull();
    expect(parseSummary("")).toBeNull();
    expect(parseSummary("{망가짐")).toBeNull();
    expect(parseSummary(JSON.stringify({ won: "네" }))).toBeNull();
  });
});

describe("describeElevation · formatMargin", () => {
  it("고도 글", () => {
    expect(describeElevation(null, 3000)).toBe("고도 정보 없음");
    expect(describeElevation(3.2, 3000)).toBe("평지 (+3m)");
    expect(describeElevation(40, 3000)).toBe("오르막 +40m");
    expect(describeElevation(12, 3000)).toBe("평지 (+12m)"); // 1km당 4m
    expect(describeElevation(30, 3000)).toBe("오르막 +30m"); // 1km당 10m
  });

  it("시간 차이 글", () => {
    expect(formatMargin(12.4)).toBe("12초");
    expect(formatMargin(-7.6)).toBe("8초");
    expect(formatMargin(0.2)).toBe("1초 미만");
  });
});

describe("computeGraphGeometry", () => {
  it("내가 앞서면 위쪽, 뒤처지면 아래쪽에 그려진다", () => {
    const geometry = computeGraphGeometry(makeSummary(), 300, 100);
    const [start, behind, ahead] = geometry.line;
    expect(start.y).toBe(geometry.zeroY);
    expect(behind.y).toBeGreaterThan(geometry.zeroY); // 상대가 앞 = 아래
    expect(ahead.y).toBeLessThan(geometry.zeroY); // 내가 앞 = 위
    expect(geometry.line[geometry.line.length - 1].x).toBe(300); // 끝은 오른쪽 끝
  });

  it("격차 범위는 최소 ±5m이고 데이터가 크면 넓어진다", () => {
    expect(computeGraphGeometry(makeSummary({ gapSeries: [{ t: 0, gapM: 2 }] }), 100, 50).rangeM).toBe(5);
    expect(computeGraphGeometry(makeSummary(), 100, 50).rangeM).toBe(60);
  });

  it("역전 표시는 그 시각의 x에 놓인다", () => {
    const geometry = computeGraphGeometry(makeSummary(), 1600, 100);
    expect(geometry.markers).toEqual([{ x: 700, type: "overtake" }]);
  });

  it("점이 없어도 오류 없이 빈 선이 된다", () => {
    expect(computeGraphGeometry(makeSummary({ gapSeries: [], reversals: [] }), 100, 50).line).toEqual([]);
  });
});

describe("buildAnalysis", () => {
  it("승패와 역전 횟수를 문장으로 돌려준다", async () => {
    const { buildAnalysis } = await import("./result");
    const lines = buildAnalysis({
      settings: { distanceM: 1000, paceSecPerKm: 360, intensity: "normal", source: "demo" },
      opponent: { id: "a", source: "virtual", elevationGainM: null },
      won: true,
      myTimeSec: 300,
      opponentTimeSec: 312,
      myElevationGainM: null,
      gapSeries: [{ t: 0, gapM: 0 }, { t: 100, gapM: 20 }, { t: 300, gapM: 30 }],
      reversals: [{ t: 50, type: "overtake" }],
    } as never);
    expect(lines[0]).toContain("12초");
    expect(lines.join(" ")).toContain("1번");
  });
});
