// 음성 중계 정책(lib/output/voice-policy.ts) 시험
import { describe, expect, it } from "vitest";
import type { Prediction } from "../engine/catchup";
import type { RaceEvent } from "../engine/race-engine";
import {
  createVoicePolicy,
  DEFAULT_INTENSITY,
  intensityAllows,
  intensityAllowsPrediction,
  isPriorityEvent,
  VAGUE_PREDICTION_GAP_SEC,
  VOICE_MIN_GAP_SEC,
  ACTIVE_VOICE_MIN_GAP_SEC,
  type Intensity,
} from "./voice-policy";

const OVERTAKE = (t: number): RaceEvent => ({ type: "overtake", t, gapM: 12 });
const OVERTAKEN = (t: number): RaceEvent => ({ type: "overtaken", t, gapM: -12 });
const KM = (t: number, km = 1): RaceEvent => ({ type: "km", t, km });
const LAST200 = (t: number): RaceEvent => ({ type: "last200m", t });
const CLOSE = (t: number): RaceEvent => ({ type: "closeEnter", t, gapM: -9 });
const STAGE = (t: number): RaceEvent => ({ type: "winStage", t, from: "close", to: "advantage", probability: 0.75 });
const FINISH = (t: number): RaceEvent => ({ type: "finish", t, won: true });

describe("설정값", () => {
  it("기본 강도는 일반이고, 최소 간격은 5초 안팎이다 (중계 빈도는 0.35km 거리 간격이 정하고, 이 간격은 멘트끼리 겹치지 않게만 한다)", () => {
    expect(DEFAULT_INTENSITY).toBe("normal");
    expect(VOICE_MIN_GAP_SEC).toBeGreaterThanOrEqual(4);
    expect(VOICE_MIN_GAP_SEC).toBeLessThanOrEqual(15);
  });
});

describe("중계 강도별로 말하는 이벤트 (DESIGN.md 이벤트 표)", () => {
  const events: [string, RaceEvent][] = [
    ["추월", OVERTAKE(1)],
    ["추월당함", OVERTAKEN(1)],
    ["결승", FINISH(1)],
    ["마지막 200m", LAST200(1)],
    ["1km 통과", KM(1)],
    ["접전", CLOSE(1)],
    ["승률 단계", STAGE(1)],
  ];
  // 각 이벤트를 [끄기, 최소, 일반, 적극]에서 말하는지
  const expected: Record<string, [boolean, boolean, boolean, boolean]> = {
    추월: [false, true, true, true],
    추월당함: [false, true, true, true],
    결승: [false, true, true, true],
    "마지막 200m": [false, false, true, true],
    "1km 통과": [false, false, true, true],
    접전: [false, true, true, true],
    "승률 단계": [false, false, false, true],
  };
  const intensities: Intensity[] = ["off", "minimal", "normal", "active"];

  it.each(events)("%s", (name, event) => {
    expected[name].forEach((want, i) => {
      expect(intensityAllows(intensities[i], event)).toBe(want);
    });
  });

  it("접전에서 벗어나는 이벤트는 접전과 같은 강도에서 말한다", () => {
    expect(intensityAllows("normal", { type: "closeLeave", t: 1, gapM: 16 })).toBe(true);
    expect(intensityAllows("minimal", { type: "closeLeave", t: 1, gapM: 16 })).toBe(true);
  });

  it("추월 예측은 적극에서만 말한다", () => {
    expect(intensities.map(intensityAllowsPrediction)).toEqual([false, false, false, true]);
  });

  it("추월·추월당함·결승이 간격을 무시하는 이벤트이다", () => {
    expect([OVERTAKE(1), OVERTAKEN(1), FINISH(1)].every(isPriorityEvent)).toBe(true);
    expect([KM(1), LAST200(1), CLOSE(1), STAGE(1)].some(isPriorityEvent)).toBe(false);
  });
});

describe("createVoicePolicy · 이벤트 (최소 간격)", () => {
  it("처음 이벤트는 바로 말한다", () => {
    const policy = createVoicePolicy();
    expect(policy.decideEvent(KM(320))).toEqual({ speak: true, priority: false });
  });

  it("직전 멘트 뒤 5초가 지나지 않은 일반 이벤트는 말하지 않는다", () => {
    const policy = createVoicePolicy();
    policy.decideEvent(KM(100));
    expect(policy.decideEvent(LAST200(103))).toEqual({ speak: false, reason: "gap" });
    expect(policy.decideEvent(LAST200(104.9))).toEqual({ speak: false, reason: "gap" });
    expect(policy.decideEvent(LAST200(105))).toEqual({ speak: true, priority: false }); // 정확히 5초는 허용
  });

  it("적극은 한마디 하고 더 길게 쉰다 (일반보다 긴 간격)", () => {
    expect(ACTIVE_VOICE_MIN_GAP_SEC).toBeGreaterThan(VOICE_MIN_GAP_SEC);
    const policy = createVoicePolicy({ intensity: "active" });
    policy.decideEvent(KM(100));
    expect(policy.decideEvent(LAST200(100 + ACTIVE_VOICE_MIN_GAP_SEC - 0.1))).toEqual({ speak: false, reason: "gap" });
    expect(policy.decideEvent(LAST200(100 + ACTIVE_VOICE_MIN_GAP_SEC))).toEqual({ speak: true, priority: false });
  });

  it("데모 10배속(timeScale 10)이면 레이스 시간으로 10배 더 쉰다 (실제로 듣는 간격은 같다)", () => {
    const policy = createVoicePolicy({ timeScale: 10 });
    policy.decideEvent(KM(100));
    expect(policy.decideEvent(LAST200(100 + VOICE_MIN_GAP_SEC * 10 - 1))).toEqual({ speak: false, reason: "gap" });
    expect(policy.decideEvent(LAST200(100 + VOICE_MIN_GAP_SEC * 10))).toEqual({ speak: true, priority: false });
  });

  it("말하지 않은 이벤트는 간격을 새로 시작하지 않는다 (건너뛴 이벤트 때문에 다음 멘트가 늦어지지 않는다)", () => {
    const policy = createVoicePolicy();
    policy.decideEvent(KM(100)); // 말함
    policy.decideEvent(CLOSE(110)); // 간격 때문에 건너뜀
    expect(policy.decideEvent(LAST200(125))).toEqual({ speak: true, priority: false });
  });

  it("추월·추월당함·결승은 간격과 상관없이 바로 말한다", () => {
    const policy = createVoicePolicy();
    policy.decideEvent(KM(100));
    expect(policy.decideEvent(OVERTAKE(101))).toEqual({ speak: true, priority: true });
    expect(policy.decideEvent(OVERTAKEN(102))).toEqual({ speak: true, priority: true });
    expect(policy.decideEvent(FINISH(103))).toEqual({ speak: true, priority: true });
  });

  it("바로 말한 추월도 간격을 새로 시작한다 (그 뒤 일반 이벤트는 5초 기다린다)", () => {
    const policy = createVoicePolicy();
    policy.decideEvent(OVERTAKE(100));
    expect(policy.decideEvent(KM(103))).toEqual({ speak: false, reason: "gap" });
    expect(policy.decideEvent(KM(105))).toEqual({ speak: true, priority: false });
  });

  it("강도에 맞지 않는 이벤트는 간격과 상관없이 말하지 않는다", () => {
    const policy = createVoicePolicy({ intensity: "minimal" });
    expect(policy.decideEvent(KM(500))).toEqual({ speak: false, reason: "intensity" });
    expect(policy.decideEvent(OVERTAKE(501))).toEqual({ speak: true, priority: true });
  });

  it("끄기에서는 아무것도 말하지 않는다", () => {
    const policy = createVoicePolicy({ intensity: "off" });
    expect(policy.decideEvent(OVERTAKE(100))).toEqual({ speak: false, reason: "off" });
    expect(policy.decideEvent(FINISH(200))).toEqual({ speak: false, reason: "off" });
  });

  it("중간에 강도를 바꾸면 바로 적용된다", () => {
    const policy = createVoicePolicy({ intensity: "minimal" });
    expect(policy.decideEvent(KM(100)).speak).toBe(false);
    policy.setIntensity("normal");
    expect(policy.intensity).toBe("normal");
    expect(policy.decideEvent(KM(101)).speak).toBe(true);
  });

  it("최소 간격을 바꿀 수 있고, 음수는 오류를 던진다", () => {
    const policy = createVoicePolicy({ minGapSec: 10 });
    policy.decideEvent(KM(100));
    expect(policy.decideEvent(LAST200(110)).speak).toBe(true);
    expect(() => createVoicePolicy({ minGapSec: -1 })).toThrow("0 이상");
  });
});

describe("createVoicePolicy · 추월 예측", () => {
  const prediction = (speak: Prediction["speak"], type: Prediction["type"] = "overtake"): Prediction => ({
    type,
    inSec: 30,
    atRaceTimeSec: 130,
    speak,
  });

  it("적극이 아니면 예측을 말하지 않는다", () => {
    for (const intensity of ["minimal", "normal"] as Intensity[]) {
      const policy = createVoicePolicy({ intensity });
      expect(policy.decidePrediction(100, prediction("number"))).toEqual({ speak: false, reason: "intensity" });
    }
    expect(createVoicePolicy({ intensity: "off" }).decidePrediction(100, prediction("number"))).toEqual({
      speak: false,
      reason: "off",
    });
  });

  it("예측이 없으면 말하지 않는다", () => {
    const policy = createVoicePolicy({ intensity: "active" });
    expect(policy.decidePrediction(100, null)).toEqual({ speak: false, reason: "intensity" });
  });

  it("적극에서는 숫자로 말하는 예측을 최소 간격마다 말한다", () => {
    const policy = createVoicePolicy({ intensity: "active" });
    expect(policy.decidePrediction(100, prediction("number")).speak).toBe(true);
    expect(policy.decidePrediction(104, prediction("number"))).toEqual({ speak: false, reason: "gap" });
    expect(policy.decidePrediction(120, prediction("number")).speak).toBe(true);
  });

  it("숫자 없는 예측('따라붙고 있습니다')은 더 긴 간격(60초)을 둔다", () => {
    const policy = createVoicePolicy({ intensity: "active" });
    expect(policy.decidePrediction(100, prediction("vague")).speak).toBe(true);
    expect(policy.decidePrediction(130, prediction("vague"))).toEqual({ speak: false, reason: "gap" });
    expect(policy.decidePrediction(100 + VAGUE_PREDICTION_GAP_SEC, prediction("vague")).speak).toBe(true);
  });

  it("예측도 일반 멘트와 같은 간격 규칙을 함께 쓴다", () => {
    const policy = createVoicePolicy({ intensity: "active" });
    policy.decideEvent(KM(100));
    expect(policy.decidePrediction(103, prediction("number"))).toEqual({ speak: false, reason: "gap" });
    // 반대로 예측을 말한 직후의 일반 이벤트도 기다린다
    expect(policy.decidePrediction(120, prediction("number")).speak).toBe(true);
    expect(policy.decideEvent(LAST200(123))).toEqual({ speak: false, reason: "gap" });
  });

  it("추월 같은 우선 이벤트는 예측 직후에도 바로 말한다", () => {
    const policy = createVoicePolicy({ intensity: "active" });
    policy.decidePrediction(100, prediction("number"));
    expect(policy.decideEvent(OVERTAKE(101))).toEqual({ speak: true, priority: true });
  });
});
