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
 * 멘트 사이의 최소 간격(실제로 듣는 시간 기준 초). 음성은 실제 시간이 걸려 읽히므로 "실제 시계 4초"가 기준이다.
 * 레이스 시간은 데모(10배속)에서 10배 빨리 흐르므로 timeScale(10)을 곱해 같은 4초로 맞춘다. 실제 GPS는 1배라 그대로 4초.
 */
export const VOICE_MIN_GAP_SEC = 4;

/** 적극도 같은 간격. 0.25km마다 중간 상황이 나오는데 간격이 더 길면(빠른 페이스·데모에서) 말이 계속 건너뛰어진다 */
export const ACTIVE_VOICE_MIN_GAP_SEC = 4;

/** 간격을 무시하고 바로 말하는 이벤트 (PRD: 추월·역전·결승) */
const PRIORITY_EVENTS: ReadonlySet<RaceEvent["type"]> = new Set(["overtake", "overtaken", "finish"]);

/** 강도별로 말하는 이벤트 (DESIGN.md 이벤트 표) */
const EVENTS_BY_INTENSITY: Record<Intensity, ReadonlySet<RaceEvent["type"]>> = {
  off: new Set(),
  minimal: new Set(["overtake", "overtaken", "finish", "start", "closeEnter", "closeLeave"]),
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
   * 숫자로 말해도 되는 예측만 말한다("따라붙고 있습니다" 같은 숫자 없는 예측은 말하지 않는다).
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
      // 설계: 숫자로 말해도 되는 조건(예상 시점 60초 이내 + 페이스 흔들림 작음)일 때만 말한다. 아니면 화면 "지금 예상"에만 보인다
      if (prediction.speak !== "number") return { speak: false, reason: "intensity" };
      if (!gapOk(t)) return { speak: false, reason: "gap" };
      lastSpokenAt = t;
      return { speak: true, priority: false };
    },
  };
}
