// 진동 출력(lib/output/haptics.ts) 시험: 가짜 환경으로 진동 없이 동작만 확인한다
import { describe, expect, it } from "vitest";
import type { RaceEvent } from "../engine/race-engine";
import { createVibrator, HAPTIC_PATTERNS, hapticPatternFor, type VibratorEnv } from "./haptics";

const overtake: RaceEvent = { type: "overtake", t: 100, gapM: 12 };
const overtaken: RaceEvent = { type: "overtaken", t: 100, gapM: -12 };
const last200m: RaceEvent = { type: "last200m", t: 1500 };

function makeEnv(accept = true, throws = false) {
  const requests: number[][] = [];
  const env: VibratorEnv = {
    vibrate: (pattern) => {
      if (throws) throw new Error("거절");
      requests.push(pattern);
      return accept;
    },
    now: () => 5100,
  };
  return { env, requests };
}

describe("진동 패턴 (DESIGN 이벤트 표)", () => {
  it("추월은 짧게 2번이다", () => {
    const pattern = hapticPatternFor(overtake)!;
    expect(pattern).toHaveLength(3); // 떨림, 쉼, 떨림
    expect(pattern[0]).toBe(pattern[2]);
    expect(pattern[0]).toBeLessThan(300);
  });

  it("추월당함은 길게 1번이다", () => {
    const pattern = hapticPatternFor(overtaken)!;
    expect(pattern).toHaveLength(1);
    expect(pattern[0]).toBeGreaterThan(HAPTIC_PATTERNS.overtake![0]);
  });

  it("마지막 200m는 연속해서 떨린다 (떨림이 여러 번)", () => {
    const pattern = hapticPatternFor(last200m)!;
    expect(pattern.length).toBeGreaterThanOrEqual(5);
  });

  it("그 밖의 이벤트는 진동이 없다", () => {
    const others: RaceEvent[] = [
      { type: "finish", t: 1, won: true },
      { type: "km", t: 1, km: 1 },
      { type: "closeEnter", t: 1, gapM: 5 },
      { type: "closeLeave", t: 1, gapM: 20 },
      { type: "winStage", t: 1, from: "close", to: "advantage", probability: 0.8 },
    ];
    for (const event of others) expect(hapticPatternFor(event)).toBeNull();
  });
});

describe("createVibrator", () => {
  it("진동을 내고, 판정부터 진동 요청까지 걸린 시간을 알려 준다", () => {
    const { env, requests } = makeEnv();
    const status = createVibrator(env).vibrate(overtake, 5000);
    expect(status).toEqual({ state: "sent", pattern: HAPTIC_PATTERNS.overtake, atMs: 5100, delayMs: 100 });
    expect(requests).toEqual([HAPTIC_PATTERNS.overtake]);
  });

  it("진동이 없는 이벤트는 진동을 요청하지 않는다", () => {
    const { env, requests } = makeEnv();
    expect(createVibrator(env).vibrate({ type: "km", t: 1, km: 1 }, 0)).toEqual({ state: "skipped", reason: "none" });
    expect(requests).toHaveLength(0);
  });

  it("진동을 지원하지 않는 기기는 지원 안 됨으로 건너뛴다", () => {
    const vibrator = createVibrator({ vibrate: null, now: () => 0 });
    expect(vibrator.supported).toBe(false);
    expect(vibrator.vibrate(overtake, 0)).toEqual({ state: "skipped", reason: "unsupported" });
    expect(() => vibrator.cancel()).not.toThrow();
  });

  it("브라우저가 요청을 거절하거나 예외가 나면 실패로 건너뛴다", () => {
    expect(createVibrator(makeEnv(false).env).vibrate(overtake, 0)).toEqual({ state: "skipped", reason: "failed" });
    expect(createVibrator(makeEnv(true, true).env).vibrate(overtake, 0)).toEqual({ state: "skipped", reason: "failed" });
  });

  it("멈추기는 0 길이 진동을 요청한다", () => {
    const { env, requests } = makeEnv();
    createVibrator(env).cancel();
    expect(requests).toEqual([[0]]);
  });
});
