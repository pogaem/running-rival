import { describe, expect, it } from "vitest";
import { createElevationTracker } from "./elevation";

describe("createElevationTracker", () => {
  it("고도를 받은 적이 없으면 null(고도 정보 없음)이다", () => {
    const tracker = createElevationTracker();
    tracker.update(null);
    expect(tracker.gainM).toBeNull();
  });

  it("올라간 높이만 더하고 내려간 높이는 더하지 않는다", () => {
    const tracker = createElevationTracker();
    [10, 15, 25, 20, 12, 30].forEach((e) => tracker.update(e));
    expect(tracker.gainM).toBe(5 + 10 + 18); // 10→15→25 올라감, →12까지 내려감, →30 올라감
  });

  it("5m보다 작은 흔들림은 쌓이지 않는다", () => {
    const tracker = createElevationTracker();
    for (let i = 0; i < 100; i++) tracker.update(20 + (i % 2 === 0 ? 1.5 : -1.5)); // ±1.5m 흔들림 100번
    expect(tracker.gainM).toBe(0);
  });

  it("고도가 중간에 빠져도(null) 이어서 센다", () => {
    const tracker = createElevationTracker();
    tracker.update(10);
    tracker.update(null);
    tracker.update(20);
    expect(tracker.gainM).toBe(10);
  });
});
