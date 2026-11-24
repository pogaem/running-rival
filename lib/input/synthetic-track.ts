// 데모용 경로 만들기 (PLAN.md 작업 3)
// 실제 사람의 위치 기록이 아니라, 정해진 페이스로 동쪽으로 곧게 달리는 "만든 경로"다.
// 경로의 모양은 상관없다. 이 앱은 코스가 달라도 거리와 페이스로만 비교한다.
import { METERS_PER_DEGREE_LAT } from "../geo";
import type { PositionSample } from "./types";

export type StraightTrackOptions = {
  /** 달리는 페이스(초/km). 일정한 페이스로 달린다 */
  paceSecPerKm: number;
  /** 달리는 거리(미터) */
  distanceM: number;
  /** 점 사이의 시간(초). 기본 1초(GPS처럼) */
  intervalSec?: number;
  /** 출발 위치. 실제 장소가 아닌 임의의 좌표다 */
  startLat?: number;
  startLon?: number;
  /** 모든 점의 위치 정확도(미터). 기본 5 */
  accuracyM?: number;
  /** 달린 거리에 따른 고도(미터). 없으면 고도 정보 없음(null) */
  elevationAt?: (distanceM: number) => number | null;
};

/** 동쪽으로 곧게, 일정한 페이스로 달리는 경로를 만든다. 첫 점은 (0초, 출발 위치)이다 */
export function makeStraightTrack(options: StraightTrackOptions): PositionSample[] {
  const {
    paceSecPerKm,
    distanceM,
    intervalSec = 1,
    startLat = 37.5,
    startLon = 127.0,
    accuracyM = 5,
    elevationAt,
  } = options;

  if (!(paceSecPerKm > 0) || !(distanceM > 0) || !(intervalSec > 0)) {
    throw new Error("페이스, 거리, 점 사이의 시간은 모두 0보다 커야 한다");
  }

  // 경도 1m가 몇 도인지: 위도가 높을수록 경도 1도의 거리가 짧아진다
  const degreesLonPerMeter = 1 / (METERS_PER_DEGREE_LAT * Math.cos((startLat * Math.PI) / 180));
  const totalSeconds = (distanceM / 1000) * paceSecPerKm;

  const makeSample = (t: number): PositionSample => {
    const traveled = (t / paceSecPerKm) * 1000;
    return {
      t,
      lat: startLat,
      lon: startLon + traveled * degreesLonPerMeter,
      accuracyM,
      ele: elevationAt ? elevationAt(traveled) : null,
    };
  };

  const samples: PositionSample[] = [];
  for (let t = 0; t < totalSeconds; t += intervalSec) {
    samples.push(makeSample(t));
  }
  samples.push(makeSample(totalSeconds)); // 마지막 점은 정확히 도착 지점
  return samples;
}

/**
 * 발표와 책상 확인에 쓰는 데모 경로: 5km를 5:20/km 일정한 페이스(1600초)로 달린다.
 * 10배속으로 재생하면 160초(2분 40초)가 걸린다.
 * 고도는 완만한 오르내림(약 4m 높이)으로 넣었다.
 */
export function makeDemoTrack(): PositionSample[] {
  return makeStraightTrack({
    paceSecPerKm: 320,
    distanceM: 5000,
    elevationAt: (distance) => 20 + 4 * Math.sin((2 * Math.PI * distance) / 1250),
  });
}

/** 매번 같은 값을 내는 간단한 난수 (시험과 데모가 늘 같은 오차를 보게 한다) */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type NoisyTrackOptions = StraightTrackOptions & {
  /** 난수 씨앗. 같으면 늘 같은 오차가 나온다 */
  seed?: number;
  /** 도착한 뒤에도 이만큼(초) 더 달린다. 위치 보정(이동 평균)이 조금 늦게 따라오므로 도착선을 확실히 넘게 한다. 기본 15 */
  extraSec?: number;
};

/**
 * 실제 GPS처럼 오차를 섞은 시험 경로. 같은 페이스로 달리되
 *  - 모든 점이 위아래 1m 안쪽으로 흔들리고,
 *  - 가끔 정확도가 나쁜 점(오차 반경 60m)이 끼고,
 *  - 아주 가끔 80m쯤 튀는 점이 끼고,
 *  - 한두 번은 몇 초 동안 점이 끊긴다.
 * 위치 보정(gps-filter)이 이것들을 걸러 내는지 책상에서 보게 해 준다. 멈춤은 넣지 않는다.
 */
export function makeNoisyTrack(options: NoisyTrackOptions): PositionSample[] {
  const { seed = 7, extraSec = 15, ...straight } = options;
  const random = seededRandom(seed);
  const startLat = straight.startLat ?? 37.5;
  const degreesLonPerMeter = 1 / (METERS_PER_DEGREE_LAT * Math.cos((startLat * Math.PI) / 180));
  const degreesLatPerMeter = 1 / METERS_PER_DEGREE_LAT;
  const totalSeconds = (straight.distanceM / 1000) * straight.paceSecPerKm;

  // 도착 뒤에도 같은 페이스로 조금 더 달리는 경로를 만든 뒤 오차를 섞는다
  const base = makeStraightTrack({
    ...straight,
    distanceM: straight.distanceM + (extraSec / straight.paceSecPerKm) * 1000,
  });

  const out: PositionSample[] = [];
  let dropUntil = -1;
  let nextDropAt = 40 + random() * 60; // 첫 끊김은 40~100초 사이
  base.forEach((sample, index) => {
    if (index === 0) {
      out.push(sample); // 첫 점은 깨끗하게 (출발 기준)
      return;
    }
    if (sample.t >= nextDropAt && dropUntil < 0 && sample.t < totalSeconds - 10) {
      dropUntil = sample.t + 4 + random() * 2; // 4~6초 끊김
      nextDropAt = sample.t + 80 + random() * 80;
    }
    if (sample.t < dropUntil) return;
    dropUntil = -1;

    const jitterM = (random() - 0.5) * 2; // ±1m
    const roll = random();
    let accuracyM = sample.accuracyM;
    let offsetM = jitterM;
    if (roll < 0.03) accuracyM = 60; // 정확도 나쁜 점
    else if (roll < 0.04) offsetM += random() < 0.5 ? 80 : -80; // 튀는 점
    out.push({
      ...sample,
      accuracyM,
      lon: sample.lon + offsetM * degreesLonPerMeter,
      lat: sample.lat + (random() - 0.5) * 2 * degreesLatPerMeter,
    });
  });
  return out;
}
