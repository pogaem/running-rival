// 개발용 시험 GPS 경로 (PLAN.md 작업 3, DESIGN.md 3·4번)
// 깨끗한 경로에 실제 GPS에서 생기는 문제를 일부러 섞는다. GPS 보정(작업 15)과 "헛역전 0회" 확인에 쓴다.
// 이 폴더는 개발과 시험에서만 쓰고, 앱 화면 코드에서 불러오지 않는다(배포에 들어가지 않는다).
import { METERS_PER_DEGREE_LAT } from "@/lib/geo";
import type { PositionSample } from "@/lib/input/types";

/** 어느 시각(레이스 시간, 초)에 어떤 문제를 섞었는지. 보정이 제대로 걸러 냈는지 확인하는 데 쓴다 */
export type InjectedProblems = {
  /** 한 점만 엉뚱한 곳으로 튀는 순간 이동이 일어난 시각 */
  jumpsAt: number[];
  /** 위치 정확도가 나쁘고 위치가 크게 흔들린 구간 [시작, 끝) */
  lowAccuracyRanges: [number, number][];
  /** 신호가 끊겨 점이 없는 구간 (앞 점의 시각, 다음 점의 시각) */
  gapRanges: [number, number][];
  /** 신호 대기 등으로 멈춰 서 있던 구간 [시작, 끝] */
  stopRanges: [number, number][];
};

const JUMP_TIMES = [600, 1100];
/** 순간 이동 거리(미터): 1초에 250m는 시속 900km라서 사람이 달린 것일 수 없다 */
const JUMP_M = 250;
const LOW_ACCURACY_RANGE: [number, number] = [300, 330];
const GAP_AFTER = 800; // 800초 점 다음 점이 806초에 온다 (6초 끊김)
const GAP_LENGTH = 6;
const STOP_AT = 1000;
const STOP_LENGTH = 20;
/** 평소 위치 흔들림(미터). 걷는 속도에 더해도 시속 25km를 넘지 않을 만큼 작게 둔다 */
const NORMAL_JITTER_M = 1.5;
const LOW_ACCURACY_JITTER_M = 30;

/** 같은 씨앗이면 같은 숫자가 나오는 난수 (시험 결과가 매번 같아야 해서) */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 깨끗한 경로에 문제를 섞는다. 기준 경로는 0초에서 시작하고 점이 1초 간격이어야 한다.
 * 섞는 문제: 20초 멈춤(1000초), 6초 끊김(800초 뒤), 정확도 나쁜 30초 구간(300~330초),
 * 순간 이동 2번(600초, 1100초), 그리고 모든 점의 작은 흔들림.
 * 멈춤이 20초 들어가므로 결과 경로는 기준 경로보다 20초 길다.
 */
export function makeNoisyTrack(
  base: PositionSample[],
  seed = 20261123,
): { samples: PositionSample[]; injected: InjectedProblems } {
  if (base.length < 2 || base[0].t !== 0 || base.some((s, i) => i > 0 && s.t - base[i - 1].t !== 1)) {
    throw new Error("기준 경로는 0초에서 시작하고 점이 1초 간격이어야 한다");
  }
  const random = makeRandom(seed);
  const cosLat = Math.cos((base[0].lat * Math.PI) / 180);
  const toDegreesLat = (meters: number) => meters / METERS_PER_DEGREE_LAT;
  const toDegreesLon = (meters: number) => meters / (METERS_PER_DEGREE_LAT * cosLat);

  // 1) 멈춤: 기준 경로의 STOP_AT초 뒤에 같은 자리에 STOP_LENGTH초 서 있다가 이어서 달린다
  const withStop: PositionSample[] = [];
  for (const sample of base) {
    if (sample.t <= STOP_AT) {
      withStop.push({ ...sample });
    } else {
      withStop.push({ ...sample, t: sample.t + STOP_LENGTH });
    }
    if (sample.t === STOP_AT) {
      for (let k = 1; k <= STOP_LENGTH; k++) {
        withStop.push({ ...sample, t: STOP_AT + k });
      }
    }
  }

  // 2) 끊김: 800초와 806초 사이의 점을 없앤다
  const afterGap = withStop.filter((s) => !(s.t > GAP_AFTER && s.t < GAP_AFTER + GAP_LENGTH));

  // 3) 흔들림, 정확도 나쁜 구간, 순간 이동
  const samples = afterGap.map((sample) => {
    const lowAccuracy = sample.t >= LOW_ACCURACY_RANGE[0] && sample.t < LOW_ACCURACY_RANGE[1];
    const jitter = lowAccuracy ? LOW_ACCURACY_JITTER_M : NORMAL_JITTER_M;
    const dx = (random() * 2 - 1) * jitter;
    const dy = (random() * 2 - 1) * jitter;
    const jumpM = JUMP_TIMES.includes(sample.t) ? JUMP_M : 0;
    return {
      ...sample,
      lat: sample.lat + toDegreesLat(dy),
      lon: sample.lon + toDegreesLon(dx + jumpM),
      accuracyM: lowAccuracy ? 80 : 4 + random() * 4,
    };
  });

  return {
    samples,
    injected: {
      jumpsAt: [...JUMP_TIMES],
      lowAccuracyRanges: [[...LOW_ACCURACY_RANGE]],
      gapRanges: [[GAP_AFTER, GAP_AFTER + GAP_LENGTH]],
      stopRanges: [[STOP_AT, STOP_AT + STOP_LENGTH]],
    },
  };
}
