// 경기 흐름 분석 엔진 ① (PLAN.md 작업 4, PRD 5번 A, DESIGN.md 2번)
// 나와 상대의 "같은 시점의 누적 거리 격차"를 구하고, 10m 기준으로 추월·추월당함(역전)을 판정한다.
//
// 이 파일은 계산만 한다. 음성·진동·화면·GPS·브라우저 기능을 전혀 모른다(DESIGN.md 4번 규칙).
// 그래서 입력이 실제 GPS이든 데모든, 출력이 소리이든 자막이든 똑같이 동작하고 가짜 데이터로 시험할 수 있다.
//
// 용어: 격차의 +는 내가 앞섬, −는 내가 뒤처짐이다.
import { distanceAtTime, type RunRecord } from "../record";

/** 중계용 역전 기준(미터). 격차가 이만큼 이상 벌어져야 앞선 쪽이 바뀐 것으로 본다 (GPS 오차로 "역전!"이 남발되지 않게) */
export const LEAD_THRESHOLD_M = 10;

/** 앞서 있다고 확정된 쪽. 아직 한쪽이 기준(10m) 이상 앞선 적이 없으면 null */
export type Leader = "me" | "opponent" | null;

/** 앞선 쪽이 바뀌는 사건: 추월(내가 상대를 앞서게 됨), 추월당함(상대가 나를 앞서게 됨) */
export type LeadEvent = {
  type: "overtake" | "overtaken";
  /** 사건이 일어난 레이스 시간(초) */
  t: number;
  /** 그때의 격차(미터). 추월이면 +, 추월당함이면 − */
  gapM: number;
};

/** 어느 한 시점의 나와 상대의 거리 비교 */
export type GapSnapshot = {
  /** 레이스 시간(초) */
  t: number;
  /** 나의 누적 거리(미터). 대결 거리를 넘지 않게 자른 값 */
  myDistanceM: number;
  /** 같은 시점의 상대 누적 거리(미터). 대결 거리를 넘지 않게 자른 값 */
  opponentDistanceM: number;
  /** 격차(미터) = 나 − 상대. +는 내가 앞섬 */
  gapM: number;
};

export type RaceSetup = {
  /** 상대 기록 */
  opponent: RunRecord;
  /** 대결 거리(미터): 1000 또는 3000 */
  raceDistanceM: number;
};

/**
 * 같은 시점(t초)의 격차를 구한다.
 * 상대 기록은 대결 거리에 닿는 시점까지만 쓴다. 닿은 뒤에는 대결 거리에 서 있는 것으로 본다.
 * 나도 대결 거리를 넘으면 대결 거리로 잘라서 비교한다.
 */
export function measureGap(setup: RaceSetup, t: number, myDistanceM: number): GapSnapshot {
  const cap = setup.raceDistanceM;
  const mine = Math.min(Math.max(myDistanceM, 0), cap);
  const theirs = Math.min(distanceAtTime(setup.opponent, t), cap);
  return { t, myDistanceM: mine, opponentDistanceM: theirs, gapM: mine - theirs };
}

/** 앞선 쪽이 바뀌는 것을 따라가는 도구 */
export type LeadTracker = {
  /** 지금 앞서 있다고 확정된 쪽 */
  readonly leader: Leader;
  /**
   * 새 격차를 알려 주면, 앞선 쪽이 바뀐 경우에만 사건을 돌려준다. 바뀌지 않았으면 null.
   * - 격차가 기준(10m) 이상 벌어져야 그쪽이 앞선 것으로 확정한다. 기준 안쪽의 오르내림은 무시한다.
   * - **처음 앞서는 것은 역전으로 세지 않는다.** (아직 앞선 쪽이 없다가 처음 정해질 때는 사건이 없다)
   */
  update(t: number, gapM: number): LeadEvent | null;
};

export function createLeadTracker(thresholdM: number = LEAD_THRESHOLD_M): LeadTracker {
  if (!(thresholdM > 0)) {
    throw new Error("역전 기준은 0보다 커야 한다");
  }
  let leader: Leader = null;

  return {
    get leader() {
      return leader;
    },
    update(t, gapM) {
      const next: Leader = gapM >= thresholdM ? "me" : gapM <= -thresholdM ? "opponent" : leader;
      if (next === leader) return null;

      const previous = leader;
      leader = next;
      if (previous === null) return null; // 처음 앞서는 것은 역전이 아니다
      return { type: next === "me" ? "overtake" : "overtaken", t, gapM };
    },
  };
}

/** 격차 계산과 역전 판정을 한 번에 묶은 엔진 */
export type GapEngine = {
  /** 1초마다 나의 누적 거리를 알려 주면, 그 시점의 격차와 (있다면) 역전 사건을 돌려준다 */
  update(t: number, myDistanceM: number): { snapshot: GapSnapshot; event: LeadEvent | null };
  readonly leader: Leader;
};

/** 레이스 설정이 올바른지 검사한다: 대결 거리는 0보다 크고, 상대 기록은 대결 거리 이상을 완주한 기록이어야 한다 */
export function assertRaceSetup(setup: RaceSetup): void {
  if (!(setup.raceDistanceM > 0)) {
    throw new Error("대결 거리는 0보다 커야 한다");
  }
  if (setup.opponent.completedDistanceM < setup.raceDistanceM) {
    throw new Error("상대 기록이 대결 거리보다 짧다");
  }
}

export function createGapEngine(setup: RaceSetup, thresholdM: number = LEAD_THRESHOLD_M): GapEngine {
  assertRaceSetup(setup);
  const tracker = createLeadTracker(thresholdM);

  return {
    get leader() {
      return tracker.leader;
    },
    update(t, myDistanceM) {
      const snapshot = measureGap(setup, t, myDistanceM);
      const event = tracker.update(t, snapshot.gapM);
      return { snapshot, event };
    },
  };
}
