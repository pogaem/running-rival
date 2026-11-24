// 오차를 섞은 시험 경로(데모가 쓴다) 시험: 보정과 자동 일시정지를 거쳐도 도착선을 넘고, 엉뚱한 멈춤이 없어야 한다
import { describe, expect, it } from "vitest";
import { distanceBetweenM } from "../geo";
import { createAutoPause } from "./auto-pause";
import { createPositionFilter } from "./gps-filter";
import { makeNoisyTrack } from "./synthetic-track";

function run(paceSecPerKm: number, distanceM: number, seed = 7) {
  const track = makeNoisyTrack({ paceSecPerKm, distanceM, seed });
  const filter = createPositionFilter();
  const autoPause = createAutoPause();
  let previous: { lat: number; lon: number } | null = null;
  let traveled = 0;
  let pausedTicks = 0;
  let finishAt: number | null = null;
  for (const raw of track) {
    const filtered = filter.push(raw);
    if (!filtered.accepted) continue;
    if (previous) traveled += distanceBetweenM(previous, filtered.sample);
    previous = filtered.sample;
    const pause = autoPause.update(filtered.sample.t, traveled);
    if (pause.paused) pausedTicks += 1;
    if (finishAt === null && traveled >= distanceM) finishAt = pause.raceTimeSec;
  }
  return { track, filter, pausedTicks, finishAt };
}

describe("makeNoisyTrack (오차 섞은 데모 경로)", () => {
  it("같은 씨앗이면 늘 같은 경로다", () => {
    const a = makeNoisyTrack({ paceSecPerKm: 330, distanceM: 3000 });
    const b = makeNoisyTrack({ paceSecPerKm: 330, distanceM: 3000 });
    expect(a).toEqual(b);
  });

  it("정확도 나쁜 점·튀는 점·끊김이 실제로 들어 있다", () => {
    const { track, filter } = run(330, 5000);
    expect(track.some((p) => p.accuracyM > 30)).toBe(true);
    expect(filter.rejected.accuracy).toBeGreaterThan(0);
    expect(filter.rejected.speed).toBeGreaterThan(0);
    const gaps = track.filter((p, i) => i > 0 && p.t - track[i - 1].t >= 4);
    expect(gaps.length).toBeGreaterThan(0);
  });

  it.each([
    [330, 1000],
    [330, 3000],
    [270, 5000],
  ])("보정과 자동 일시정지를 거쳐도 %i초/km %im를 끝까지 달리고, 엉뚱한 멈춤이 없다", (pace, distance) => {
    const { pausedTicks, finishAt } = run(pace, distance);
    expect(finishAt).not.toBeNull();
    const ideal = (distance / 1000) * pace;
    expect(Math.abs((finishAt as number) - ideal)).toBeLessThan(8); // 이동 평균 때문에 몇 초 늦을 수 있다
    expect(pausedTicks).toBe(0);
  });
});
