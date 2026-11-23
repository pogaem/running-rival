// 중계 자막 (PLAN.md 작업 8, DESIGN.md 1.2·2번 "출력부")
// 엔진이 만든 이벤트를 화면에 쌓을 자막 한 줄로 바꾸고, 판정 시각과 출력 시각을 함께 기록한다.
// 이 로그는 중계가 3초 안에 나갔는지 확인하는 디버그 기록도 겸한다. 문제가 생기면 이 로그를 그대로 AI에게 전달한다.
//
// 음성·효과음·진동은 같은 이벤트를 받아 PLAN 작업 9~11에서 이 옆에 붙인다. 지금은 자막만 있다.
import type { Prediction } from "../engine/catchup";
import type { RaceEvent } from "../engine/race-engine";
import { WIN_STAGE_LABEL } from "../engine/winprob";

/** 레이스 시간(초)을 "m:ss"로 쓴다. 예: 754 → "12:34" */
export function formatRaceClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** 격차를 부호와 함께 쓴다. 예: 12.4 → "+12m", −7.6 → "-8m" */
export function formatGap(gapM: number): string {
  const rounded = Math.round(gapM);
  return `${rounded >= 0 ? "+" : "-"}${Math.abs(rounded)}m`;
}

/** 자막의 종류와 분위기(화면에서 색을 고르는 데 쓴다) */
export type SubtitleKind = "lead" | "close" | "stage" | "distance" | "finish" | "prediction";
export type SubtitleTone = "good" | "bad" | "neutral";

export type Subtitle = {
  text: string;
  kind: SubtitleKind;
  tone: SubtitleTone;
};

/** 이벤트 하나를 자막 한 줄로 바꾼다. 말투는 사용자를 "도전자"로 부르는 3인칭 중계다 */
export function formatRaceEvent(event: RaceEvent): Subtitle {
  switch (event.type) {
    case "overtake":
      return { kind: "lead", tone: "good", text: `추월! 도전자가 앞서 나갑니다! (격차 ${formatGap(event.gapM)})` };
    case "overtaken":
      return { kind: "lead", tone: "bad", text: `추월당했습니다! 상대가 앞서 나갑니다 (격차 ${formatGap(event.gapM)})` };
    case "closeEnter":
      return { kind: "close", tone: "neutral", text: "접전입니다! 격차 10m 이내로 들어왔습니다" };
    case "closeLeave":
      return event.gapM >= 0
        ? { kind: "close", tone: "good", text: `도전자가 달아납니다 (격차 ${formatGap(event.gapM)})` }
        : { kind: "close", tone: "bad", text: `상대가 달아납니다 (격차 ${formatGap(event.gapM)})` };
    case "winStage":
      return {
        kind: "stage",
        tone: event.to === "advantage" ? "good" : event.to === "disadvantage" ? "bad" : "neutral",
        text: `예상 승률 단계가 바뀌었습니다: ${WIN_STAGE_LABEL[event.from]} → ${WIN_STAGE_LABEL[event.to]}`,
      };
    case "last200m":
      return { kind: "distance", tone: "neutral", text: "마지막 200m! 결승선이 보입니다" };
    case "km":
      return { kind: "distance", tone: "neutral", text: `${event.km}km 통과` };
    case "finish":
      return event.won
        ? { kind: "finish", tone: "good", text: "결승선 통과! 도전자의 승리입니다!" }
        : { kind: "finish", tone: "bad", text: "결승선 통과. 아쉽게 상대가 먼저 들어왔습니다" };
  }
}

/**
 * 지금의 추월 예측을 한 줄로 바꾼다. 예측이 없으면 null.
 * 숫자로 말해도 되는 때(number)만 "N초"를 쓰고, 아니면 숫자 없이 "따라붙고 있습니다"로 말한다 (PRD 5번).
 */
export function formatPrediction(prediction: Prediction | null): string | null {
  if (!prediction) return null;
  const seconds = Math.max(1, Math.round(prediction.inSec));
  if (prediction.type === "overtake") {
    return prediction.speak === "number" ? `도전자, ${seconds}초 뒤 추월 페이스입니다!` : "도전자, 따라붙고 있습니다";
  }
  return prediction.speak === "number" ? `${seconds}초 뒤 상대에게 따라잡힐 수 있습니다` : "상대가 뒤에서 따라붙고 있습니다";
}

/** 이 멘트가 소리로 나갔는지를 나타내는 상태 */
export type VoiceStatus =
  /** 읽기를 요청했고 아직 시작 신호를 기다리는 중 */
  | { state: "pending"; text: string }
  /** 읽기가 시작됐다. delayMs는 판정부터 음성이 시작되기까지 걸린 시간(밀리초). PRD 기준은 3초(3000ms) 이내 */
  | { state: "started"; text: string; startedAtMs: number; delayMs: number; ducked: boolean; beeped: boolean }
  /** 읽기에 실패했다 */
  | { state: "failed"; text: string; message: string }
  /** 말하지 않았다: 끄기 / 중계 강도에 맞지 않음 / 최소 간격 / 이 기기가 음성을 지원하지 않음 */
  | { state: "skipped"; reason: "off" | "intensity" | "gap" | "unsupported" };

/** 자막 로그의 한 줄 */
export type LogEntry = Subtitle & {
  /** 로그 안에서 겹치지 않는 번호 */
  id: number;
  /** 사건이 일어난 레이스 시간(초). 판정 시각 */
  raceTimeSec: number;
  /** 엔진이 이 사건을 판정한 실제 시계 시각(밀리초) */
  decidedAtMs: number;
  /** 자막으로 올린 실제 시계 시각(밀리초) */
  outputAtMs: number;
  /** 판정부터 자막 출력까지 걸린 시간(밀리초) */
  delayMs: number;
  /** 음성 상태 */
  voice: VoiceStatus;
};

/** 이벤트로 로그 한 줄을 만든다. 음성 상태를 모르면 "말하지 않음(끄기)"으로 둔다 */
export function makeLogEntry(
  id: number,
  event: RaceEvent,
  decidedAtMs: number,
  outputAtMs: number,
  voice: VoiceStatus = { state: "skipped", reason: "off" },
): LogEntry {
  return {
    ...formatRaceEvent(event),
    id,
    raceTimeSec: event.t,
    decidedAtMs,
    outputAtMs,
    delayMs: outputAtMs - decidedAtMs,
    voice,
  };
}

/** 추월 예측을 말한 것을 로그 한 줄로 만든다. 자막 글은 실제로 읽은 멘트와 같다 */
export function makePredictionLogEntry(
  id: number,
  raceTimeSec: number,
  text: string,
  decidedAtMs: number,
  outputAtMs: number,
  voice: VoiceStatus,
): LogEntry {
  return {
    kind: "prediction",
    tone: "neutral",
    text,
    id,
    raceTimeSec,
    decidedAtMs,
    outputAtMs,
    delayMs: outputAtMs - decidedAtMs,
    voice,
  };
}

/** 이 줄에 보여 줄 글: 소리로 읽은(읽는) 멘트가 있으면 그것을, 아니면 자막 글을 보여 준다 */
export function displayText(entry: LogEntry): string {
  return entry.voice.state === "pending" || entry.voice.state === "started" ? entry.voice.text : entry.text;
}

/** 읽기 결과를 받아 로그 한 줄의 음성 상태를 바꾼 새 로그를 돌려준다. 그 번호의 줄이 없으면 그대로 돌려준다 */
export function applyVoiceResult(
  log: LogEntry[],
  id: number,
  result:
    | { status: "started"; startedAtMs: number; ducked: boolean; beeped: boolean }
    | { status: "unsupported" }
    | { status: "error"; message: string },
): LogEntry[] {
  return log.map((entry) => {
    if (entry.id !== id || entry.voice.state !== "pending") return entry;
    const text = entry.voice.text;
    if (result.status === "started") {
      return {
        ...entry,
        voice: {
          state: "started",
          text,
          startedAtMs: result.startedAtMs,
          delayMs: result.startedAtMs - entry.decidedAtMs,
          ducked: result.ducked,
          beeped: result.beeped,
        },
      };
    }
    if (result.status === "unsupported") return { ...entry, voice: { state: "skipped", reason: "unsupported" } };
    return { ...entry, voice: { state: "failed", text, message: result.message } };
  });
}

/** 로그의 맨 앞(가장 최근)에 새 줄들을 붙이고, 오래된 줄은 maxEntries개까지만 남긴다 */
export function prependLog(log: LogEntry[], newEntries: LogEntry[], maxEntries = 100): LogEntry[] {
  if (newEntries.length === 0) return log;
  // 로그는 가장 최근 줄이 맨 위다. 같은 순간에 사건이 여럿이면 나중에 일어난 것이 더 위에 오도록 뒤집어서 붙인다
  return [...[...newEntries].reverse(), ...log].slice(0, maxEntries);
}
