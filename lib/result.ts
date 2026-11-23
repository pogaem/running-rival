// 결과 화면의 자료 (PLAN.md 작업 17, DESIGN.md 1.3)
// 레이스가 끝나면 이 모양으로 요약해 이 기기의 sessionStorage에 잠깐 넣고, 결과 화면이 읽어 보여 준다.
// 위치 좌표나 이름은 담지 않는다: 시간·거리·격차 숫자와 상대의 익명 이름표뿐이다.
import type { RaceEvent } from "./engine/race-engine";
import type { RaceSettings } from "./race-settings";
import { timeToReachDistance, type DistancePoint, type RunRecord } from "./record";

/** 시간대별 격차 그래프의 한 점: 레이스 시간(초)과 격차(m, +는 내가 앞) */
export type GapPoint = { t: number; gapM: number };

export type RaceSummary = {
  settings: RaceSettings;
  opponent: {
    id: string;
    source: RunRecord["source"];
    /** 상대의 총 상승 고도(m). 모르면 null */
    elevationGainM: number | null;
  };
  /** 내가 이겼는가 */
  won: boolean;
  /** 내 기록(초) */
  myTimeSec: number;
  /** 상대가 대결 거리에 닿는 기록(초) */
  opponentTimeSec: number;
  /** 내 총 상승 고도(m). 고도 정보가 없으면 null */
  myElevationGainM: number | null;
  /** 격차 그래프 점들 */
  gapSeries: GapPoint[];
  /** 역전이 일어난 순간들 */
  reversals: { t: number; type: "overtake" | "overtaken" }[];
  /** 내 기록의 시간별 누적 거리(250m마다). 공유할 때만 쓴다. 위치 좌표는 없다 */
  myTrack?: DistancePoint[];
  /** 이 결과를 만든 레이스를 구분하는 값(끝난 시각). 다음 레이스의 결과 화면이 지난 상태를 물려받지 않게 한다 */
  raceId?: number;
  /** 내 기록을 공유했으면 그 이름표 (작업 24) */
  sharedId?: string;
  /** 전적·최고 기록에 반영한 뒤 채운다 (작업 18). 반영하지 못했으면 없다 */
  history?: {
    newBest: boolean;
    previousBestSec: number | null;
    rival: { wins: number; losses: number };
  };
};

/** 결과 요약을 담아 두는 sessionStorage 이름표 */
export const SUMMARY_STORAGE_KEY = "running-rival:last-result";

/** 격차 점을 이 간격(레이스 초)보다 촘촘하게는 모으지 않는다 */
export const GAP_SERIES_STEP_SEC = 2;

/** 격차 점 모으기: 마지막 점에서 일정 시간이 지났을 때만 새 점을 넣는다 */
export function appendGapPoint(series: GapPoint[], point: GapPoint, stepSec = GAP_SERIES_STEP_SEC): void {
  const last = series[series.length - 1];
  if (!last || point.t - last.t >= stepSec) series.push(point);
}

/** 레이스가 끝났을 때 결과 요약을 만든다. 상대 기록이 대결 거리에 닿지 못하면 null */
export function buildRaceSummary(input: {
  settings: RaceSettings;
  opponent: RunRecord;
  finishEvent: Extract<RaceEvent, { type: "finish" }>;
  gapSeries: GapPoint[];
  events: RaceEvent[];
  myElevationGainM: number | null;
  myTrack?: DistancePoint[];
}): RaceSummary | null {
  const opponentTimeSec = timeToReachDistance(input.opponent, input.settings.distanceM);
  if (opponentTimeSec === null) return null;
  return {
    settings: input.settings,
    opponent: {
      id: input.opponent.id,
      source: input.opponent.source,
      elevationGainM: input.opponent.totalElevationGainM,
    },
    won: input.finishEvent.won,
    myTimeSec: input.finishEvent.t,
    opponentTimeSec,
    myElevationGainM: input.myElevationGainM,
    gapSeries: input.gapSeries,
    ...(input.myTrack ? { myTrack: input.myTrack } : {}),
    reversals: input.events.flatMap((event) =>
      event.type === "overtake" || event.type === "overtaken" ? [{ t: event.t, type: event.type }] : [],
    ),
  };
}

/** 저장할 글로 바꾸기 / 읽기. 읽을 수 없거나 모양이 틀리면 null */
export function serializeSummary(summary: RaceSummary): string {
  return JSON.stringify(summary);
}

export function parseSummary(text: string | null): RaceSummary | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<RaceSummary>;
    if (
      typeof value !== "object" ||
      value === null ||
      typeof value.won !== "boolean" ||
      typeof value.myTimeSec !== "number" ||
      typeof value.opponentTimeSec !== "number" ||
      !Array.isArray(value.gapSeries) ||
      !Array.isArray(value.reversals) ||
      typeof value.settings !== "object" ||
      value.settings === null ||
      typeof value.opponent !== "object" ||
      value.opponent === null
    ) {
      return null;
    }
    return value as RaceSummary;
  } catch {
    return null;
  }
}

/** 고도를 "기록 조건" 글로 쓴다. 1km당 5m 미만이면 평지, 그 이상이면 오르막으로 부른다 */
export function describeElevation(gainM: number | null, distanceM: number): string {
  if (gainM === null) return "고도 정보 없음";
  const rounded = Math.round(gainM);
  return gainM / (distanceM / 1000) < 5 ? `평지 (+${rounded}m)` : `오르막 +${rounded}m`;
}

/** 시간 차이를 "12초"처럼 쓴다 */
export function formatMargin(seconds: number): string {
  const rounded = Math.round(Math.abs(seconds));
  return rounded < 1 ? "1초 미만" : `${rounded}초`;
}

export type GraphGeometry = {
  /** 선의 점들(SVG 좌표) */
  line: { x: number; y: number }[];
  /** 0m(같은 위치) 선의 y */
  zeroY: number;
  /** 역전 표시의 x */
  markers: { x: number; type: "overtake" | "overtaken" }[];
  /** 그래프가 보여 주는 격차 범위(±m) */
  rangeM: number;
};

/**
 * 격차 그래프의 좌표를 계산한다. 위쪽이 "내가 앞", 아래쪽이 "상대가 앞"이다.
 * 격차 범위는 데이터에 맞추되 최소 ±20m를 보장해서 작은 격차가 과장돼 보이지 않게 한다.
 */
export function computeGraphGeometry(summary: RaceSummary, width: number, height: number): GraphGeometry {
  const { gapSeries } = summary;
  const lastT = Math.max(summary.myTimeSec, gapSeries[gapSeries.length - 1]?.t ?? 0, 1);
  const maxGap = gapSeries.reduce((max, point) => Math.max(max, Math.abs(point.gapM)), 0);
  const rangeM = Math.max(20, Math.ceil(maxGap / 10) * 10);
  const x = (t: number) => (Math.min(Math.max(t, 0), lastT) / lastT) * width;
  const y = (gapM: number) => height / 2 - (Math.max(-rangeM, Math.min(rangeM, gapM)) / rangeM) * (height / 2);
  return {
    line: gapSeries.map((point) => ({ x: x(point.t), y: y(point.gapM) })),
    zeroY: height / 2,
    markers: summary.reversals.map((reversal) => ({ x: x(reversal.t), type: reversal.type })),
    rangeM,
  };
}

/**
 * 레이스 상세 분석 글. 외부 AI 없이 격차 기록에서 규칙으로 뽑아 쓴다(PRD: 템플릿 기반).
 * 가장 크게 앞선·뒤진 순간, 역전 횟수, 전반과 후반 흐름, 고도 조건을 문장으로 돌려준다.
 */
export function buildAnalysis(summary: RaceSummary): string[] {
  const lines: string[] = [];
  const series = summary.gapSeries;
  const clock = (sec: number) => `${Math.floor(sec / 60)}분 ${String(Math.round(sec % 60)).padStart(2, "0")}초`;
  const margin = summary.opponentTimeSec - summary.myTimeSec;
  lines.push(
    summary.won
      ? `상대보다 ${formatMargin(margin)} 빠르게 들어왔어요.`
      : `상대보다 ${formatMargin(margin)} 늦게 들어왔어요.`,
  );
  if (series.length >= 2) {
    const best = series.reduce((a, b) => (b.gapM > a.gapM ? b : a));
    const worst = series.reduce((a, b) => (b.gapM < a.gapM ? b : a));
    if (best.gapM > 5) lines.push(`가장 크게 앞선 때는 ${clock(best.t)}쯤, ${Math.round(best.gapM)}m 차이였어요.`);
    if (worst.gapM < -5) lines.push(`가장 크게 뒤처진 때는 ${clock(worst.t)}쯤, ${Math.round(-worst.gapM)}m 차이였어요.`);
    const half = series[Math.floor(series.length / 2)];
    const end = series[series.length - 1];
    const first = half.gapM;
    const second = end.gapM - half.gapM;
    if (Math.abs(second) > 3 || Math.abs(first) > 3) {
      lines.push(
        second > first
          ? "후반으로 갈수록 흐름이 내게 유리해졌어요. 후반 페이스가 좋았습니다."
          : "후반으로 갈수록 상대에게 밀리는 흐름이었어요. 초반에 힘을 아껴 보세요.",
      );
    }
  }
  if (summary.reversals.length === 0) lines.push("역전 없이 한 번 잡은 순서를 끝까지 지켰어요.");
  else lines.push(`순서가 ${summary.reversals.length}번 바뀌었어요. 접전이었습니다.`);
  const gain = summary.myElevationGainM;
  const rival = summary.opponent.elevationGainM;
  if (gain !== null && rival !== null && Math.abs(gain - rival) >= 10) {
    lines.push(gain > rival ? `내 코스가 상대보다 오르막이 ${Math.round(gain - rival)}m 더 많았어요.` : `상대 코스가 오르막이 ${Math.round(rival - gain)}m 더 많았어요.`);
  }
  return lines;
}
