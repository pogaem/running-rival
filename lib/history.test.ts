// 전적·개인 최고 기록(lib/history.ts) 시험
import { describe, expect, it } from "vitest";
import {
  bestPaceSecPerKm,
  describeNewBest,
  EMPTY_HISTORY,
  formatRivalRecord,
  parseHistory,
  recordRace,
  rivalryIntro,
  serializeHistory,
} from "./history";

const race = { opponentId: "가상러너-03", distanceM: 5000 as const, won: true, myTimeSec: 1600 };

describe("recordRace", () => {
  it("첫 경기는 전적과 최고 기록이 생긴다", () => {
    const out = recordRace(EMPTY_HISTORY, race);
    expect(out.rival).toEqual({ wins: 1, losses: 0, lastWon: true });
    expect(out.newBest).toBe(true);
    expect(out.previousBestSec).toBeNull();
    expect(out.history.bests["5000"]).toBe(1600);
  });

  it("승패를 쌓고, 더 느린 기록은 최고 기록을 바꾸지 않는다", () => {
    const first = recordRace(EMPTY_HISTORY, race).history;
    const second = recordRace(first, { ...race, won: false, myTimeSec: 1700 });
    expect(second.rival).toEqual({ wins: 1, losses: 1, lastWon: false });
    expect(second.newBest).toBe(false);
    expect(second.history.bests["5000"]).toBe(1600);
    const third = recordRace(second.history, { ...race, myTimeSec: 1550 });
    expect(third.newBest).toBe(true);
    expect(third.previousBestSec).toBe(1600);
    expect(third.history.bests["5000"]).toBe(1550);
  });

  it("거리별로 따로 기록하고, 받은 기록은 바꾸지 않는다", () => {
    const base = recordRace(EMPTY_HISTORY, race).history;
    const snapshot = JSON.stringify(base);
    const out = recordRace(base, { ...race, distanceM: 3000, myTimeSec: 900, opponentId: "가상러너-01" });
    expect(out.history.bests).toEqual({ "5000": 1600, "3000": 900 });
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe("저장·읽기", () => {
  it("저장했다 읽으면 같다", () => {
    const history = recordRace(EMPTY_HISTORY, race).history;
    expect(parseHistory(serializeHistory(history))).toEqual(history);
  });

  it("없거나 망가진 글은 빈 기록이고, 망가진 항목은 버린다", () => {
    expect(parseHistory(null)).toEqual(EMPTY_HISTORY);
    expect(parseHistory("{망가짐")).toEqual(EMPTY_HISTORY);
    expect(parseHistory(JSON.stringify({ version: 2 }))).toEqual(EMPTY_HISTORY);
    const mixed = JSON.stringify({
      version: 1,
      rivals: { a: { wins: 1, losses: 0, lastWon: true }, b: { wins: "많이" } },
      bests: { "5000": 1500, "3000": -3 },
    });
    expect(parseHistory(mixed)).toEqual({
      version: 1,
      rivals: { a: { wins: 1, losses: 0, lastWon: true } },
      bests: { "5000": 1500 },
    });
  });
});

describe("중계에 쓰는 글", () => {
  it("처음 만난 상대는 말하지 않는다", () => {
    expect(rivalryIntro(undefined)).toBeNull();
    expect(formatRivalRecord(undefined)).toBeNull();
  });

  it("졌던 상대는 설욕전, 이겼던 상대는 연승 도전으로 전한다", () => {
    expect(rivalryIntro({ wins: 1, losses: 2, lastWon: false })).toContain("설욕전");
    expect(rivalryIntro({ wins: 2, losses: 1, lastWon: true })).toContain("2승 1패");
    expect(rivalryIntro({ wins: 2, losses: 1, lastWon: true })).not.toContain("설욕전");
  });

  it("최고 기록 문구와 페이스", () => {
    expect(describeNewBest(1512, 1563)).toBe("개인 최고 기록 갱신! 25:12 (이전 26:03)");
    expect(describeNewBest(900, null)).toContain("첫 기록");
    const history = recordRace(EMPTY_HISTORY, race).history;
    expect(bestPaceSecPerKm(history, 5000)).toBe(320);
    expect(bestPaceSecPerKm(history, 3000)).toBeNull();
  });
});
