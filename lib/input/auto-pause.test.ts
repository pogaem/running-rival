// 자동 일시정지(lib/input/auto-pause.ts) 시험
import { describe, expect, it } from "vitest";
import { makeNoisyTrack } from "@/dev-fixtures/noisy-track";
import { createRaceEngine } from "../engine/race-engine";
import { distanceBetweenM } from "../geo";
import type { RunRecord } from "../record";
import { createAutoPause } from "./auto-pause";
import { createPositionFilter } from "./gps-filter";
import { makeStraightTrack } from "./synthetic-track";
import type { PositionSample } from "./types";

/** 1초마다 점을 넣는다. speed(t)가 그 초의 속도(m/s)다 */
function drive(autoPause: ReturnType<typeof createAutoPause>, seconds: number, speed: (t: number) => number) {
  let d = 0;
  const states: ReturnType<ReturnType<typeof createAutoPause>["update"]>[] = [];
  for (let t = 0; t <= seconds; t++) {
    if (t > 0) d += speed(t);
    states.push(autoPause.update(t, d));
  }
  return states;
}

describe("createAutoPause", () => {
  it("계속 달리면 멈추지 않고 레이스 시간이 실제 시간과 같다", () => {
    const states = drive(createAutoPause(), 60, () => 3);
    expect(states.every((s) => !s.paused)).toBe(true);
    expect(states[60].raceTimeSec).toBe(60);
  });

  it("멈추면 5초쯤 뒤에 멈춤으로 바뀌고, 그동안 레이스 시간이 멈춘다", () => {
    const states = drive(createAutoPause(), 60, (t) => (t <= 20 ? 3 : 0));
    expect(states[22].paused).toBe(false); // 멈춘 지 2초: 아직 모른다
    expect(states[26].paused).toBe(true); // 멈춘 지 5~6초
    // 멈춘 동안 레이스 시간은 늘지 않는다
    expect(states[50].raceTimeSec).toBe(states[40].raceTimeSec);
    expect(states[60].raceTimeSec).toBeLessThanOrEqual(26); // 멈춘 걸 알아채기까지 4~5초는 흐른다
  });

  it("다시 달리면 곧 재개하고 이어서 레이스 시간이 흐른다", () => {
    const states = drive(createAutoPause(), 90, (t) => (t <= 20 || t > 50 ? 3 : 0));
    expect(states[51].paused).toBe(true);
    expect(states[56].paused).toBe(false); // 달리기 시작 후 3~4초 안에 재개
    const before = states[60].raceTimeSec;
    expect(states[70].raceTimeSec - before).toBeCloseTo(10, 0); // 이후 1초에 1초씩 흐른다
    // 30초 멈췄으니 실제 시간 90초 중 레이스 시간은 약 60초
    expect(states[90].raceTimeSec).toBeGreaterThan(55);
    expect(states[90].raceTimeSec).toBeLessThan(66);
  });

  it("레이스 시간은 한 번도 줄어들지 않는다", () => {
    const states = drive(createAutoPause(), 120, (t) => (t % 40 < 20 ? 3 : 0));
    for (let i = 1; i < states.length; i++) {
      expect(states[i].raceTimeSec).toBeGreaterThanOrEqual(states[i - 1].raceTimeSec);
    }
  });

  it("작은 흔들림(1m)만 있는 정지는 멈춤으로 본다", () => {
    const autoPause = createAutoPause();
    let state = autoPause.update(0, 0);
    for (let t = 1; t <= 30; t++) state = autoPause.update(t, t % 2 === 0 ? 0 : 1);
    expect(state.paused).toBe(true);
  });

  it("천천히 걷는 것(1.2m/s)은 멈춤이 아니다", () => {
    const states = drive(createAutoPause(), 60, () => 1.2);
    expect(states.every((s) => !s.paused)).toBe(true);
  });

  it("신호가 끊겼다 돌아와도 달리던 중이었으면 멈춤으로 보지 않고 시간이 그대로 흐른다", () => {
    const autoPause = createAutoPause();
    drive(autoPause, 30, () => 3);
    const resumed = autoPause.update(60, 120); // 30초 끊겼다 돌아옴(그동안 90m 달림)
    expect(resumed.paused).toBe(false);
    expect(resumed.raceTimeSec).toBe(60);
  });
});

describe("지저분한 시험 경로(1000초에 20초 멈춤)에서 보정과 함께", () => {
  const base = makeStraightTrack({ paceSecPerKm: 320, distanceM: 5000 });
  const { samples } = makeNoisyTrack(base);

  const run = () => {
    const filter = createPositionFilter();
    const autoPause = createAutoPause();
    let previous: PositionSample | null = null;
    let traveled = 0;
    const out: { t: number; paused: boolean; raceTimeSec: number; traveled: number }[] = [];
    for (const raw of samples) {
      const result = filter.push(raw);
      if (!result.accepted) continue;
      if (previous) traveled += distanceBetweenM(previous, result.sample);
      previous = result.sample;
      const state = autoPause.update(result.sample.t, traveled);
      out.push({ t: result.sample.t, ...state, traveled });
    }
    return { out, autoPause };
  };

  it("20초 멈춤을 찾아내고, 레이스 시간이 기준 경로의 시간(약 1600초)에 가깝다", () => {
    const { out } = run();
    expect(out.some((o) => o.paused && o.t >= 1000 && o.t <= 1020)).toBe(true);
    const last = out[out.length - 1];
    // 끊김과 정확도 나쁜 구간은 멈춤으로 세지 않고, 20초 멈춤만 뺀다(실제 1620초 중)
    expect(last.raceTimeSec).toBeGreaterThan(1585);
    expect(last.raceTimeSec).toBeLessThan(1612);
  });

  it("멈추지 않은 다른 구간에서는 멈춤으로 잘못 판단하지 않는다", () => {
    const { out } = run();
    const wrong = out.filter((o) => o.paused && (o.t < 995 || o.t > 1030));
    expect(wrong).toHaveLength(0);
  });

  it("멈춘 동안 상대 기록도 멈춘다: 엔진에 레이스 시간을 넣으면 상대의 위치가 20초 동안 그대로다", () => {
    const points = Array.from({ length: 21 }, (_, i) => ({ t: i * 80, d: i * 250 })); // 상대 5:20/km
    const opponent: RunRecord = {
      id: "상대",
      source: "virtual",
      registrationOrder: 1,
      completedDistanceM: 5000,
      totalElevationGainM: 0,
      points,
    };
    const engine = createRaceEngine({ opponent, raceDistanceM: 5000 });
    const { out } = run();
    const opponentAt = (time: number) => engine.update(time, 0).snapshot.opponentDistanceM;
    // 같은 레이스 시간을 두 번 넣어도 상대는 같은 자리다(엔진을 멈춘 동안 호출하지 않는다는 뜻)
    const pausedFrames = out.filter((o) => o.paused);
    expect(pausedFrames.length).toBeGreaterThan(10);
    const times = new Set(pausedFrames.filter((o) => o.t >= 1005 && o.t <= 1018).map((o) => o.raceTimeSec));
    expect(times.size).toBe(1); // 멈춘 구간에서 레이스 시간이 하나로 고정
    expect(opponentAt([...times][0])).toBeGreaterThan(0);
  });
});
