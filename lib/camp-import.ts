// 캠프 참가자 기록 변환 (PLAN.md 작업 2)
// 참가자가 제공한 위치 기록에서 "시간별 누적 거리"와 "총 상승 고도"만 남기고,
// 좌표·이동 경로·날짜·시작 시각·이름은 모두 버린다. 이름 대신 익명 이름표를 붙인다.
// (PRD 7번, DESIGN 8번: 동의를 받은 기록만 쓴다)
//
// 지금은 GPS 보정(튀는 점 제거)을 하지 않는다. 그 보정은 PLAN 작업 15에서 만든다.
// 그래서 이 도구에 넣을 기록은 이미 정리된 것이어야 한다.
import { distanceBetweenM } from "./geo";
import { timeToReachDistance, type RunRecord } from "./record";

/** 참가자가 제공한 위치 기록의 한 점 (이 도구 안에서만 쓰고 저장하지 않는다) */
export type RawSample = {
  /** 출발 후 지난 시간(초). 날짜·시각이 아니라 "출발 후 몇 초"여야 한다 */
  t: number;
  lat: number;
  lon: number;
  /** 고도(미터). 기기가 주지 않았으면 비워 둔다 */
  ele?: number | null;
};

export type CampRecordMeta = {
  /** 익명 이름표. 실제 이름은 넣지 않는다 */
  id: string;
  /** 등록 순번 (캠프 참가자는 100번부터) */
  registrationOrder: number;
};

/** 변환한 기록에서 점 사이의 거리(미터). 경로 모양이 드러나지 않을 만큼 듬성하게 남긴다 */
const STEP_M = 250;

const roundTo1 = (value: number) => Math.round(value * 10) / 10;

/**
 * 위치 기록을 캠프 참가자 기록(RunRecord)으로 바꾼다.
 * 결과에는 좌표·날짜·이름이 없고, 250m마다의 시간과 총 상승 고도만 들어 있다.
 */
export function toCampRecord(samples: RawSample[], meta: CampRecordMeta): RunRecord {
  if (samples.length < 2) {
    throw new Error("위치 기록의 점이 2개 이상 있어야 한다");
  }
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].t <= samples[i - 1].t) {
      throw new Error(`${i + 1}번째 점의 시간이 앞 점보다 커야 한다`);
    }
  }

  // 1) 점마다 누적 거리를 구한다. 첫 점의 시간을 0초로 맞춰 시각 정보를 없앤다
  const startTime = samples[0].t;
  const raw: { t: number; d: number }[] = [{ t: 0, d: 0 }];
  let distance = 0;
  for (let i = 1; i < samples.length; i++) {
    distance += distanceBetweenM(samples[i - 1], samples[i]);
    raw.push({ t: samples[i].t - startTime, d: distance });
  }

  // 2) 250m마다 시간을 읽어 듬성한 기록으로 줄인다
  const rawRecord: RunRecord = {
    id: meta.id,
    source: "camp",
    registrationOrder: meta.registrationOrder,
    completedDistanceM: distance,
    totalElevationGainM: null,
    points: raw,
  };
  const points: { t: number; d: number }[] = [{ t: 0, d: 0 }];
  for (let target = STEP_M; target < distance; target += STEP_M) {
    const time = timeToReachDistance(rawRecord, target);
    if (time !== null) points.push({ t: roundTo1(time), d: target });
  }
  const totalDistance = roundTo1(distance);
  // 마지막 250m 지점이 전체 거리와 거의 같으면 마지막 점으로 대신한다 (같은 거리의 점이 두 개 생기지 않게)
  while (points.length > 1 && points[points.length - 1].d >= totalDistance) {
    points.pop();
  }
  points.push({ t: roundTo1(raw[raw.length - 1].t), d: totalDistance });

  // 3) 총 상승 고도: 모든 점에 고도가 있을 때만 올라간 높이를 더한다. 하나라도 없으면 "고도 정보 없음"
  let elevationGain: number | null = null;
  if (samples.every((sample) => typeof sample.ele === "number")) {
    elevationGain = 0;
    for (let i = 1; i < samples.length; i++) {
      const rise = (samples[i].ele as number) - (samples[i - 1].ele as number);
      if (rise > 0) elevationGain += rise;
    }
    elevationGain = roundTo1(elevationGain);
  }

  return {
    id: meta.id,
    source: "camp",
    registrationOrder: meta.registrationOrder,
    completedDistanceM: totalDistance,
    totalElevationGainM: elevationGain,
    points,
  };
}
