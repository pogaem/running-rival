// 효과음 (PLAN.md 작업 10, PRD 5번, DESIGN.md 이벤트 표)
//  - 추월과 승리 결승: 관중 함성을 잠깐 깔아 준다.
//  - 격차가 10m 이내로 들어오면(접전) 심장 박동을 반복해서 틀고, 벗어나거나 결승하면 멈춘다.
//  - 소리 크기는 음성과 같은 상한(VOICE_VOLUME_CAP)을 넘지 않는다.
// 브라우저 기능은 "환경(SfxEnv)"으로 받아서, 시험에서는 가짜 환경으로 소리 없이 동작을 확인한다.
// 음원 출처와 라이선스는 public/sfx/CREDITS.md와 앱 화면의 "음원 출처"에 표기한다.
import type { RaceEvent } from "../engine/race-engine";
import { getSharedAudioContext } from "./audio-context";
import { VOICE_VOLUME_CAP } from "./speaker";
import { intensityAllows, type Intensity } from "./voice-policy";

/** 효과음 파일 위치 (public/sfx) */
export const SFX_URLS = {
  cheer: "/sfx/cheer.mp3",
  heartbeat: "/sfx/heartbeat.wav",
  applause: "/sfx/applause.mp3",
} as const;


/** 파일 없이 브라우저가 직접 만들어 내는 소리: 박수. 다운로드할 것이 없다 */
export type SfxName = keyof typeof SFX_URLS | "applause";
const ALL_SFX: SfxName[] = ["cheer", "heartbeat", "applause"];

/** 소리 크기(0~1). 음성이 묻히지 않게 음성 상한보다 훨씬 작게 둔다 (초안) */
export const CHEER_VOLUME = 0.7;
/** 승리 결승 박수 */
export const APPLAUSE_VOLUME = 0.8;
export const APPLAUSE_SEC = 7;
export const APPLAUSE_FADE_SEC = 2;
/** 심장 박동 파일은 원래 소리가 아주 작아서(최대치의 20%) 크기를 맞춰 다시 저장했다(16비트, 최대치 90%). 그래서 다른 소리보다 작게 둔다 */
export const HEARTBEAT_VOLUME = 0.45;
/** 함성은 이 시간(초)만 틀고 서서히 줄인다 (초안). 원본은 14초라 길다 */
export const CHEER_PLAY_SEC = 6;
export const CHEER_FADE_SEC = 1.2;
/** 심장 박동을 멈출 때 서서히 줄이는 시간(초) */
export const HEARTBEAT_FADE_SEC = 0.4;
/** 중계가 나가는 동안 효과음에 곱하는 크기(초안). 1이면 그대로, 작을수록 더 낮춘다 */
export const SFX_DUCK_LEVEL = 0.25;

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
  /** 중계가 나가는 동안 효과음 전체를 작게(true) 하거나 원래대로(false) 한다 */
  setDucked?: (ducked: boolean) => void;
};

export type Sfx = {
  /** 효과음 파일을 미리 불러온다. 일부가 실패해도 나머지는 쓴다 */
  preload(): Promise<void>;
  /** 이벤트에 맞는 효과음을 낸다. 낸 일(cheer/heartbeatOn/heartbeatOff)을 돌려준다 */
  handleEvent(event: RaceEvent, intensity: Intensity): SfxAction;
  /** 심장 박동이 지금 울리는 중인가 */
  readonly heartbeatPlaying: boolean;
  /** 중계 멘트가 나가는 동안 효과음을 작게 낮춘다(true) / 원래 크기로 되돌린다(false) */
  setDucked(ducked: boolean): void;
  /** 모든 효과음을 멈춘다 */
  stopAll(): void;
  /** 심장 박동만 멈춘다(함성·박수는 그대로 둔다) */
  stopHeartbeat(): void;
};

export function createSfx(env: SfxEnv | null): Sfx {
  const buffers: Partial<Record<SfxName, unknown>> = {};
  let heartbeat: SfxHandle | null = null;
  let cheer: SfxHandle | null = null;
  /** 출발하자마자 접전이라 심장 박동을 틀어야 하는데 소리 파일이 아직 안 불러와졌을 때: 불러오는 대로 튼다 */
  let heartbeatWanted = false;

  const startHeartbeat = () => {
    const buffer = buffers.heartbeat;
    if (!env || !buffer || heartbeat) return false;
    heartbeat = env.play(buffer, { volume: clamp(HEARTBEAT_VOLUME), loop: true });
    return true;
  };

  const stopHeartbeat = (fadeSec: number) => {
    heartbeatWanted = false;
    heartbeat?.stop(fadeSec);
    heartbeat = null;
  };

  return {
    async preload() {
      if (!env) return;
      await Promise.all(
        ALL_SFX.map(async (name) => {
          try {
            buffers[name] = await env.load(name);
          } catch {
            // 이 소리 하나만 못 쓰고, 나머지는 계속 쓴다
          }
        }),
      );
      if (heartbeatWanted) {
        try {
          startHeartbeat();
        } catch {
          // 소리가 안 나도 중계는 계속된다
        }
      }
    },

    handleEvent(event, intensity) {
      const action = sfxActionFor(event, intensity);
      // 결승선을 지나면 이겼든 졌든 심장 박동은 반드시 끈다(이기면 함성이 나가는 쪽으로 가서 못 끄던 문제)
      if (event.type === "finish") stopHeartbeat(HEARTBEAT_FADE_SEC);
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
          // 이겨서 결승선을 넘을 때는 박수도 함께 낸다
          const applause = buffers.applause;
          if (event.type === "finish" && applause) {
            env.play(applause, { volume: clamp(APPLAUSE_VOLUME), loop: false, durationSec: APPLAUSE_SEC, fadeSec: APPLAUSE_FADE_SEC });
          }
        } else if (action === "heartbeatOn") {
          heartbeatWanted = true;
          if (!buffers.heartbeat || heartbeat) return heartbeat ? action : null; // 아직 못 불러왔으면 불러오는 대로 튼다
          startHeartbeat();
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

    stopHeartbeat() {
      stopHeartbeat(HEARTBEAT_FADE_SEC);
    },

    setDucked(ducked) {
      try {
        env?.setDucked?.(ducked);
      } catch {
        // 소리를 못 낮춰도 중계는 계속된다
      }
    },

    stopAll() {
      env?.setDucked?.(false);
      stopHeartbeat(0.1);
      cheer?.stop(0.1);
      cheer = null;
    },
  };
}

/** 실제 브라우저 환경(Web Audio). 브라우저에서만 부른다. 지원하지 않으면 null (그러면 효과음은 조용히 빠진다) */
export function createBrowserSfxEnv(): SfxEnv | null {
  if (typeof window === "undefined") return null;
  if (!getSharedAudioContext()) return null;
  const getContext = () => getSharedAudioContext()!;
  // 소리 잠금은 버튼을 누른 그 순간에 풀어야 한다(특히 아이폰). 이 함수는 "소리 켜고 시작" 버튼을 누를 때 불리므로 여기서 미리 만들고 깨운다
  void getContext().resume();

  /** 박수: 짧은 잡음 덩어리(손뼉 하나)를 무작위 시간에 많이 겹쳐 만든다. 처음엔 점점 늘고 끝으로 갈수록 줄어든다 */
  const makeApplause = (): AudioBuffer => {
    const ctx = getContext();
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * APPLAUSE_SEC);
    const buffer = ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    const claps = 260;
    for (let i = 0; i < claps; i++) {
      // 시간 분포: 앞쪽에 몰리다 서서히 드물어진다
      const start = Math.floor(Math.pow(Math.random(), 1.4) * (length - rate * 0.1));
      const loudness = 0.35 + Math.random() * 0.65;
      const decay = 0.012 + Math.random() * 0.02; // 손뼉 하나가 울리는 시간(초)
      const n = Math.floor(rate * decay * 5);
      let prev = 0;
      for (let k = 0; k < n && start + k < length; k++) {
        const noise = Math.random() * 2 - 1;
        const bright = noise - prev * 0.6; // 낮은 소리를 덜어내 "짝" 하는 느낌
        prev = noise;
        data[start + k] += bright * loudness * Math.exp(-k / (rate * decay));
      }
    }
    let peak = 0;
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak > 0) for (let i = 0; i < length; i++) data[i] /= peak;
    return buffer;
  };

  // 모든 효과음이 지나가는 공통 볼륨: 중계 멘트 동안 이 값을 낮춘다
  let master: GainNode | null = null;
  const getMaster = () => {
    const ctx = getContext();
    if (!master) {
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    return master;
  };

  return {
    setDucked(ducked) {
      const node = getMaster();
      const now = getContext().currentTime;
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(node.gain.value, now);
      node.gain.linearRampToValueAtTime(ducked ? SFX_DUCK_LEVEL : 1, now + 0.15);
    },
    async load(name) {
      if (name === "applause") {
        try {
          const response = await fetch(SFX_URLS.applause);
          if (!response.ok) throw new Error("박수 녹음을 불러오지 못했다");
          return await getContext().decodeAudioData(await response.arrayBuffer());
        } catch {
          return makeApplause(); // 파일을 못 읽어도 합성 박수는 난다
        }
      }
      const response = await fetch(SFX_URLS[name as keyof typeof SFX_URLS]);
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
      source.connect(gain).connect(getMaster());
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
