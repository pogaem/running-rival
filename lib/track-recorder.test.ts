import { describe, expect, it } from "vitest";
import { createTrackRecorder } from "./track-recorder";

describe("createTrackRecorder", () => {
  it("250m를 넘을 때마다 그 시점을 직선으로 이어 점을 남긴다", () => {
    const rec = createTrackRecorder();
    for (let t = 1; t <= 100; t++) rec.add(t, t * 5); // 5m/s = 200초/km
    expect(rec.points.slice(0, 3)).toEqual([
      { t: 0, d: 0 },
      { t: 50, d: 250 },
      { t: 100, d: 500 },
    ]);
  });

  it("한 번에 여러 구간을 건너뛴 샘플도 빠짐없이 점을 남긴다", () => {
    const rec = createTrackRecorder();
    rec.add(10, 100);
    rec.add(70, 800); // 250, 500, 750을 한꺼번에 지남
    expect(rec.points.map((p) => p.d)).toEqual([0, 250, 500, 750]);
    expect(rec.points[1].t).toBeCloseTo(10 + (150 / 700) * 60, 0);
  });

  it("멈춰 있거나 거꾸로 가도 점이 늘지 않는다", () => {
    const rec = createTrackRecorder();
    rec.add(5, 20);
    rec.add(6, 20);
    rec.add(7, 10);
    expect(rec.points).toHaveLength(1);
  });

  it("끝 거리(5000m)에 닿으면 마지막 점이 정확히 5000m다", () => {
    const rec = createTrackRecorder();
    for (let t = 1; t <= 1700; t++) rec.add(t, Math.min(5000, t * 3.2));
    expect(rec.points[rec.points.length - 1].d).toBe(5000);
  });
});
