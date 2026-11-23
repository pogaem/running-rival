// 도중 방해 처리(lib/input/interruption.ts) 시험
import { describe, expect, it } from "vitest";
import { createInterruptionTracker } from "./interruption";

describe("createInterruptionTracker", () => {
  it("방해가 없으면 멈춘 시간이 0이다", () => {
    const tracker = createInterruptionTracker();
    for (let t = 1; t <= 10; t++) expect(tracker.onSample(t)).toEqual({ skip: false, interruptedSec: 0 });
    expect(tracker.count).toBe(0);
  });

  it("가려진 동안의 샘플은 버리고, 돌아오면 그 시간만큼 레이스 시간을 뺀다", () => {
    const tracker = createInterruptionTracker();
    tracker.onSample(10);
    tracker.hide();
    expect(tracker.onSample(11).skip).toBe(true);
    expect(tracker.onSample(20).skip).toBe(true);
    tracker.show();
    const back = tracker.onSample(40);
    expect(back).toEqual({ skip: false, interruptedSec: 30 }); // 10초에서 40초까지 30초 멈춤
    expect(tracker.onSample(41).interruptedSec).toBe(30);
    expect(tracker.count).toBe(1);
  });

  it("여러 번 가려지면 멈춘 시간이 쌓인다", () => {
    const tracker = createInterruptionTracker();
    tracker.onSample(5);
    tracker.hide();
    tracker.show();
    tracker.onSample(15); // 10초
    tracker.hide();
    tracker.show();
    expect(tracker.onSample(20).interruptedSec).toBe(15); // 15초에서 20초까지 5초 더
    expect(tracker.count).toBe(2);
  });

  it("가려지지 않았는데 show가 오거나 hide가 겹쳐도 어긋나지 않는다", () => {
    const tracker = createInterruptionTracker();
    tracker.show();
    expect(tracker.onSample(3).interruptedSec).toBe(0);
    tracker.hide();
    tracker.hide();
    tracker.show();
    expect(tracker.count).toBe(1);
  });
});
