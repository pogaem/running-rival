// 진동 출력 (PLAN.md 작업 11, PRD 5번, DESIGN.md 이벤트 표의 "진동" 열)
//  - 추월: 짧게 2번 / 추월당함: 길게 1번 / 마지막 200m: 연속. 그 밖의 이벤트는 진동이 없다.
//  - 이 기기가 진동을 지원하지 않으면(예: iPhone 사파리) 조용히 건너뛰고, 음성과 자막만 쓴다.
// 브라우저 기능은 "환경(VibratorEnv)"으로 받아서, 시험에서는 가짜 환경으로 동작만 확인한다.
import type { RaceEvent } from "../engine/race-engine";

/** 진동 패턴(밀리초): 떨림, 쉼, 떨림, ... 순서로 번갈아 쓴다 (초안) */
export const HAPTIC_PATTERNS: Partial<Record<RaceEvent["type"], number[]>> = {
  overtake: [150, 100, 150],
  overtaken: [700],
  last200m: [200, 100, 200, 100, 200, 100, 200, 100, 200],
};

/** 이 이벤트의 진동 패턴. 진동이 없는 이벤트는 null */
export function hapticPatternFor(event: RaceEvent): number[] | null {
  return HAPTIC_PATTERNS[event.type] ?? null;
}

/** 로그에 남기는 진동 상태 */
export type HapticStatus =
  /** 진동을 냈다. delayMs는 판정부터 진동 요청까지 걸린 시간(밀리초). PRD 기준은 3초 이내 */
  | { state: "sent"; pattern: number[]; atMs: number; delayMs: number }
  /** 진동을 내지 않았다: 이 이벤트는 진동이 없음 / 중계 강도에 맞지 않음 / 이 기기가 지원하지 않음 / 요청이 거절됨 */
  | { state: "skipped"; reason: "none" | "intensity" | "unsupported" | "failed" };

export type VibratorEnv = {
  /** 브라우저의 진동 요청. 지원하지 않으면 null. 요청이 받아들여지면 true */
  vibrate: ((pattern: number[]) => boolean) | null;
  now: () => number;
};

export type Vibrator = {
  /** 이 기기에서 진동을 쓸 수 있는가 */
  readonly supported: boolean;
  /** 이벤트의 진동을 낸다. 판정 시각(decidedAtMs)을 받아 지연을 함께 돌려준다 */
  vibrate(event: RaceEvent, decidedAtMs: number): HapticStatus;
  /** 진행 중인 진동을 멈춘다 */
  cancel(): void;
};

export function createVibrator(env: VibratorEnv): Vibrator {
  return {
    supported: env.vibrate !== null,

    vibrate(event, decidedAtMs) {
      const pattern = hapticPatternFor(event);
      if (!pattern) return { state: "skipped", reason: "none" };
      if (!env.vibrate) return { state: "skipped", reason: "unsupported" };
      try {
        if (!env.vibrate(pattern)) return { state: "skipped", reason: "failed" };
      } catch {
        return { state: "skipped", reason: "failed" };
      }
      const atMs = env.now();
      return { state: "sent", pattern, atMs, delayMs: atMs - decidedAtMs };
    },

    cancel() {
      try {
        env.vibrate?.([0]);
      } catch {
        // 멈추지 못해도 괜찮다
      }
    },
  };
}

/** 실제 브라우저 환경. 브라우저에서만 부른다(서버에서는 "지원 안 됨"인 환경이 나온다) */
export function createBrowserVibratorEnv(): VibratorEnv {
  const supported = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  return {
    vibrate: supported ? (pattern) => navigator.vibrate(pattern) : null,
    now: () => performance.now(),
  };
}
