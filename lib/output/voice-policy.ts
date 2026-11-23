// 음성 중계 정책 (PLAN.md 작업 9, PRD 5번 "음성 설계 원칙", DESIGN.md 이벤트 표)
// 이벤트가 들어오면 "지금 말할지"만 정한다. 실제로 소리를 내는 일은 speaker.ts가 한다.
//  1) 중계 강도: 끄기 / 최소 / 일반 / 적극에 따라 말하는 이벤트가 다르다.
//  2) 최소 간격: 멘트와 멘트 사이에는 일정한 시간을 둔다. 단, 추월·추월당함·결승은 간격과 상관없이 바로 말한다.
// 시간은 모두 "레이스 안의 시간"(초)이다. 계산만 하고 소리·화면·브라우저 기능을 모른다.
import type { Prediction } from "../engine/catchup";
import type { RaceEvent } from "../engine/race-engine";

/** 중계 강도. off는 성공 기준을 재려고 중계를 끄는 실험용 옵션이다 */
export type Intensity = "off" | "minimal" | "normal" | "active";

/** 화면에 보여 줄 이름 */
export const INTENSITY_LABEL: Record<Intensity, string> = {
  off: "끄기(실험용)",
  minimal: "최소",
  normal: "일반",
  active: "적극",
};

/** 기본 중계 강도 */
export const DEFAULT_INTENSITY: Intensity = "normal";

/**
 * 멘트 사이의 최소 간격(실제 시계 기준 초). PRD 초안은 25초였다.
 * 데모는 10배속이라 레이스 시간으로는 이 값의 10배가 지나야 같은 느낌이 된다 → timeScale 옵션으로 곱한다.
 */
export const VOICE_MIN_GAP_SEC = 5;

/** 적극은 추월 예측·승률 변화까지 말해서 멘트가 쉴 틈 없이 이어지기 쉽다. 한마디 하고 쉬도록 간격을 더 둔다 */
export const ACTIVE_VOICE_MIN_GAP_SEC = 7;

/** 숫자 없이 "따라붙고 있습니다"만 말하는 예측은 이만큼(초) 간격을 두고 말한다 (같은 말이 반복되지 않게. 초안) */
export const VAGUE_PREDICTION_GAP_SEC = 60;

/** 간격을 무시하고 바로 말하는 이벤트 (PRD: 추월·역전·결승) */
const PRIORITY_EVENTS: ReadonlySet<RaceEvent["type"]> = new Set(["overtake", "overtaken", "finish"]);

/** 강도별로 말하는 이벤트 (DESIGN.md 이벤트 표) */
const EVENTS_BY_INTENSITY: Record<Intensity, ReadonlySet<RaceEvent["type"]>> = {
  off: new Set(),
  minimal: new Set(["overtake", "overtaken", "finish"]),
  normal: new Set(["overtake", "overtaken", "finish", "last200m", "km", "closeEnter", "closeLeave", "start", "half", "status"]),
  active: new Set([
    "overtake",
    "overtaken",
    "finish",
    "last200m",
    "km",
    "closeEnter",
    "closeLeave",
    "winStage",
    "start",
    "half",
    "status",
  ]),
};

/** 이 이벤트가 간격을 무시하고 바로 나가는 이벤트인가 */
export function isPriorityEvent(event: RaceEvent): boolean {
  return PRIORITY_EVENTS.has(event.type);
}

/** 이 강도에서 이 이벤트를 말하는가 (간격은 보지 않는다) */
export function intensityAllows(intensity: Intensity, event: RaceEvent): boolean {
  return EVENTS_BY_INTENSITY[intensity].has(event.type);
}

/** 이 강도에서 추월 예측을 말하는가 */
export function intensityAllowsPrediction(intensity: Intensity): boolean {
  return intensity === "active";
}

/** 말할지 정한 결과. 말하지 않으면 이유가 함께 온다 */
export type VoiceDecision =
  | { speak: true; priority: boolean }
  | { speak: false; reason: "off" | "intensity" | "gap" };

export type VoicePolicy = {
  /** 지금의 중계 강도 */
  intensity: Intensity;
  /** 중계 강도를 바꾼다 */
  setIntensity(intensity: Intensity): void;
  /** 이벤트를 지금 말할지 정한다. 말하기로 하면 "마지막으로 말한 시각"을 이 이벤트의 시각으로 바꾼다 */
  decideEvent(event: RaceEvent): VoiceDecision;
  /**
   * 지금의 추월 예측을 말할지 정한다. 적극에서만 말하고, 최소 간격을 지킨다.
   * 숫자로 말하는 예측이 아니면 "따라붙고 있습니다" 같은 말이 반복되지 않게 더 긴 간격을 둔다.
   */
  decidePrediction(t: number, prediction: Prediction | null): VoiceDecision;
};

export type VoicePolicyOptions = {
  intensity?: Intensity;
  /** 멘트 사이의 최소 간격(초). 기본 25 */
  minGapSec?: number;
  /** 레이스 시간이 실제 시계보다 몇 배 빠른가. 데모 10배속이면 10, 실제 GPS는 1(기본). 기본 간격에 곱해진다 */
  timeScale?: number;
};

export function createVoicePolicy(options: VoicePolicyOptions = {}): VoicePolicy {
  if (options.minGapSec !== undefined && !(options.minGapSec >= 0)) throw new Error("최소 간격은 0 이상이어야 한다");
  let intensity: Intensity = options.intensity ?? DEFAULT_INTENSITY;
  let lastSpokenAt: number | null = null;
  let lastVagueAt: number | null = null;

  // 간격을 직접 정하지 않으면 강도에 맞는 기본 간격을 쓴다
  const minGap = () => options.minGapSec ??
    (intensity === "active" ? ACTIVE_VOICE_MIN_GAP_SEC : VOICE_MIN_GAP_SEC) * (options.timeScale ?? 1);
  const gapOk = (t: number) => lastSpokenAt === null || t - lastSpokenAt >= minGap();

  return {
    get intensity() {
      return intensity;
    },
    setIntensity(next) {
      intensity = next;
    },

    decideEvent(event) {
      if (intensity === "off") return { speak: false, reason: "off" };
      if (!intensityAllows(intensity, event)) return { speak: false, reason: "intensity" };
      const priority = isPriorityEvent(event);
      if (!priority && !gapOk(event.t)) return { speak: false, reason: "gap" };
      lastSpokenAt = event.t;
      return { speak: true, priority };
    },

    decidePrediction(t, prediction) {
      if (intensity === "off") return { speak: false, reason: "off" };
      if (!prediction || !intensityAllowsPrediction(intensity)) return { speak: false, reason: "intensity" };
      if (!gapOk(t)) return { speak: false, reason: "gap" };
      if (prediction.speak === "vague") {
        if (lastVagueAt !== null && t - lastVagueAt < VAGUE_PREDICTION_GAP_SEC * (options.timeScale ?? 1)) return { speak: false, reason: "gap" };
        lastVagueAt = t;
      }
      lastSpokenAt = t;
      return { speak: true, priority: false };
    },
  };
}
