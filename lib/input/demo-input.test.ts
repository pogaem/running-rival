// 데모 모드 입력(lib/input/demo-input.ts) 시험
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoInput, DEMO_SPEED } from "./demo-input";
import { makeDemoTrack } from "./synthetic-track";
import type { PositionSample } from "./types";

/** 시험용 짧은 경로: 0, 1, 2, 3, 4초에 점이 하나씩 */
function shortTrack(): PositionSample[] {
  return [0, 1, 2, 3, 4].map((t) => ({ t, lat: 37.5, lon: 127 + t * 0.00001, accuracyM: 5, ele: null }));
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createDemoInput (10배속 재생)", () => {
  it("기본 재생 속도는 10배속이다", () => {
    expect(DEMO_SPEED).toBe(10);
  });

  it("첫 점은 시작하자마자 나오고, 다음 점들은 10배 빠르게(레이스 1초 = 실제 0.1초) 나온다", () => {
    const received: number[] = [];
    createDemoInput(shortTrack()).start({ onSample: (s) => received.push(s.t) });

    expect(received).toEqual([0]);
    vi.advanceTimersByTime(99);
    expect(received).toEqual([0]);
    vi.advanceTimersByTime(1);
    expect(received).toEqual([0, 1]);
    vi.advanceTimersByTime(300);
    expect(received).toEqual([0, 1, 2, 3, 4]);
  });

  it("일시정지하면 점이 멈추고, 이어가면 멈췄던 자리에서 이어진다 (끝나지도 않는다)", () => {
    const received: number[] = [];
    const onEnd = vi.fn();
    const input = createDemoInput(shortTrack());
    input.start({ onSample: (s) => received.push(s.t), onEnd });
    vi.advanceTimersByTime(150); // 0, 1
    input.pause?.();
    vi.advanceTimersByTime(10000);
    expect(received).toEqual([0, 1]);
    expect(onEnd).not.toHaveBeenCalled();
    input.resume?.();
    vi.advanceTimersByTime(49); // 다음 점(2초)은 원래 200ms 시점 → 멈추기 전 50ms 남았다
    expect(received).toEqual([0, 1]);
    vi.advanceTimersByTime(1);
    expect(received).toEqual([0, 1, 2]);
    vi.advanceTimersByTime(300);
    expect(received).toEqual([0, 1, 2, 3, 4]);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("마지막 점을 보낸 뒤 끝났다고 한 번만 알린다", () => {
    const onEnd = vi.fn();
    createDemoInput(shortTrack()).start({ onSample: () => {}, onEnd });

    vi.advanceTimersByTime(399);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("점에 담긴 시간(t)은 재생 속도와 상관없이 레이스 시간 그대로다", () => {
    const received: PositionSample[] = [];
    const track = shortTrack();
    createDemoInput(track).start({ onSample: (s) => received.push(s) });
    vi.advanceTimersByTime(1000);
    expect(received.map((s) => s.t)).toEqual([0, 1, 2, 3, 4]);
    expect(received[2]).toBe(track[2]);
  });

  it("속도를 바꿀 수 있다 (2배속이면 레이스 1초 = 실제 0.5초)", () => {
    const received: number[] = [];
    createDemoInput(shortTrack(), { speed: 2 }).start({ onSample: (s) => received.push(s.t) });
    vi.advanceTimersByTime(499);
    expect(received).toEqual([0]);
    vi.advanceTimersByTime(1);
    expect(received).toEqual([0, 1]);
  });

  it("타이머가 한꺼번에 늦게 울려도 점을 순서대로 빠짐없이 보낸다", () => {
    const received: number[] = [];
    createDemoInput(shortTrack()).start({ onSample: (s) => received.push(s.t) });
    vi.advanceTimersByTime(10_000);
    expect(received).toEqual([0, 1, 2, 3, 4]);
  });

  it("멈추면 더 이상 점이 나오지 않고, 끝났다는 알림도 없다", () => {
    const received: number[] = [];
    const onEnd = vi.fn();
    const input = createDemoInput(shortTrack());
    input.start({ onSample: (s) => received.push(s.t), onEnd });
    vi.advanceTimersByTime(100);
    input.stop();
    vi.advanceTimersByTime(10_000);
    expect(received).toEqual([0, 1]);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("점을 받다가 받는 쪽이 멈춰도 안전하다", () => {
    const received: number[] = [];
    const input = createDemoInput(shortTrack());
    input.start({
      onSample: (s) => {
        received.push(s.t);
        if (s.t === 2) input.stop();
      },
    });
    vi.advanceTimersByTime(10_000);
    expect(received).toEqual([0, 1, 2]);
  });

  it("한 번 시작하거나 멈춘 입력은 다시 시작할 수 없다", () => {
    const started = createDemoInput(shortTrack());
    started.start({ onSample: () => {} });
    expect(() => started.start({ onSample: () => {} })).toThrow("한 번만");

    const stopped = createDemoInput(shortTrack());
    stopped.stop();
    expect(() => stopped.start({ onSample: () => {} })).toThrow("한 번만");
  });

  it("잘못된 경로나 속도는 만들 때 오류를 던진다", () => {
    expect(() => createDemoInput([])).toThrow("비어 있다");
    expect(() => createDemoInput(shortTrack(), { speed: 0 })).toThrow("0보다 커야");
    const backwards = shortTrack();
    backwards[3] = { ...backwards[3], t: 0.5 };
    expect(() => createDemoInput(backwards)).toThrow("시간이 앞 점보다 작다");
  });

  it("5km 데모 경로(1600초)는 실제로 160초 만에 모두 재생된다", () => {
    const track = makeDemoTrack();
    let count = 0;
    const onEnd = vi.fn();
    createDemoInput(track).start({ onSample: () => count++, onEnd });

    vi.advanceTimersByTime(159_999);
    expect(onEnd).not.toHaveBeenCalled();
    expect(count).toBeLessThan(track.length);
    vi.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(count).toBe(track.length);
  });
});
