// 중계 멘트 템플릿(lib/output/phrases.ts) 시험
import { describe, expect, it } from "vitest";
import type { Prediction } from "../engine/catchup";
import type { RaceEvent } from "../engine/race-engine";
import { createPhraseBook, phraseCandidates, type PhraseKey } from "./phrases";

const ALL_KEYS: PhraseKey[] = [
  "overtake",
  "overtaken",
  "closeEnter",
  "closeLeaveAhead",
  "closeLeaveBehind",
  "stageAdvantage",
  "stageClose",
  "stageDisadvantage",
  "last200m",
  "km",
  "finishWon",
  "finishLost",
  "predictOvertakeNumber",
  "predictOvertakeVague",
  "predictOvertakenNumber",
  "predictOvertakenVague",
];

describe("멘트 후보", () => {
  it("모든 상황에 멘트가 2개 이상 있고, 핵심 상황은 3~5개이다 (PRD: 상황별 3~5개)", () => {
    for (const key of ALL_KEYS) expect(phraseCandidates(key).length).toBeGreaterThanOrEqual(2);
    for (const key of ["overtake", "overtaken", "closeEnter", "last200m", "km", "finishWon", "finishLost"] as PhraseKey[]) {
      expect(phraseCandidates(key).length).toBeGreaterThanOrEqual(3);
      expect(phraseCandidates(key).length).toBeLessThanOrEqual(5);
    }
  });

  it("같은 상황 안에서 멘트가 서로 다르다", () => {
    for (const key of ALL_KEYS) {
      const list = phraseCandidates(key);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("코칭 말투(~하세요, ~하십시오)를 쓰지 않는다 (사용자를 선수로 놓는 3인칭 중계)", () => {
    for (const key of ALL_KEYS) {
      for (const phrase of phraseCandidates(key)) {
        expect(phrase).not.toMatch(/세요|십시오|해라|하라/);
      }
    }
  });

  it("값을 넣을 자리({km}, {sec})가 있는 멘트는 그 자리만 쓴다", () => {
    for (const phrase of [...phraseCandidates("km"), ...phraseCandidates("predictOvertakeNumber")]) {
      const slots = phrase.match(/\{\w+\}/g) ?? [];
      for (const slot of slots) expect(["{km}", "{sec}"]).toContain(slot);
    }
  });
});

describe("createPhraseBook (멘트 고르기)", () => {
  it("이벤트에 맞는 멘트를 고르고, 값을 넣는다", () => {
    const book = createPhraseBook(() => 0); // 항상 첫 번째 후보
    expect(book.forEvent({ type: "overtake", t: 1, gapM: 12 })).toBe("추월! 도전자가 앞서 나갑니다!");
    expect(book.forEvent({ type: "km", t: 1, km: 3 })).toBe("3킬로미터를 통과합니다!");
    expect(book.forEvent({ type: "finish", t: 1, won: true })).toBe("결승선 통과! 도전자의 승리입니다!");
    expect(book.forEvent({ type: "finish", t: 1, won: false })).toContain("상대가 먼저");
  });

  it("접전에서 벗어날 때는 앞서는지 뒤처지는지에 따라 다른 멘트가 나온다", () => {
    const book = createPhraseBook(() => 0);
    expect(book.forEvent({ type: "closeLeave", t: 1, gapM: 16 })).toContain("도전자");
    expect(book.forEvent({ type: "closeLeave", t: 1, gapM: -16 })).toContain("상대");
  });

  it("승률 단계에 맞는 멘트가 나온다", () => {
    const book = createPhraseBook(() => 0);
    const stage = (to: "advantage" | "close" | "disadvantage"): RaceEvent => ({
      type: "winStage",
      t: 1,
      from: "close",
      to,
      probability: 0.5,
    });
    expect(book.forEvent(stage("advantage"))).toContain("도전자");
    expect(book.forEvent(stage("close"))).toMatch(/접전|승부/);
    expect(book.forEvent(stage("disadvantage"))).toMatch(/상대|열세/);
  });

  it("같은 멘트가 연달아 두 번 나오지 않는다 (난수가 계속 같은 값이어도)", () => {
    const book = createPhraseBook(() => 0);
    const event: RaceEvent = { type: "overtake", t: 1, gapM: 12 };
    const first = book.forEvent(event);
    const second = book.forEvent(event);
    const third = book.forEvent(event);
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
  });

  it("난수가 골고루 나오면 모든 후보가 쓰인다", () => {
    const count = phraseCandidates("last200m").length;
    let calls = 0;
    const book = createPhraseBook(() => ((calls++ % count) + 0.5) / count); // 첫 번째, 두 번째, ... 후보 순서로 뽑히는 난수
    const seen = new Set<string>();
    for (let i = 0; i < count * 2; i++) seen.add(book.forEvent({ type: "last200m", t: i }));
    expect(seen.size).toBe(count);
  });

  it("다른 종류의 멘트끼리는 서로 영향을 주지 않는다", () => {
    const book = createPhraseBook(() => 0);
    book.forEvent({ type: "overtake", t: 1, gapM: 12 });
    // 처음 쓰는 종류는 난수대로 첫 번째 후보가 나온다
    expect(book.forEvent({ type: "last200m", t: 2 })).toBe(phraseCandidates("last200m")[0]);
  });

  it("난수가 1에 가까워도 범위를 벗어나지 않는다", () => {
    const book = createPhraseBook(() => 0.999999);
    expect(book.forEvent({ type: "overtake", t: 1, gapM: 12 })).toBe(phraseCandidates("overtake").at(-1));
  });
});

describe("추월 예측 멘트", () => {
  const make = (type: Prediction["type"], inSec: number, speak: Prediction["speak"]): Prediction => ({
    type,
    inSec,
    atRaceTimeSec: 100 + inSec,
    speak,
  });

  it("숫자로 말해도 될 때만 초를 넣는다", () => {
    const book = createPhraseBook(() => 0);
    expect(book.forPrediction(make("overtake", 39.6, "number"))).toContain("40초");
    expect(book.forPrediction(make("overtake", 300, "vague"))).not.toMatch(/\d/);
  });

  it("상대가 따라잡는 경우도 같은 규칙이다", () => {
    const book = createPhraseBook(() => 0);
    expect(book.forPrediction(make("overtaken", 20, "number"))).toContain("20초");
    expect(book.forPrediction(make("overtaken", 200, "vague"))).not.toMatch(/\d/);
  });

  it("아주 가까워도 0초라고 하지 않고 1초로 말한다", () => {
    const book = createPhraseBook(() => 0);
    expect(book.forPrediction(make("overtake", 0.3, "number"))).toContain("1초");
  });
});

describe("끊기지 않는 중계 멘트", () => {
  it("중간 상황은 앞서는지·뒤처지는지·나란한지에 따라 다르게 말하고 격차와 남은 거리를 넣는다", () => {
    const book = createPhraseBook(() => 0);
    expect(book.forEvent({ type: "status", t: 30, gapM: 12.4, remainingM: 640 })).toContain("12");
    expect(book.forEvent({ type: "status", t: 30, gapM: 12.4, remainingM: 640 })).toContain("640");
    expect(book.forEvent({ type: "status", t: 30, gapM: -20, remainingM: 640 })).toContain("상대");
    expect(book.forEvent({ type: "status", t: 30, gapM: 1, remainingM: 640 })).toContain("나란히");
    expect(book.forEvent({ type: "start", t: 0 })).toContain("출발");
    expect(book.forEvent({ type: "half", t: 100, gapM: 0, remainingM: 500 })).toContain("500");
  });
});
