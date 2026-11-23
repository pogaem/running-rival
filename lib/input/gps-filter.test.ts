// GPS 보정(lib/input/gps-filter.ts) 시험: 지저분한 시험 경로로 "헛역전 0회"까지 확인한다
import { describe, expect, it } from "vitest";
import { makeNoisyTrack } from "@/dev-fixtures/noisy-track";
import { createRaceEngine, type RaceEvent } from "../engine/race-engine";
import { distanceBetweenM } from "../geo";
import type { RunRecord } from "../record";
import { createPositionFilter, MAX_ACCURACY_M, MAX_SPEED_KMH } from "./gps-filter";
import { makeStraightTrack } from "./synthetic-track";
import type { PositionSample } from "./types";

const sample = (t: number, lon: number, accuracyM = 5): PositionSample => ({ t, lat: 37.5, lon, accuracyM, ele: null });
/** 경도 1도 ≈ 88,000m (위도 37.5도). 테스트에서 1m ≈ 0.0000114도 */
const M = 1 / 88000;

describe("createPositionFilter · 정확도", () => {
  it("정확도 값이 나쁜 점은 버리고 이유를 알려 준다", () => {
    const filter = createPositionFilter();
    expect(filter.push(sample(0, 127, 5)).accepted).toBe(true);
    expect(filter.push(sample(1, 127 + 3 * M, MAX_ACCURACY_M + 1))).toEqual({ accepted: false, reason: "accuracy" });
    expect(filter.push(sample(2, 127 + 6 * M, MAX_ACCURACY_M)).accepted).toBe(true); // 딱 기준은 받아들인다
    expect(filter.rejected).toEqual({ accuracy: 1, speed: 0 });
  });

  it("정확도가 숫자가 아니면 버린다", () => {
    const filter = createPositionFilter();
    expect(filter.push(sample(0, 127, Number.NaN))).toEqual({ accepted: false, reason: "accuracy" });
  });
});

describe("createPositionFilter · 속도", () => {
  it(`시속 ${MAX_SPEED_KMH}km를 넘는 순간 이동은 버린다`, () => {
    const filter = createPositionFilter();
    filter.push(sample(0, 127));
    filter.push(sample(1, 127 + 3 * M));
    expect(filter.push(sample(2, 127 + 250 * M))).toEqual({ accepted: false, reason: "speed" });
    // 튄 점은 기준이 되지 않으므로 다음 정상 점은 받아들인다
    expect(filter.push(sample(3, 127 + 9 * M)).accepted).toBe(true);
    expect(filter.rejected.speed).toBe(1);
  });

  it("끊겼다 돌아온 점은 흐른 시간만큼 이동을 허용한다", () => {
    const filter = createPositionFilter();
    filter.push(sample(0, 127));
    // 30초 동안 신호가 끊겼다가 90m 앞에서 다시 잡혔다: 시속 약 11km
    expect(filter.push(sample(30, 127 + 90 * M)).accepted).toBe(true);
  });

  it("멈춰 있을 때의 작은 흔들림은 받아들인다", () => {
    const filter = createPositionFilter();
    filter.push(sample(0, 127));
    expect(filter.push(sample(1, 127 + 2 * M)).accepted).toBe(true);
    expect(filter.push(sample(2, 127 - 1 * M)).accepted).toBe(true);
  });

  it("시간이 같은 점이 거리가 다르면 버린다", () => {
    const filter = createPositionFilter();
    filter.push(sample(5, 127));
    expect(filter.push(sample(5, 127 + 10 * M))).toEqual({ accepted: false, reason: "speed" });
  });
});

describe("createPositionFilter · 이동 평균", () => {
  it("받아들인 점은 최근 점들의 평균 위치로 다듬는다", () => {
    const filter = createPositionFilter({ smoothingWindow: 3 });
    const outputs = [0, 3, 6, 9].map((m, i) => {
      const result = filter.push(sample(i, 127 + m * M));
      if (!result.accepted) throw new Error("받아들여야 한다");
      return result.sample;
    });
    expect(outputs[0].lon).toBeCloseTo(127, 9);
    expect(outputs[1].lon).toBeCloseTo(127 + 1.5 * M, 9); // (0+3)/2
    expect(outputs[3].lon).toBeCloseTo(127 + 6 * M, 9); // (3+6+9)/3
    expect(outputs[3].t).toBe(3); // 시간은 가장 최근 점의 것
  });
});

/** 보정을 거쳐(또는 거치지 않고) 누적 거리를 구한다 */
function travelled(samples: PositionSample[], useFilter: boolean) {
  const filter = createPositionFilter();
  let previous: PositionSample | null = null;
  let total = 0;
  const path: { t: number; d: number }[] = [];
  for (const raw of samples) {
    let current: PositionSample | null = raw;
    if (useFilter) {
      const result = filter.push(raw);
      current = result.accepted ? result.sample : null;
    }
    if (!current) continue;
    if (previous) total += distanceBetweenM(previous, current);
    previous = current;
    path.push({ t: current.t, d: total });
  }
  return { total, path, rejected: filter.rejected };
}

describe("지저분한 시험 경로 (순간 이동 2번, 정확도 나쁜 30초, 6초 끊김, 20초 멈춤)", () => {
  const base = makeStraightTrack({ paceSecPerKm: 320, distanceM: 5000 });
  const { samples, injected } = makeNoisyTrack(base);

  it("보정을 하지 않으면 거리가 크게 부풀고, 하면 실제 5km에 가깝다", () => {
    const raw = travelled(samples, false);
    const fixed = travelled(samples, true);
    expect(raw.total).toBeGreaterThan(5400); // 순간 이동 + 흔들림이 거리에 더해진다
    expect(Math.abs(fixed.total - 5000) / 5000).toBeLessThan(0.02);
  });

  it("순간 이동 2번과 정확도 나쁜 구간이 걸러진다", () => {
    const { rejected } = travelled(samples, true);
    expect(rejected.speed).toBeGreaterThanOrEqual(injected.jumpsAt.length);
    expect(rejected.accuracy).toBeGreaterThanOrEqual(25); // 300~330초 사이의 점들
  });

  it("보정 뒤에는 순간 이동으로 거리가 한 번에 크게 늘어난 곳이 없다", () => {
    const { path } = travelled(samples, true);
    for (let i = 1; i < path.length; i++) {
      const dt = path[i].t - path[i - 1].t;
      const speedKmh = ((path[i].d - path[i - 1].d) / dt) * 3.6;
      expect(speedKmh).toBeLessThan(MAX_SPEED_KMH);
    }
  });

  it("역전이 진짜 한 번뿐인 경기: 보정하면 정확히 한 번만 나오고 헛역전은 0회다", () => {
    // 상대: 처음 1km는 4:00/km로 빠르게, 그 뒤로는 6:40/km로 느려진다. 나는 5:20/km 일정.
    // 그러면 상대가 앞서다가 내가 따라잡는 진짜 역전이 약 11분쯤(640초 + 10m 앞서는 시간) 한 번 일어난다
    const points = [{ t: 0, d: 0 }];
    for (let d = 250; d <= 5000; d += 250) {
      points.push({ t: d <= 1000 ? d * 0.24 : 240 + (d - 1000) * 0.4, d });
    }
    const opponent: RunRecord = {
      id: "상대",
      source: "virtual",
      registrationOrder: 1,
      completedDistanceM: 5000,
      totalElevationGainM: 0,
      points,
    };
    const run = (useFilter: boolean) => {
      const engine = createRaceEngine({ opponent, raceDistanceM: 5000 });
      const filter = createPositionFilter();
      let previous: PositionSample | null = null;
      let traveledM = 0;
      const events: RaceEvent[] = [];
      for (const raw of samples) {
        let current: PositionSample | null = raw;
        if (useFilter) {
          const result = filter.push(raw);
          current = result.accepted ? result.sample : null;
        }
        if (!current) continue;
        if (previous) traveledM += distanceBetweenM(previous, current);
        previous = current;
        events.push(...engine.update(current.t, traveledM).events);
      }
      return events;
    };
    const fixed = run(true);
    expect(fixed.filter((e) => e.type === "overtaken")).toHaveLength(0);
    const overtakes = fixed.filter((e) => e.type === "overtake");
    expect(overtakes).toHaveLength(1);
    expect(overtakes[0].t).toBeGreaterThan(640); // 실제 따라잡는 시점(약 640초)보다 이르지 않다
    expect(overtakes[0].t).toBeLessThan(720);

    // 보정하지 않으면 흔들림이 거리에 계속 더해져 내가 빨리 달린 것처럼 보이고, 역전이 훨씬 일찍(가짜 시점에) 나온다
    const raw = run(false).filter((e) => e.type === "overtake");
    expect(raw).toHaveLength(1);
    expect(raw[0].t).toBeLessThan(500);
  });
});
