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
