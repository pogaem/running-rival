// 음성 출력(lib/output/speaker.ts) 시험: 가짜 브라우저 환경으로 소리 없이 동작만 확인한다
import { describe, expect, it, vi } from "vitest";
import {
  BEEP_LEAD_MS,
  clampVolume,
  createSpeaker,
  VOICE_RATE,
  VOICE_VOLUME_CAP,
  type SpeakerEnv,
  type UtteranceLike,
} from "./speaker";

type Mode = "start" | "error" | "never" | "throw";

/** 가짜 브라우저 환경. 호출 순서를 calls에 적어 둔다 */
function makeEnv(
  options: {
    mode?: Mode;
    voices?: { lang: string }[];
    session?: { type: string } | null;
    beep?: boolean;
    sessionThrows?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const utterances: UtteranceLike[] = [];
  let releaseTimeout: () => void = () => {};
  const timeout = new Promise<void>((resolve) => {
    releaseTimeout = resolve;
  });
  const mode = options.mode ?? "start";

  let session = options.session ?? null;
  if (session && options.sessionThrows) {
    const target = session;
    session = Object.defineProperty({ type: "auto" }, "type", {
      get: () => target.type,
      set: () => {
        throw new Error("바꿀 수 없음");
      },
    });
  }

  const env: SpeakerEnv = {
    speech: {
      speak(utterance) {
        calls.push("speak");
        utterances.push(utterance);
        if (mode === "throw") throw new Error("읽기 실패");
        queueMicrotask(() => {
          if (mode === "start") utterance.onstart?.();
          if (mode === "error") utterance.onerror?.({ error: "synthesis-failed" });
        });
      },
      cancel() {
        calls.push("cancel");
      },
      getVoices: () => options.voices ?? [],
    },
    makeUtterance: (text) => ({
      text,
      lang: "",
      volume: 1,
      rate: 1,
      pitch: 0,
      voice: undefined,
      onstart: null,
      onend: null,
      onerror: null,
    }),
    audioSession: session,
    playBeep: options.beep ? () => calls.push("beep") : null,
    unlock: () => calls.push("unlock"),
    now: () => 1234,
    wait: (ms) => {
      calls.push(`wait:${ms}`);
      return ms >= 1000 ? timeout : Promise.resolve();
    },
  };
  return { env, calls, utterances, session, releaseTimeout };
}

describe("clampVolume (소리 크기 상한)", () => {
  it("상한(0.8)을 넘지 않는다", () => {
    expect(VOICE_VOLUME_CAP).toBe(0.8);
    expect(clampVolume(1)).toBe(0.8);
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(Number.NaN)).toBe(0);
  });
});

describe("createSpeaker · 기본 읽기", () => {
  it("음성 읽기를 지원하지 않으면 지원 안 됨으로 알린다", async () => {
    const { env } = makeEnv();
    const speaker = createSpeaker({ ...env, speech: null });
    expect(speaker.supported).toBe(false);
    expect(await speaker.speak("추월!")).toEqual({ status: "unsupported" });
  });

  it("한국어로, 소리 크기 상한 이하로, 정해진 속도로 읽고, 읽기 시작한 시각을 알려 준다", async () => {
    const { env, utterances } = makeEnv({ voices: [{ lang: "en-US" }, { lang: "ko-KR" }] });
    const result = await createSpeaker(env).speak("추월! 도전자가 앞서 나갑니다!");
    expect(result).toMatchObject({ status: "started", startedAtMs: 1234 });
    expect(utterances).toHaveLength(1);
    expect(utterances[0]).toMatchObject({ text: "추월! 도전자가 앞서 나갑니다!", lang: "ko-KR", rate: VOICE_RATE });
    expect(utterances[0].volume).toBeLessThanOrEqual(VOICE_VOLUME_CAP);
    expect(utterances[0].voice).toEqual({ lang: "ko-KR" }); // 한국어 음성을 골랐다
  });

  it("한국어 음성이 없으면 기본 음성으로 읽는다", async () => {
    const { env, utterances } = makeEnv({ voices: [{ lang: "en-US" }] });
    await createSpeaker(env).speak("접전입니다!");
    expect(utterances[0].voice).toBeNull();
    expect(utterances[0].lang).toBe("ko-KR");
  });

  it("소리 잠금 풀기와 멈추기를 환경에 전달한다", () => {
    const { env, calls } = makeEnv();
    const speaker = createSpeaker(env);
    speaker.unlock();
    speaker.cancel();
    expect(calls).toEqual(["unlock", "cancel"]);
  });
});

describe("createSpeaker · 급한 멘트", () => {
  it("급한 멘트는 읽던 것을 끊고 바로 읽는다", async () => {
    const { env, calls } = makeEnv();
    await createSpeaker(env).speak("추월!", { priority: true });
    expect(calls.indexOf("cancel")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("cancel")).toBeLessThan(calls.indexOf("speak"));
  });

  it("보통 멘트는 읽던 것을 끊지 않는다", async () => {
    const { env, calls } = makeEnv();
    await createSpeaker(env).speak("1킬로미터를 통과합니다!");
    expect(calls).not.toContain("cancel");
  });
});

describe("createSpeaker · 음악 위에서 들리게 하기", () => {
  it("오디오 세션이 되는 기기: 읽는 동안 다른 소리를 낮추고, 끝나면 되돌린다. 알림음은 없다", async () => {
    const { env, calls, utterances, session } = makeEnv({ session: { type: "auto" }, beep: true });
    const speaker = createSpeaker(env);
    expect(speaker.canDuck).toBe(true);
    const result = await speaker.speak("추월!");
    expect(result).toMatchObject({ status: "started", ducked: true, beeped: false });
    expect(session?.type).toBe("transient"); // 읽는 동안
    expect(calls).not.toContain("beep");
    utterances[0].onend?.();
    expect(session?.type).toBe("auto"); // 끝나면 원래대로
  });

  it("안 되는 기기: 멘트 앞에 짧은 알림음을 넣고 잠깐 기다린 뒤 읽는다", async () => {
    const { env, calls } = makeEnv({ beep: true });
    const speaker = createSpeaker(env);
    expect(speaker.canDuck).toBe(false);
    const result = await speaker.speak("추월!");
    expect(result).toMatchObject({ status: "started", ducked: false, beeped: true });
    expect(calls.indexOf("beep")).toBeLessThan(calls.indexOf(`wait:${BEEP_LEAD_MS}`));
    expect(calls.indexOf(`wait:${BEEP_LEAD_MS}`)).toBeLessThan(calls.indexOf("speak"));
  });

  it("오디오 세션을 바꾸지 못하면 알림음으로 대신한다", async () => {
    const { env } = makeEnv({ session: { type: "auto" }, sessionThrows: true, beep: true });
    const result = await createSpeaker(env).speak("추월!");
    expect(result).toMatchObject({ status: "started", ducked: false, beeped: true });
  });

  it("알림음도 낼 수 없으면 알림음 없이 읽는다", async () => {
    const { env } = makeEnv();
    const result = await createSpeaker(env).speak("추월!");
    expect(result).toMatchObject({ status: "started", ducked: false, beeped: false });
  });
});

describe("createSpeaker · 실패", () => {
  it("읽기 오류가 나면 오류로 알리고, 낮춰 둔 다른 소리를 되돌린다", async () => {
    const { env, session } = makeEnv({ mode: "error", session: { type: "auto" } });
    const result = await createSpeaker(env).speak("추월!");
    expect(result).toEqual({ status: "error", message: "synthesis-failed" });
    expect(session?.type).toBe("auto");
  });

  it("읽기를 시작하려다 예외가 나도 오류로 알린다", async () => {
    const { env } = makeEnv({ mode: "throw" });
    expect(await createSpeaker(env).speak("추월!")).toEqual({ status: "error", message: "읽기 실패" });
  });

  it("읽기 시작 신호가 끝내 오지 않으면 오류로 알린다", async () => {
    const { env, releaseTimeout } = makeEnv({ mode: "never" });
    const pending = createSpeaker(env).speak("추월!");
    const probe = vi.fn();
    void pending.then(probe);
    await Promise.resolve();
    expect(probe).not.toHaveBeenCalled(); // 아직 기다리는 중
    releaseTimeout();
    expect(await pending).toEqual({ status: "error", message: "읽기 시작 신호가 오지 않았다" });
  });
});
