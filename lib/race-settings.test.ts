// 대결 설정(lib/race-settings.ts) 시험
import { describe, expect, it } from "vitest";
import { virtualRunners } from "./runners";
import {
  DEFAULT_RACE_SETTINGS,
  formatPace,
  parsePaceInput,
  matchForSettings,
  settingsFromQuery,
  settingsToQuery,
  type RaceSettings,
} from "./race-settings";

describe("formatPace", () => {
  it("초/km를 분:초로 쓴다", () => {
    expect(formatPace(330)).toBe("5:30");
    expect(formatPace(360)).toBe("6:00");
    expect(formatPace(305)).toBe("5:05");
  });
});

describe("parsePaceInput (분·초 입력)", () => {
  it("올바른 입력은 초/km로 바꾼다", () => {
    expect(parsePaceInput("6", "00")).toEqual({ ok: true, paceSecPerKm: 360 });
    expect(parsePaceInput("5", "30")).toEqual({ ok: true, paceSecPerKm: 330 });
    expect(parsePaceInput(" 5 ", "")).toEqual({ ok: true, paceSecPerKm: 300 }); // 초를 비우면 0초
  });

  it("숫자가 아니거나 초가 59를 넘으면 이유를 알려 준다", () => {
    expect(parsePaceInput("abc", "00")).toMatchObject({ ok: false });
    expect(parsePaceInput("", "30")).toMatchObject({ ok: false });
    expect(parsePaceInput("5", "-1")).toMatchObject({ ok: false });
    expect(parsePaceInput("5", "1.5")).toMatchObject({ ok: false });
    const bad = parsePaceInput("5", "75");
    expect(bad).toMatchObject({ ok: false });
    if (!bad.ok) expect(bad.message).toContain("0~59");
  });

  it("범위(3:00~12:00) 밖이면 거절한다", () => {
    expect(parsePaceInput("2", "59")).toMatchObject({ ok: false });
    expect(parsePaceInput("3", "00")).toMatchObject({ ok: true });
    expect(parsePaceInput("12", "00")).toMatchObject({ ok: true });
    expect(parsePaceInput("12", "01")).toMatchObject({ ok: false });
  });
});

describe("설정 ↔ 주소 쿼리", () => {
  it("보낸 설정을 그대로 읽는다", () => {
    const settings: RaceSettings = { source: "gps", distanceM: 3000, paceSecPerKm: 345, intensity: "active" };
    const params = new URLSearchParams(settingsToQuery(settings));
    expect(settingsFromQuery((key) => params.get(key))).toEqual(settings);
  });

  it("매칭된 상대 이름표(o)도 실어 보낸다", () => {
    const settings: RaceSettings = { source: "demo", distanceM: 5000, paceSecPerKm: 320, intensity: "normal", opponentId: "러너-ab12cd" };
    const params = new URLSearchParams(settingsToQuery(settings));
    expect(settingsFromQuery((key) => params.get(key))).toEqual(settings);
  });

  it("쿼리가 없으면 기본값이다 (일반, 5km, 6:00)", () => {
    expect(settingsFromQuery(() => null)).toEqual(DEFAULT_RACE_SETTINGS);
    expect(DEFAULT_RACE_SETTINGS).toEqual({ source: "demo", distanceM: 5000, paceSecPerKm: 360, intensity: "normal" });
  });

  it("잘못된 값은 항목별로 기본값으로 바꾼다", () => {
    const params = new URLSearchParams({ d: "10000", p: "30", i: "아주크게" });
    expect(settingsFromQuery((key) => params.get(key))).toEqual(DEFAULT_RACE_SETTINGS);
    const mixed = new URLSearchParams({ d: "3000", p: "abc", i: "off" });
    expect(settingsFromQuery((key) => mixed.get(key))).toEqual({ source: "demo", distanceM: 3000, paceSecPerKm: 360, intensity: "off" });
  });
});

describe("matchForSettings (설정으로 상대 고르기)", () => {
  it("설정이 같으면 늘 같은 상대가 나온다", () => {
    const settings: RaceSettings = { source: "demo", distanceM: 5000, paceSecPerKm: 320, intensity: "normal" };
    expect(matchForSettings(settings, virtualRunners)?.opponent.id).toBe(matchForSettings(settings, virtualRunners)?.opponent.id);
    expect(matchForSettings(settings, virtualRunners)?.opponent.id).toBe("가상러너-03");
  });

  it("3km와 5km 모두 상대가 나온다", () => {
    for (const distanceM of [3000, 5000] as const) {
      expect(matchForSettings({ source: "demo", distanceM, paceSecPerKm: 360, intensity: "normal" }, virtualRunners)).not.toBeNull();
    }
  });

  it("앱에 들어 있는 기록으로도 매칭된다 (기본 기록 사용)", () => {
    expect(matchForSettings(DEFAULT_RACE_SETTINGS)).not.toBeNull();
  });
});
