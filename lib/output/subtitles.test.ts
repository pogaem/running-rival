// 중계 자막(lib/output/subtitles.ts) 시험
import { describe, expect, it } from "vitest";
import type { Prediction } from "../engine/catchup";
import type { RaceEvent } from "../engine/race-engine";
import {
  applyVoiceResult,
  displayText,
  formatGap,
  formatPrediction,
  formatRaceClock,
  formatRaceEvent,
  makeLogEntry,
  makePredictionLogEntry,
  prependLog,
} from "./subtitles";

describe("formatRaceClock (m:ss)", () => {
  it("초를 분:초로 쓴다", () => {
    expect(formatRaceClock(0)).toBe("0:00");
    expect(formatRaceClock(5)).toBe("0:05");
    expect(formatRaceClock(754)).toBe("12:34");
    expect(formatRaceClock(1600)).toBe("26:40");
  });

  it("소수점은 버리고, 음수는 0으로 본다", () => {
    expect(formatRaceClock(59.9)).toBe("0:59");
    expect(formatRaceClock(-3)).toBe("0:00");
  });
});

describe("formatGap (부호와 함께)", () => {
  it("내가 앞서면 +, 뒤처지면 −이고 반올림한다", () => {
    expect(formatGap(12.4)).toBe("+12m");
    expect(formatGap(-7.6)).toBe("-8m");
    expect(formatGap(0)).toBe("+0m");
  });
});

describe("formatRaceEvent (이벤트 → 자막 한 줄)", () => {
  const cases: [RaceEvent, string, string, string][] = [
    [{ type: "overtake", t: 1225, gapM: 12 }, "lead", "good", "추월! 도전자가 앞서 나갑니다! (격차 +12m)"],
    [{ type: "overtaken", t: 700, gapM: -12 }, "lead", "bad", "추월당했습니다! 상대가 앞서 나갑니다 (격차 -12m)"],
    [{ type: "closeEnter", t: 1150, gapM: -9 }, "close", "neutral", "접전입니다! 격차 10m 이내로 들어왔습니다"],
    [{ type: "closeLeave", t: 1250, gapM: 16 }, "close", "good", "도전자가 달아납니다 (격차 +16m)"],
    [{ type: "closeLeave", t: 62, gapM: -16 }, "close", "bad", "상대가 달아납니다 (격차 -16m)"],
    [
      { type: "winStage", t: 300, from: "close", to: "advantage", probability: 0.75 },
      "stage",
      "good",
      "예상 승률 단계가 바뀌었습니다: 접전 → 우세",
    ],
    [
      { type: "winStage", t: 300, from: "close", to: "disadvantage", probability: 0.2 },
      "stage",
      "bad",
      "예상 승률 단계가 바뀌었습니다: 접전 → 열세",
    ],
    [{ type: "last200m", t: 1536 }, "distance", "neutral", "마지막 200m! 결승선이 보입니다"],
    [{ type: "km", t: 320, km: 1 }, "distance", "neutral", "1km 통과"],
    [{ type: "finish", t: 1600, won: true }, "finish", "good", "결승선 통과! 도전자의 승리입니다!"],
    [{ type: "finish", t: 1600, won: false }, "finish", "bad", "결승선 통과. 아쉽게 상대가 먼저 들어왔습니다"],
  ];

  it.each(cases)("%j", (event, kind, tone, text) => {
    expect(formatRaceEvent(event)).toEqual({ kind, tone, text });
  });
});

describe("formatPrediction (지금의 추월 예측)", () => {
  const make = (type: Prediction["type"], inSec: number, speak: Prediction["speak"]): Prediction => ({
    type,
    inSec,
    atRaceTimeSec: 100 + inSec,
    speak,
  });

  it("예측이 없으면 null이다", () => {
    expect(formatPrediction(null)).toBeNull();
  });

  it("숫자로 말해도 될 때만 초를 쓴다", () => {
    expect(formatPrediction(make("overtake", 39.6, "number"))).toBe("도전자, 40초 뒤 추월 페이스입니다!");
    expect(formatPrediction(make("overtake", 300, "vague"))).toBe("도전자, 따라붙고 있습니다");
  });

  it("상대가 따라잡는 경우도 같은 규칙이다", () => {
    expect(formatPrediction(make("overtaken", 20, "number"))).toBe("20초 뒤 상대에게 따라잡힐 수 있습니다");
    expect(formatPrediction(make("overtaken", 200, "vague"))).toBe("상대가 뒤에서 따라붙고 있습니다");
  });

  it("0.4초처럼 아주 가까워도 0초라고 하지 않고 1초로 쓴다", () => {
    expect(formatPrediction(make("overtake", 0.4, "number"))).toBe("도전자, 1초 뒤 추월 페이스입니다!");
  });
});

describe("makeLogEntry · prependLog (자막 로그)", () => {
  const overtake: RaceEvent = { type: "overtake", t: 1225, gapM: 12 };

  it("판정 시각과 출력 시각, 걸린 시간을 함께 남긴다", () => {
    const entry = makeLogEntry(7, overtake, 5000, 5004);
    expect(entry).toMatchObject({
      id: 7,
      raceTimeSec: 1225,
      decidedAtMs: 5000,
      outputAtMs: 5004,
      delayMs: 4,
      kind: "lead",
      tone: "good",
    });
    expect(entry.text).toContain("추월!");
  });

  it("가장 최근 줄이 맨 위에 쌓이고, 같은 순간의 사건은 나중에 일어난 것이 더 위에 온다", () => {
    const first = makeLogEntry(1, { type: "km", t: 300, km: 1 }, 0, 0);
    const a = makeLogEntry(2, { type: "closeEnter", t: 1150, gapM: -9 }, 0, 0); // 먼저 일어남
    const b = makeLogEntry(3, overtake, 0, 0); // 나중에 일어남
    const log = prependLog(prependLog([], [first]), [a, b]);
    expect(log.map((e) => e.id)).toEqual([3, 2, 1]);
  });

  it("오래된 줄은 최대 개수까지만 남긴다", () => {
    let log = prependLog([], [makeLogEntry(1, overtake, 0, 0)], 3);
    for (let id = 2; id <= 5; id++) log = prependLog(log, [makeLogEntry(id, overtake, 0, 0)], 3);
    expect(log.map((e) => e.id)).toEqual([5, 4, 3]);
  });

  it("새 줄이 없으면 로그를 그대로 돌려준다", () => {
    const log = [makeLogEntry(1, overtake, 0, 0)];
    expect(prependLog(log, [])).toBe(log);
  });
});

describe("로그의 음성 상태", () => {
  const overtake: RaceEvent = { type: "overtake", t: 1225, gapM: 12 };

  it("음성 상태를 모르면 '말하지 않음(끄기)'으로 시작한다", () => {
    expect(makeLogEntry(1, overtake, 0, 0).voice).toEqual({ state: "skipped", reason: "off" });
  });

  it("읽기를 요청한 줄에는 읽을 멘트가 붙고, 화면에는 그 멘트가 보인다", () => {
    const entry = makeLogEntry(1, overtake, 100, 101, { state: "pending", text: "역전입니다! 도전자, 선두로 올라섭니다!" });
    expect(displayText(entry)).toBe("역전입니다! 도전자, 선두로 올라섭니다!");
  });

  it("말하지 않은 줄에는 자막 글이 보인다", () => {
    const entry = makeLogEntry(1, overtake, 100, 101, { state: "skipped", reason: "gap" });
    expect(displayText(entry)).toContain("추월!");
  });

  it("읽기가 시작되면 판정부터 음성 시작까지 걸린 시간을 계산해 넣는다", () => {
    const entry = makeLogEntry(7, overtake, 5000, 5001, { state: "pending", text: "추월!" });
    const [updated] = applyVoiceResult([entry], 7, { status: "started", startedAtMs: 5180, ducked: false, beeped: true });
    expect(updated.voice).toEqual({
      state: "started",
      text: "추월!",
      startedAtMs: 5180,
      delayMs: 180,
      ducked: false,
      beeped: true,
    });
  });

  it("읽기에 실패하면 실패와 이유를 남기고, 화면에는 자막 글이 보인다", () => {
    const entry = makeLogEntry(7, overtake, 0, 0, { state: "pending", text: "추월!" });
    const [updated] = applyVoiceResult([entry], 7, { status: "error", message: "synthesis-failed" });
    expect(updated.voice).toEqual({ state: "failed", text: "추월!", message: "synthesis-failed" });
    expect(displayText(updated)).toContain("추월!");
  });

  it("지원하지 않는 기기로 밝혀지면 '말하지 않음(지원 안 됨)'으로 바꾼다", () => {
    const entry = makeLogEntry(7, overtake, 0, 0, { state: "pending", text: "추월!" });
    const [updated] = applyVoiceResult([entry], 7, { status: "unsupported" });
    expect(updated.voice).toEqual({ state: "skipped", reason: "unsupported" });
  });

  it("다른 줄이나, 이미 결과가 정해진 줄은 건드리지 않는다", () => {
    const pending = makeLogEntry(1, overtake, 0, 0, { state: "pending", text: "추월!" });
    const other = makeLogEntry(2, overtake, 0, 0, { state: "pending", text: "역전!" });
    const log = [pending, other];
    const updated = applyVoiceResult(log, 1, { status: "started", startedAtMs: 10, ducked: false, beeped: false });
    expect(updated[1]).toBe(other);
    // 이미 시작된 줄에 또 결과가 와도 그대로
    const again = applyVoiceResult(updated, 1, { status: "error", message: "늦게 온 오류" });
    expect(again[0].voice.state).toBe("started");
  });

  it("예측을 말한 줄은 예측 종류이고, 읽은 멘트가 자막 글이다", () => {
    const entry = makePredictionLogEntry(3, 1190, "도전자, 35초 뒤 추월 페이스입니다!", 10, 11, {
      state: "pending",
      text: "도전자, 35초 뒤 추월 페이스입니다!",
    });
    expect(entry).toMatchObject({ kind: "prediction", tone: "neutral", raceTimeSec: 1190, delayMs: 1 });
    expect(displayText(entry)).toBe("도전자, 35초 뒤 추월 페이스입니다!");
  });
});
