// 음성 출력 (PLAN.md 작업 9, PRD 5번 "음성 설계 원칙"·"안전 설계")
// 브라우저의 음성 읽기(Web Speech)로 멘트를 소리 내어 읽는다.
//  - 소리 크기에는 상한을 둔다.
//  - 음악이 나오는 중에도 들리도록, 되는 기기에서는 멘트 동안 다른 소리를 낮추고(덕킹),
//    안 되는 기기에서는 멘트 앞에 짧은 알림음을 넣는다.
//  - 추월·추월당함·결승처럼 급한 멘트는 지금 읽던 것을 끊고 바로 읽는다.
// 이 파일은 화면 코드가 아니라 출력부다. 브라우저 기능은 모두 "환경(SpeakerEnv)"으로 받아서,
// 시험에서는 가짜 환경을 끼워 소리 없이 동작을 확인할 수 있다.

import { getSharedAudioContext } from "./audio-context";

/** 소리 크기 상한(0~1). 어떤 경우에도 이보다 크게 읽지 않는다 (초안) */
export const VOICE_VOLUME_CAP = 0.8;
/** 읽는 속도 (1이 보통) */
export const VOICE_RATE = 1.05;
/** 알림음 높이(Hz)와 길이(초), 크기(0~1). 크기는 소리 크기 상한을 넘지 않는다 */
export const BEEP_FREQUENCY_HZ = 880;
export const BEEP_DURATION_SEC = 0.12;
export const BEEP_GAIN = 0.2;
/** 알림음이 끝나고 멘트를 읽기 시작하기까지 기다리는 시간(밀리초) */
export const BEEP_LEAD_MS = 150;
/** 읽기 시작 신호가 이 시간(밀리초) 안에 오지 않으면 실패로 본다 */
const START_TIMEOUT_MS = 4000;

/** 소리 크기를 상한 안으로 맞춘다 */
export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(Math.max(volume, 0), VOICE_VOLUME_CAP);
}

/** 브라우저의 SpeechSynthesisUtterance 중에서 쓰는 부분만 */
export type UtteranceLike = {
  text: string;
  lang: string;
  volume: number;
  rate: number;
  pitch: number;
  voice: unknown;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};

/** 브라우저의 speechSynthesis 중에서 쓰는 부분만 */
export type SpeechLike = {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  resume?(): void;
  getVoices(): { lang: string }[];
};

/** 브라우저의 오디오 세션(다른 앱 소리와 어떻게 섞을지 정하는 기능) 중에서 쓰는 부분만. 지원하는 기기에서만 있다 */
export type AudioSessionLike = { type: string };

/** 브라우저 기능을 모아 둔 환경 */
export type SpeakerEnv = {
  /** 음성 읽기. 지원하지 않으면 null */
  speech: SpeechLike | null;
  makeUtterance: (text: string) => UtteranceLike;
  /** 오디오 세션. 지원하지 않으면 null (그러면 알림음을 앞에 넣는다) */
  audioSession: AudioSessionLike | null;
  /** 짧은 알림음을 낸다. 낼 수 없으면 null */
  playBeep: (() => void) | null;
  /** 소리를 내도 되게 잠금을 푼다(사용자가 버튼을 누른 때 불러야 한다) */
  unlock: (() => void) | null;
  now: () => number;
  wait: (ms: number) => Promise<void>;
};

/** 읽기를 시도한 결과 */
export type SpeakResult =
  | {
      status: "started";
      /** 읽기가 실제로 시작된 실제 시계 시각(밀리초) */
      startedAtMs: number;
      /** 다른 소리를 낮추는 데 성공했는가 */
      ducked: boolean;
      /** 알림음을 앞에 넣었는가 */
      beeped: boolean;
    }
  | { status: "unsupported" }
  | { status: "error"; message: string };

export type SpeakOptions = {
  /** 급한 멘트: 지금 읽던 것을 끊고 바로 읽는다 */
  priority?: boolean;
};

export type Speaker = {
  /** 이 기기에서 음성 읽기를 쓸 수 있는가 */
  readonly supported: boolean;
  /** 다른 소리를 낮출 수 있는가(오디오 세션 지원). false이면 알림음을 앞에 넣는다 */
  readonly canDuck: boolean;
  /** 소리 잠금 풀기: 사용자가 버튼을 누른 때 불러야 한다. (그러지 않으면 브라우저가 소리를 막는다) */
  unlock(): void;
  speak(text: string, options?: SpeakOptions): Promise<SpeakResult>;
  /** 읽던 것을 멈춘다 */
  cancel(): void;
};

export function createSpeaker(env: SpeakerEnv): Speaker {
  const { speech } = env;

  /** 한국어 음성을 찾는다. 없으면 null (그러면 브라우저 기본 음성에 lang만 한국어로 알린다) */
  const findKoreanVoice = () => speech?.getVoices().find((voice) => voice.lang.toLowerCase().startsWith("ko")) ?? null;

  return {
    supported: speech !== null,
    canDuck: env.audioSession !== null,

    unlock() {
      env.unlock?.();
    },

    cancel() {
      speech?.cancel();
    },

    async speak(text, options = {}) {
      if (!speech) return { status: "unsupported" };
      if (options.priority) speech.cancel();

      // 음악 위에서도 들리게: 되는 기기는 멘트 동안 다른 소리를 낮추고, 안 되는 기기는 알림음을 앞에 넣는다
      let beeped = false;
      let ducked = false;
      let restoreSession: (() => void) | null = null;
      if (env.audioSession) {
        const session = env.audioSession;
        const previousType = session.type;
        try {
          session.type = "transient";
          ducked = true;
          restoreSession = () => {
            try {
              session.type = previousType;
            } catch {
              // 복구에 실패해도 읽기는 계속한다
            }
          };
        } catch {
          // 이 기기는 오디오 세션을 바꿀 수 없다: 알림음으로 대신한다
        }
      }
      if (!ducked && env.playBeep) {
        try {
          env.playBeep();
          beeped = true;
          await env.wait(BEEP_LEAD_MS);
        } catch {
          // 알림음이 안 나와도 읽기는 계속한다
        }
      }

      const utterance = env.makeUtterance(text);
      utterance.lang = "ko-KR";
      utterance.volume = clampVolume(VOICE_VOLUME_CAP);
      utterance.rate = VOICE_RATE;
      utterance.pitch = 1;
      utterance.voice = findKoreanVoice();

      return new Promise<SpeakResult>((resolve) => {
        let settled = false;
        const settle = (result: SpeakResult) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        utterance.onstart = () => settle({ status: "started", startedAtMs: env.now(), ducked, beeped });
        utterance.onend = () => restoreSession?.();
        utterance.onerror = (event) => {
          restoreSession?.();
          settle({ status: "error", message: event?.error ?? "음성 읽기 오류" });
        };
        void env.wait(START_TIMEOUT_MS).then(() => settle({ status: "error", message: "읽기 시작 신호가 오지 않았다" }));
        try {
          speech.speak(utterance);
        } catch (error) {
          restoreSession?.();
          settle({ status: "error", message: error instanceof Error ? error.message : "음성 읽기 실패" });
        }
      });
    },
  };
}

/**
 * 실제 브라우저 환경을 만든다. 브라우저에서만 부른다(서버에서 부르면 모든 기능이 "지원 안 됨"인 환경이 나온다).
 * 알림음은 Web Audio로 짧은 삐 소리를 직접 만든다(소리 파일이 필요 없다).
 */
export function createBrowserSpeakerEnv(): SpeakerEnv {
  const hasWindow = typeof window !== "undefined";
  const speech = hasWindow && "speechSynthesis" in window ? window.speechSynthesis : null;
  const audioSession =
    hasWindow && "audioSession" in navigator ? (navigator as unknown as { audioSession: AudioSessionLike }).audioSession : null;

  const getContext = () => getSharedAudioContext();

  return {
    speech: speech as unknown as SpeechLike | null,
    makeUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
    audioSession,
    playBeep: getSharedAudioContext()
      ? () => {
          const ctx = getContext();
          if (!ctx) return;
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.frequency.value = BEEP_FREQUENCY_HZ;
          gain.gain.value = Math.min(BEEP_GAIN, VOICE_VOLUME_CAP);
          oscillator.connect(gain).connect(ctx.destination);
          oscillator.start();
          oscillator.stop(ctx.currentTime + BEEP_DURATION_SEC);
        }
      : null,
    unlock: () => {
      // 브라우저는 사용자가 누르기 전에는 소리를 막는다. 눌렀을 때 소리 장치를 깨워 둔다
      void getContext()?.resume();
      if (speech) {
        // 이전 레이스에서 읽기가 멈춘 채 남아 있으면 새 멘트가 안 나오므로 비우고 깨운다
        speech.cancel();
        speech.resume?.();
        const warmUp = new SpeechSynthesisUtterance("");
        warmUp.volume = 0;
        speech.speak(warmUp);
      }
    },
    now: () => performance.now(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
