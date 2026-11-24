// 효과음(lib/output/sfx.ts) 시험: 가짜 환경으로 소리 없이 동작만 확인한다
import { describe, expect, it } from "vitest";
import type { RaceEvent } from "../engine/race-engine";
import { CHEER_VOLUME, createSfx, HEARTBEAT_VOLUME, sfxActionFor, type SfxEnv } from "./sfx";
import { VOICE_VOLUME_CAP } from "./speaker";

const overtake: RaceEvent = { type: "overtake", t: 100, gapM: 12 };
const overtaken: RaceEvent = { type: "overtaken", t: 100, gapM: -12 };
const closeEnter: RaceEvent = { type: "closeEnter", t: 100, gapM: 8 };
const closeLeave: RaceEvent = { type: "closeLeave", t: 120, gapM: 16 };
const win: RaceEvent = { type: "finish", t: 1600, won: true };
const lose: RaceEvent = { type: "finish", t: 1600, won: false };

function makeEnv(failing: string[] = []) {
  const plays: { name: string; volume: number; loop: boolean; durationSec?: number }[] = [];
  const stops: string[] = [];
  const env: SfxEnv = {
    load: async (name) => {
      if (failing.includes(name)) throw new Error("없음");
      return name;
    },
    play: (buffer, options) => {
      plays.push({ name: String(buffer), ...options });
      return { stop: () => stops.push(String(buffer)) };
    },
  };
  return { env, plays, stops };
}

describe("sfxActionFor (이벤트 → 효과음)", () => {
  it("추월은 함성, 추월당함은 효과음이 없다", () => {
    expect(sfxActionFor(overtake, "normal")).toBe("cheer");
    expect(sfxActionFor(overtaken, "normal")).toBeNull();
  });

  it("접전에 들어오면 심장 박동을 켜고, 벗어나면 끈다 (일반 이상)", () => {
    expect(sfxActionFor(closeEnter, "normal")).toBe("heartbeatOn");
    expect(sfxActionFor(closeEnter, "active")).toBe("heartbeatOn");
    expect(sfxActionFor(closeEnter, "minimal")).toBe("heartbeatOn"); // 최소도 접전은 말한다
    expect(sfxActionFor(closeLeave, "minimal")).toBe("heartbeatOff");
  });

  it("결승에서는 심장 박동을 끄고, 이겼을 때만 함성을 낸다", () => {
    expect(sfxActionFor(win, "minimal")).toBe("cheer");
    expect(sfxActionFor(lose, "minimal")).toBe("heartbeatOff");
  });

  it("끄기에서는 켜는 효과음이 없다", () => {
    expect(sfxActionFor(overtake, "off")).toBeNull();
    expect(sfxActionFor(closeEnter, "off")).toBeNull();
    expect(sfxActionFor(win, "off")).toBe("heartbeatOff");
  });
});

describe("createSfx", () => {
  it("소리 크기는 음성 상한을 넘지 않는다", () => {
    expect(CHEER_VOLUME).toBeLessThanOrEqual(VOICE_VOLUME_CAP);
    expect(HEARTBEAT_VOLUME).toBeLessThanOrEqual(VOICE_VOLUME_CAP);
  });

  it("추월하면 함성을 한 번, 시간을 정해서 튼다", async () => {
    const { env, plays } = makeEnv();
    const sfx = createSfx(env);
    await sfx.preload();
    expect(sfx.handleEvent(overtake, "normal")).toBe("cheer");
    expect(plays).toHaveLength(1);
    expect(plays[0]).toMatchObject({ name: "cheer", loop: false });
    expect(plays[0].durationSec).toBeGreaterThan(0);
  });

  it("출발하자마자 접전이라 소리 파일을 아직 못 불러왔어도, 불러오는 대로 심장 박동을 튼다", async () => {
    const { env, plays } = makeEnv();
    const sfx = createSfx(env);
    const loading = sfx.preload(); // 아직 끝나지 않음
    sfx.handleEvent(closeEnter, "normal");
    expect(plays).toHaveLength(0);
    await loading;
    expect(plays.filter((p) => p.name === "heartbeat")).toHaveLength(1);
    expect(sfx.heartbeatPlaying).toBe(true);
  });

  it("불러오기 전에 접전이 끝났으면 불러온 뒤에도 틀지 않는다", async () => {
    const { env, plays } = makeEnv();
    const sfx = createSfx(env);
    const loading = sfx.preload();
    sfx.handleEvent(closeEnter, "normal");
    sfx.handleEvent(closeLeave, "normal");
    await loading;
    expect(plays.filter((p) => p.name === "heartbeat")).toHaveLength(0);
  });

  it("접전 동안 심장 박동을 반복해서 틀고, 이미 틀고 있으면 또 틀지 않는다", async () => {
    const { env, plays, stops } = makeEnv();
    const sfx = createSfx(env);
    await sfx.preload();
    sfx.handleEvent(closeEnter, "normal");
    sfx.handleEvent(closeEnter, "normal");
    expect(plays.filter((p) => p.name === "heartbeat")).toHaveLength(1);
    expect(plays[0].loop).toBe(true);
    expect(sfx.heartbeatPlaying).toBe(true);
    sfx.handleEvent(closeLeave, "normal");
    expect(stops).toEqual(["heartbeat"]);
    expect(sfx.heartbeatPlaying).toBe(false);
  });

  it("결승하면 심장 박동이 멈춘다", async () => {
    const { env, stops } = makeEnv();
    const sfx = createSfx(env);
    await sfx.preload();
    sfx.handleEvent(closeEnter, "normal");
    sfx.handleEvent(lose, "normal");
    expect(stops).toEqual(["heartbeat"]);
  });

  it("이기고 결승선을 넘으면 함성과 함께 박수도 낸다. 추월 때는 박수 없이 함성만", async () => {
    const { env, plays } = makeEnv();
    const sfx = createSfx(env);
    await sfx.preload();
    sfx.handleEvent(overtake, "normal");
    expect(plays.map((p) => p.name)).toEqual(["cheer"]);
    sfx.handleEvent(win, "normal");
    expect(plays.map((p) => p.name)).toEqual(["cheer", "cheer", "applause"]);
  });

  it("함성이 연달아 나오면 앞의 함성은 줄이고 새로 튼다", async () => {
    const { env, plays, stops } = makeEnv();
    const sfx = createSfx(env);
    await sfx.preload();
    sfx.handleEvent(overtake, "normal");
    sfx.handleEvent(overtake, "normal");
    expect(plays).toHaveLength(2);
    expect(stops).toEqual(["cheer"]);
  });

  it("모두 멈추면 심장 박동과 함성이 다 멈춘다", async () => {
    const { env, stops } = makeEnv();
    const sfx = createSfx(env);
    await sfx.preload();
    sfx.handleEvent(closeEnter, "normal");
    sfx.handleEvent(overtake, "normal");
    sfx.stopAll();
    expect(stops.sort()).toEqual(["cheer", "heartbeat"]);
  });

  it("파일 하나를 못 불러와도 나머지는 쓰고, 못 쓰는 소리는 조용히 빠진다", async () => {
    const { env, plays } = makeEnv(["cheer"]);
    const sfx = createSfx(env);
    await sfx.preload();
    expect(sfx.handleEvent(overtake, "normal")).toBeNull();
    expect(sfx.handleEvent(closeEnter, "normal")).toBe("heartbeatOn");
    expect(plays.map((p) => p.name)).toEqual(["heartbeat"]);
  });

  it("효과음을 지원하지 않는 기기(환경 없음)에서는 아무 일도 하지 않는다", async () => {
    const sfx = createSfx(null);
    await sfx.preload();
    expect(sfx.handleEvent(overtake, "normal")).toBeNull();
    expect(() => sfx.stopAll()).not.toThrow();
  });

  it("재생 중 예외가 나도 중계를 멈추지 않는다", async () => {
    const { env } = makeEnv();
    const sfx = createSfx({
      ...env,
      play: () => {
        throw new Error("재생 실패");
      },
    });
    await sfx.preload();
    expect(sfx.handleEvent(overtake, "normal")).toBeNull();
  });
});
