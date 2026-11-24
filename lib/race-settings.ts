// 시작 화면에서 정하는 대결 설정 (PLAN.md 작업 12, DESIGN.md 1.1)
// 대결 거리, 평소 페이스, 중계 강도를 검사하고, 시작 화면에서 레이스 화면으로 주소(쿼리)에 실어 보낸다.
// 위치나 이름 같은 개인 정보는 없고 숫자 세 개뿐이다.
import { DEFAULT_INTENSITY, type Intensity } from "./output/voice-policy";
import { MATCH_PACE_RANGE_SEC, matchOpponent, type MatchResult } from "./matching/match";
import { profileFromRecord, type SegmentProfile } from "./matching/profile";
import type { RunRecord } from "./record";
import { getOpponentRecords } from "./runners";

/** 직접 입력할 수 있는 대결 거리 범위(미터). 상대 기록(가상 러너)이 5km까지라서 5km가 상한이다 */
export const MIN_RACE_DISTANCE_M = 500;
export const MAX_RACE_DISTANCE_M = 5000;
/** 입력한 거리는 100m 단위로 맞춘다 */
const DISTANCE_STEP_M = 100;
export type RaceDistanceM = number;
export const DEFAULT_RACE_DISTANCE_M: RaceDistanceM = 1000;

export type DistanceParse = { ok: true; distanceM: number } | { ok: false; message: string };

/** "2.5", "2,5" 같은 km 입력 글을 미터로 바꾼다. 잘못된 입력은 이유를 한국어로 돌려준다 */
export function parseDistanceInput(kmText: string): DistanceParse {
  const text = kmText.trim().replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return { ok: false, message: "거리는 km 숫자로 적어 주세요 (예: 2.5)" };
  const distanceM = Math.round((Number(text) * 1000) / DISTANCE_STEP_M) * DISTANCE_STEP_M;
  if (distanceM < MIN_RACE_DISTANCE_M || distanceM > MAX_RACE_DISTANCE_M) {
    return { ok: false, message: `거리는 ${MIN_RACE_DISTANCE_M / 1000}km ~ ${MAX_RACE_DISTANCE_M / 1000}km 사이로 적어 주세요` };
  }
  return { ok: true, distanceM };
}

/** 입력할 수 있는 페이스 범위(초/km): 3:00 ~ 20:00 */
export const MIN_PACE_SEC_PER_KM = 180;
export const MAX_PACE_SEC_PER_KM = 1200;
/** 기본 평소 페이스: 6:00/km (DESIGN 화면 그림) */
export const DEFAULT_PACE_SEC_PER_KM = 360;

/** 위치를 어디서 받는가: demo는 만든 경로를 10배속으로 재생, gps는 폰의 실제 위치 */
export type RaceSource = "demo" | "gps";

export type RaceSettings = {
  /** 위치 입력 방식 */
  source: RaceSource;
  distanceM: RaceDistanceM;
  paceSecPerKm: number;
  intensity: Intensity;
  /** 시작 화면에서 매칭된 상대의 이름표. 없으면 레이스 화면이 다시 매칭한다 */
  opponentId?: string;
};

export const DEFAULT_RACE_SETTINGS: RaceSettings = {
  source: "demo",
  distanceM: DEFAULT_RACE_DISTANCE_M,
  paceSecPerKm: DEFAULT_PACE_SEC_PER_KM,
  intensity: DEFAULT_INTENSITY,
};

/** 초/km를 "m:ss"로 쓴다. 예: 330 → "5:30" */
export function formatPace(paceSecPerKm: number): string {
  const whole = Math.round(paceSecPerKm);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export type PaceParse = { ok: true; paceSecPerKm: number } | { ok: false; message: string };

/** "분"과 "초" 입력 글을 페이스(초/km)로 바꾼다. 잘못된 입력은 이유를 한국어로 돌려준다 */
export function parsePaceInput(minutesText: string, secondsText: string): PaceParse {
  const minutesTrim = minutesText.trim();
  const secondsTrim = secondsText.trim() === "" ? "0" : secondsText.trim();
  if (!/^\d{1,2}$/.test(minutesTrim) || !/^\d{1,2}$/.test(secondsTrim)) {
    return { ok: false, message: "분과 초는 숫자로 적어 주세요" };
  }
  const minutes = Number(minutesTrim);
  const seconds = Number(secondsTrim);
  if (seconds > 59) return { ok: false, message: "초는 0~59 사이로 적어 주세요" };
  const pace = minutes * 60 + seconds;
  if (pace < MIN_PACE_SEC_PER_KM || pace > MAX_PACE_SEC_PER_KM) {
    return {
      ok: false,
      message: `1km당 ${formatPace(MIN_PACE_SEC_PER_KM)} ~ ${formatPace(MAX_PACE_SEC_PER_KM)} 사이로 적어 주세요 (총 시간이 아니라 1km를 뛰는 시간)`,
    };
  }
  return { ok: true, paceSecPerKm: pace };
}

const INTENSITIES: readonly Intensity[] = ["off", "minimal", "normal", "active"];

/**
 * 레이스 화면 주소. 매번 다른 값(n)을 붙여서 "같은 주소"로 들어가지 않게 한다.
 * 같은 주소로 다시 들어가면 앱이 지난 레이스 화면을 그대로 되살려서, "소리 켜고 시작" 없이 레이스가 바로 도는 문제가 있었다.
 */
export function freshRaceHref(settings: RaceSettings): string {
  return `/race?${settingsToQuery(settings)}&n=${Date.now()}`;
}

/** 설정을 주소에 붙일 글(쿼리)로 만든다 */
export function settingsToQuery(settings: RaceSettings): string {
  const params = new URLSearchParams({
    m: settings.source,
    d: String(settings.distanceM),
    p: String(settings.paceSecPerKm),
    i: settings.intensity,
  });
  if (settings.opponentId) params.set("o", settings.opponentId);
  return params.toString();
}

/** 주소의 쿼리에서 설정을 읽는다. 없거나 잘못된 값은 기본값으로 바꾼다 */
export function settingsFromQuery(get: (key: string) => string | null | undefined): RaceSettings {
  const distance = Number(get("d"));
  const pace = Number(get("p"));
  const intensity = get("i");
  return {
    source: get("m") === "gps" ? "gps" : "demo",
    distanceM:
      Number.isFinite(distance) && distance >= MIN_RACE_DISTANCE_M && distance <= MAX_RACE_DISTANCE_M
        ? Math.round(distance)
        : DEFAULT_RACE_SETTINGS.distanceM,
    paceSecPerKm:
      Number.isFinite(pace) && pace >= MIN_PACE_SEC_PER_KM && pace <= MAX_PACE_SEC_PER_KM
        ? Math.round(pace)
        : DEFAULT_RACE_SETTINGS.paceSecPerKm,
    intensity: INTENSITIES.includes(intensity as Intensity) ? (intensity as Intensity) : DEFAULT_RACE_SETTINGS.intensity,
    ...(get("o") ? { opponentId: get("o") as string } : {}),
  };
}

/** 기록의 평균 페이스(초/km) */
export function averagePaceSecPerKm(record: RunRecord): number {
  const last = record.points[record.points.length - 1];
  return (last.t / last.d) * 1000;
}

/**
 * 설정으로 상대를 고른다(역전 예측 매칭). 같은 설정이면 늘 같은 상대가 나온다.
 * myRun(이 기기의 개인 최고 기록 때의 달린 모양)이 있고 입력한 페이스와 비슷하면, 일정한 페이스 대신 그 구간별 모양과 상승 고도를 매칭에 쓴다.
 */
export function matchForSettings(
  settings: RaceSettings,
  records: RunRecord[] = getOpponentRecords(),
  myRun?: { elevationGainM: number | null; points: RunRecord["points"] } | null,
): MatchResult | null {
  let myProfile: SegmentProfile | undefined;
  let myElevationGainM: number | null = null;
  if (myRun && myRun.points.length >= 2) {
    const mine: RunRecord = {
      id: "나",
      source: "mine",
      registrationOrder: 0,
      completedDistanceM: myRun.points[myRun.points.length - 1].d,
      totalElevationGainM: myRun.elevationGainM,
      points: myRun.points,
    };
    const profile = profileFromRecord(mine, settings.distanceM);
    // 오늘 입력한 평소 페이스와 너무 다르면 그 기록은 지금의 나와 다르다고 보고 쓰지 않는다
    if (profile && Math.abs(profile.avgPaceSecPerKm - settings.paceSecPerKm) <= MATCH_PACE_RANGE_SEC) {
      myProfile = profile;
      myElevationGainM = myRun.elevationGainM;
    }
  }
  return matchOpponent(records, { distanceM: settings.distanceM, paceSecPerKm: settings.paceSecPerKm, myProfile, myElevationGainM });
}
