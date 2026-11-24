// 라이벌 전적과 개인 최고 기록 (PLAN.md 작업 18, DESIGN.md 3번)
// 이 기기의 localStorage에만 저장한다. 서버로 보내지 않고, 위치 좌표나 이름도 담지 않는다.
// 상대 이름표(가상러너-03 같은 익명 번호)별 승·패, 대결 거리별 개인 최고 기록(초)만 둔다.
// 끝까지 달리지 않은 경기는 저장하지 않는다 (호출하는 쪽이 완주했을 때만 부른다).
import type { RaceDistanceM } from "../race-settings";
import { formatRaceClock } from "../output/subtitles";
import type { DistancePoint } from "../record";

export const HISTORY_STORAGE_KEY = "running-rival:history";

export type RivalRecord = {
  wins: number;
  losses: number;
  /** 가장 최근 대결에서 이겼는가 */
  lastWon: boolean;
};

/** 내 최고 기록의 달린 모양: 매칭에서 "내가 어느 구간에서 빠르고 느린지"를 알려 준다. 위치 좌표는 없다 */
export type MyRun = {
  /** 총 상승 고도(m). 고도 정보가 없었으면 null */
  elevationGainM: number | null;
  /** 시간별 누적 거리(250m마다) */
  points: DistancePoint[];
};

export type History = {
  version: 1;
  rivals: Record<string, RivalRecord>;
  /** 대결 거리(m)별 개인 최고 기록(초) */
  bests: Record<string, number>;
  /** 대결 거리(m)별 개인 최고 기록 때의 달린 모양. 실제 GPS로 뛴 것만 담는다 */
  runs?: Record<string, MyRun>;
};

export const EMPTY_HISTORY: History = { version: 1, rivals: {}, bests: {} };

export type RecordOutcome = {
  history: History;
  /** 개인 최고 기록을 새로 세웠는가 (첫 기록이어도 true) */
  newBest: boolean;
  /** 이번 경기 전의 최고 기록(초). 처음이면 null */
  previousBestSec: number | null;
  rival: RivalRecord;
};

/** 한 경기의 결과를 기록에 더한다. 받은 기록은 바꾸지 않고 새 기록을 돌려준다 */
export function recordRace(
  history: History,
  race: { opponentId: string; distanceM: RaceDistanceM; won: boolean; myTimeSec: number; run?: MyRun },
): RecordOutcome {
  const before = history.rivals[race.opponentId] ?? { wins: 0, losses: 0, lastWon: race.won };
  const rival: RivalRecord = {
    wins: before.wins + (race.won ? 1 : 0),
    losses: before.losses + (race.won ? 0 : 1),
    lastWon: race.won,
  };
  const key = String(race.distanceM);
  const previousBestSec = history.bests[key] ?? null;
  const newBest = previousBestSec === null || race.myTimeSec < previousBestSec;
  return {
    history: {
      version: 1,
      rivals: { ...history.rivals, [race.opponentId]: rival },
      bests: { ...history.bests, [key]: newBest ? race.myTimeSec : previousBestSec },
      // 최고 기록을 세웠을 때만 그때의 달린 모양으로 바꾼다
      ...(newBest && race.run ? { runs: { ...history.runs, [key]: race.run } } : history.runs ? { runs: history.runs } : {}),
    },
    newBest,
    previousBestSec,
    rival,
  };
}

/** 저장할 글 / 읽기. 읽을 수 없거나 모양이 틀리면 빈 기록 */
export function serializeHistory(history: History): string {
  return JSON.stringify(history);
}

export function parseHistory(text: string | null): History {
  if (!text) return EMPTY_HISTORY;
  try {
    const value = JSON.parse(text) as Partial<History>;
    if (!value || value.version !== 1 || typeof value.rivals !== "object" || typeof value.bests !== "object") {
      return EMPTY_HISTORY;
    }
    if (!value.rivals || !value.bests) return EMPTY_HISTORY;
    const rivals: Record<string, RivalRecord> = {};
    for (const [id, r] of Object.entries(value.rivals)) {
      if (r && Number.isInteger(r.wins) && Number.isInteger(r.losses) && typeof r.lastWon === "boolean") {
        rivals[id] = { wins: r.wins, losses: r.losses, lastWon: r.lastWon };
      }
    }
    const bests: Record<string, number> = {};
    for (const [distance, sec] of Object.entries(value.bests)) {
      if (typeof sec === "number" && Number.isFinite(sec) && sec > 0) bests[distance] = sec;
    }
    const runs: Record<string, MyRun> = {};
    for (const [distance, run] of Object.entries(value.runs ?? {})) {
      const points = Array.isArray(run?.points) ? run.points : [];
      const valid =
        points.length >= 2 &&
        points.length <= 100 &&
        points.every((p) => p && Number.isFinite(p.t) && Number.isFinite(p.d) && p.t >= 0 && p.d >= 0);
      const gain = run?.elevationGainM;
      if (valid && (gain === null || (typeof gain === "number" && Number.isFinite(gain) && gain >= 0))) {
        runs[distance] = { elevationGainM: gain, points: points.map((p) => ({ t: p.t, d: p.d })) };
      }
    }
    return { version: 1, rivals, bests, ...(Object.keys(runs).length > 0 ? { runs } : {}) };
  } catch {
    return EMPTY_HISTORY;
  }
}

/** 전적을 "2승 1패"로 쓴다. 한 번도 안 붙었으면 null */
export function formatRivalRecord(rival: RivalRecord | undefined): string | null {
  if (!rival || rival.wins + rival.losses === 0) return null;
  return `${rival.wins}승 ${rival.losses}패`;
}

/** 다음 중계 첫머리에서 전하는 한마디. 처음 만나는 상대면 null */
export function rivalryIntro(rival: RivalRecord | undefined): string | null {
  const record = formatRivalRecord(rival);
  if (!rival || !record) return null;
  return rival.lastWon
    ? `지난 대결은 도전자의 승리였습니다. 전적 ${record}, 이번에도 이길 수 있을까요?`
    : `지난 대결에서 졌던 상대입니다. 전적 ${record}, 설욕전입니다!`;
}

/** 개인 최고 기록 한 줄. 예: "개인 최고 기록 갱신! 25:12 (이전 26:03)" */
export function describeNewBest(sec: number, previousSec: number | null): string {
  return previousSec === null
    ? `첫 기록이 개인 최고 기록이에요! ${formatRaceClock(sec)}`
    : `개인 최고 기록 갱신! ${formatRaceClock(sec)} (이전 ${formatRaceClock(previousSec)})`;
}

/** 최고 기록에서 평소 페이스(초/km)를 구한다. 없으면 null */
export function bestPaceSecPerKm(history: History, distanceM: RaceDistanceM): number | null {
  const best = history.bests[String(distanceM)];
  return best === undefined ? null : Math.round((best / distanceM) * 1000);
}

/** 이 기기에서 기록을 읽고 쓴다. 저장소를 못 쓰는 환경이면 빈 기록 / 조용히 건너뜀 */
export function loadHistoryText(): string | null {
  try {
    return localStorage.getItem(HISTORY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveHistory(history: History): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, serializeHistory(history));
  } catch {
    // 저장하지 못해도 경기와 결과 화면은 그대로 된다
  }
}
