// 데모 경로와 시험 GPS 경로(lib/input/synthetic-track.ts, dev-fixtures/noisy-track.ts) 시험
import { describe, expect, it } from "vitest";
import { makeNoisyTrack } from "@/dev-fixtures/noisy-track";
import { toCampRecord, type RawSample } from "../camp-import";
import { distanceBetweenM } from "../geo";
import { distanceAtTime } from "../record";
import { virtualRunners } from "../runners";
import { makeDemoTrack, makeStraightTrack } from "./synthetic-track";

/** 경로를 거리 계산 도구에 넣을 수 있는 모양으로 바꾼다 */
const toRaw = (track: ReturnType<typeof makeDemoTrack>): RawSample[] =>
  track.map((s) => ({ t: s.t, lat: s.lat, lon: s.lon, ele: s.ele }));

/** 경로가 실제로 달린 거리(미터) */
const lengthOf = (track: ReturnType<typeof makeDemoTrack>) => {
  let total = 0;
  for (let i = 1; i < track.length; i++) total += distanceBetweenM(track[i - 1], track[i]);
  return total;
};

describe("makeStraightTrack (일정한 페이스의 곧은 경로)", () => {
  it("점이 1초 간격으로 있고 첫 점은 0초, 끝 점은 도착 시각이다", () => {
    const track = makeStraightTrack({ paceSecPerKm: 300, distanceM: 1000 });
    expect(track[0].t).toBe(0);
    expect(track[track.length - 1].t).toBe(300);
    expect(track).toHaveLength(301);
  });

  it("달린 거리가 요청한 거리와 거의 같다", () => {
    const track = makeStraightTrack({ paceSecPerKm: 300, distanceM: 2000 });
    expect(lengthOf(track)).toBeCloseTo(2000, 0);
  });

  it("고도 함수가 없으면 고도 정보 없음(null)이다", () => {
    const track = makeStraightTrack({ paceSecPerKm: 300, distanceM: 100 });
    expect(track.every((s) => s.ele === null)).toBe(true);
  });

  it("0 이하의 값은 오류를 던진다", () => {
    expect(() => makeStraightTrack({ paceSecPerKm: 0, distanceM: 1000 })).toThrow("0보다 커야");
  });
});

describe("makeDemoTrack (발표용 데모 경로)", () => {
  const track = makeDemoTrack();

  it("5km를 5:20/km 일정한 페이스(1600초)로 달린다", () => {
    expect(track[track.length - 1].t).toBe(1600);
    expect(lengthOf(track)).toBeCloseTo(5000, 0);
  });

  it("10배속으로 재생하면 3분 안에 끝난다 (발표장에서 오래 기다리지 않는다)", () => {
    expect(track[track.length - 1].t / 10).toBeLessThan(180);
  });

  it("고도 정보가 있고, 올라갔다 내려가는 구간이 있다", () => {
    const record = toCampRecord(toRaw(track), { id: "시험", registrationOrder: 100 });
    expect(record.totalElevationGainM).toBeGreaterThan(0);
  });

  it("가상러너-03과 붙이면 한 번 역전하고, 10배속으로 3분 안에 일어난다 (발표 시연용)", () => {
    const me = toCampRecord(toRaw(track), { id: "나", registrationOrder: 100 });
    const rival = virtualRunners.find((r) => r.id === "가상러너-03");
    expect(rival).toBeDefined();

    // 격차가 10m 이상 벌어졌을 때만 앞선 쪽이 바뀐 것으로 센다 (PRD의 역전 판정 기준)
    let leader: "나" | "상대" | null = null;
    let changes = 0;
    let changedAt = 0;
    for (let t = 0; t <= 1600; t += 1) {
      const gap = distanceAtTime(me, t) - distanceAtTime(rival!, t);
      const now: "나" | "상대" | null = gap > 10 ? "나" : gap < -10 ? "상대" : leader;
      if (leader !== null && now !== leader) {
        changes += 1;
        changedAt = t;
      }
      leader = now;
    }
    expect(changes).toBe(1);
    expect(changedAt / 10).toBeLessThan(180);
  });
});

describe("makeNoisyTrack (오차를 섞은 시험 경로)", () => {
  const clean = makeDemoTrack();
  const { samples, injected } = makeNoisyTrack(clean);

  it("같은 씨앗이면 매번 똑같은 경로가 나온다", () => {
    expect(makeNoisyTrack(clean).samples).toEqual(samples);
  });

  it("20초 멈춤이 들어가서 깨끗한 경로보다 20초 길다", () => {
    expect(samples[samples.length - 1].t).toBe(1600 + 20);
    expect(injected.stopRanges).toEqual([[1000, 1020]]);
  });

  it("멈춘 동안에는 거의 같은 자리에 있다", () => {
    const stopped = samples.filter((s) => s.t >= 1000 && s.t <= 1020);
    expect(stopped.length).toBe(21);
    for (const s of stopped) expect(distanceBetweenM(stopped[0], s)).toBeLessThan(5);
  });

  it("800초와 806초 사이에 점이 없다 (6초 끊김)", () => {
    expect(samples.some((s) => s.t > 800 && s.t < 806)).toBe(false);
    expect(samples.some((s) => s.t === 800)).toBe(true);
    expect(samples.some((s) => s.t === 806)).toBe(true);
    expect(injected.gapRanges).toEqual([[800, 806]]);
  });

  it("300~330초는 위치 정확도가 나쁘고, 나머지는 정확하다", () => {
    for (const s of samples) {
      const bad = s.t >= 300 && s.t < 330;
      if (bad) expect(s.accuracyM).toBeGreaterThanOrEqual(50);
      else expect(s.accuracyM).toBeLessThan(10);
    }
    expect(injected.lowAccuracyRanges).toEqual([[300, 330]]);
  });

  it("순간 이동이 2번 있다 (시속 25km를 넘는 이동이 갔다 오며 4번)", () => {
    expect(injected.jumpsAt).toEqual([600, 1100]);
    let fast = 0;
    for (let i = 1; i < samples.length; i++) {
      const before = samples[i - 1];
      const after = samples[i];
      const nearBadAccuracy = (before.t >= 299 && before.t <= 331) || (after.t >= 299 && after.t <= 331);
      if (nearBadAccuracy) continue; // 정확도 나쁜 구간의 흔들림은 따로 센다
      const speedKmh = (distanceBetweenM(before, after) / (after.t - before.t)) * 3.6;
      if (speedKmh > 25) fast += 1;
    }
    expect(fast).toBe(4);
  });

  it("보정하지 않으면 거리가 크게 부풀려진다 (그래서 GPS 보정이 필요하다)", () => {
    expect(lengthOf(samples)).toBeGreaterThan(lengthOf(clean) * 1.05);
  });

  it("기준 경로가 0초 시작·1초 간격이 아니면 오류를 던진다", () => {
    expect(() => makeNoisyTrack(clean.slice(5))).toThrow("0초에서 시작");
    expect(() => makeNoisyTrack(clean.filter((_, i) => i % 2 === 0))).toThrow("1초 간격");
  });
});
