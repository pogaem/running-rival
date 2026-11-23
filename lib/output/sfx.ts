// 효과음 (PLAN.md 작업 10, PRD 5번, DESIGN.md 이벤트 표)
//  - 추월과 승리 결승: 관중 함성을 잠깐 깔아 준다.
//  - 격차가 10m 이내로 들어오면(접전) 심장 박동을 반복해서 틀고, 벗어나거나 결승하면 멈춘다.
//  - 소리 크기는 음성과 같은 상한(VOICE_VOLUME_CAP)을 넘지 않는다.
// 브라우저 기능은 "환경(SfxEnv)"으로 받아서, 시험에서는 가짜 환경으로 소리 없이 동작을 확인한다.
// 음원 출처와 라이선스는 public/sfx/CREDITS.md와 앱 화면의 "음원 출처"에 표기한다.
import type { RaceEvent } from "../engine/race-engine";
import { VOICE_VOLUME_CAP } from "./speaker";
import { intensityAllows, type Intensity } from "./voice-policy";

/** 효과음 파일 위치 (public/sfx) */
export const SFX_URLS = {
  cheer: "/sfx/cheer.mp3",
  heartbeat: "/sfx/heartbeat.wav",
} as const;

export type SfxName = keyof typeof SFX_URLS;

/** 소리 크기(0~1). 음성이 묻히지 않게 음성 상한보다 훨씬 작게 둔다 (초안) */
export const CHEER_VOLUME = 0.4;
export const HEARTBEAT_VOLUME = 0.3;
/** 함성은 이 시간(초)만 틀고 서서히 줄인다 (초안). 원본은 14초라 길다 */
export const CHEER_PLAY_SEC = 4;
export const CHEER_FADE_SEC = 1.2;
/** 심장 박동을 멈출 때 서서히 줄이는 시간(초) */
export const HEARTBEAT_FADE_SEC = 0.4;

/** 이벤트에 대해 효과음이 할 일 */
export type SfxAction = "cheer" | "heartbeatOn" | "heartbeatOff" | null;

/**
 * 이벤트 → 효과음 할 일. 중계 강도는 음성과 같은 규칙을 따른다(그 이벤트를 말하는 강도에서만 효과음도 낸다).
 * 멈추는 일(heartbeatOff)은 강도와 상관없이 늘 한다.
 */
export function sfxActionFor(event: RaceEvent, intensity: Intensity): SfxAction {
  switch (event.type) {
    case "overtake":
      return intensityAllows(intensity, event) ? "cheer" : null;
    case "finish":
      // 결승에서는 심장 박동을 멈추고, 이겼을 때만 함성을 낸다
      return event.won && intensityAllows(intensity, event) ? "cheer" : "heartbeatOff";
    case "closeEnter":
      return intensityAllows(intensity, event) ? "heartbeatOn" : null;
    case "closeLeave":
      return "heartbeatOff";
    default:
      return null;
  }
}

/** 소리 크기를 0~상한 안으로 맞춘다 */
function clamp(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(Math.max(volume, 0), VOICE_VOLUME_CAP);
}

/** 재생 중인 소리를 멈추는 손잡이 */
export type SfxHandle = { stop(fadeSec: number): void };

export type SfxEnv = {
  /** 효과음 파일을 미리 불러온다. 실패하면 reject */
  load: (name: SfxName) => Promise<unknown>;
  /** 불러온 소리를 튼다. durationSec이 있으면 그 시간 뒤 서서히 줄이며 끝낸다 */
  play: (buffer: unknown, options: { volume: number; loop: boolean; durationSec?: number; fadeSec?: number }) => SfxHandle;
};

export type Sfx = {
  /** 효과음 파일을 미리 불러온다. 일부가 실패해도 나머지는 쓴다 */
  preload(): Promise<void>;
  /** 이벤트에 맞는 효과음을 낸다. 낸 일(cheer/heartbeatOn/heartbeatOff)을 돌려준다 */
  handleEvent(event: RaceEvent, intensity: Intensity): SfxAction;
  /** 심장 박동이 지금 울리는 중인가 */
  readonly heartbeatPlaying: boolean;
  /** 모든 효과음을 멈춘다 */
  stopAll(): void;
};

export function createSfx(env: SfxEnv | null): Sfx {
  const buffers: Partial<Record<SfxName, unknown>> = {};
  let heartbeat: SfxHandle | null = null;
  let cheer: SfxHandle | null = null;

  const stopHeartbeat = (fadeSec: number) => {
    heartbeat?.stop(fadeSec);
    heartbeat = null;
  };

  return {
    async preload() {
      if (!env) return;
      await Promise.all(
        (Object.keys(SFX_URLS) as SfxName[]).map(async (name) => {
          try {
            buffers[name] = await env.load(name);
          } catch {
            // 이 소리 하나만 못 쓰고, 나머지는 계속 쓴다
          }
        }),
      );
    },

    handleEvent(event, intensity) {
      const action = sfxActionFor(event, intensity);
      if (!action || !env) return null;
      try {
        if (action === "cheer") {
          const buffer = buffers.cheer;
          if (!buffer) return null;
          cheer?.stop(0.2); // 함성이 겹쳐서 커지지 않게 앞의 것은 줄인다
          cheer = env.play(buffer, {
            volume: clamp(CHEER_VOLUME),
            loop: false,
            durationSec: CHEER_PLAY_SEC,
            fadeSec: CHEER_FADE_SEC,
          });
        } else if (action === "heartbeatOn") {
          const buffer = buffers.heartbeat;
          if (!buffer || heartbeat) return null;
          heartbeat = env.play(buffer, { volume: clamp(HEARTBEAT_VOLUME), loop: true });
        } else {
          stopHeartbeat(HEARTBEAT_FADE_SEC);
        }
      } catch {
        return null; // 효과음이 안 나와도 중계는 계속된다
      }
      return action;
    },

    get heartbeatPlaying() {
      return heartbeat !== null;
    },

    stopAll() {
      stopHeartbeat(0.1);
      cheer?.stop(0.1);
      cheer = null;
    },
  };
}

/** 실제 브라우저 환경(Web Audio). 브라우저에서만 부른다. 지원하지 않으면 null (그러면 효과음은 조용히 빠진다) */
export function createBrowserSfxEnv(): SfxEnv | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  let context: AudioContext | null = null;
  const getContext = () => (context ??= new Ctor());

  return {
    async load(name) {
      const response = await fetch(SFX_URLS[name]);
      if (!response.ok) throw new Error(`효과음을 불러오지 못했다: ${name}`);
      const data = await response.arrayBuffer();
      return getContext().decodeAudioData(data);
    },
    play(buffer, { volume, loop, durationSec, fadeSec = 0.3 }) {
      const ctx = getContext();
      void ctx.resume();
      const source = ctx.createBufferSource();
      source.buffer = buffer as AudioBuffer;
      source.loop = loop;
      const gain = ctx.createGain();
      gain.gain.value = clamp(volume);
      source.connect(gain).connect(ctx.destination);
      source.start();

      let stopped = false;
      const stop = (fade: number) => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + Math.max(fade, 0.02));
        source.stop(now + Math.max(fade, 0.02) + 0.02);
      };
      if (durationSec !== undefined) {
        const fadeStart = Math.max(durationSec - fadeSec, 0);
        gain.gain.setValueAtTime(clamp(volume), ctx.currentTime + fadeStart);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + durationSec);
        source.stop(ctx.currentTime + durationSec + 0.05);
        stopped = false;
      }
      return { stop };
    },
  };
}
