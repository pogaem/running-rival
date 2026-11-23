// 자동 일시정지 (PLAN.md 작업 16, PRD 5번 "자동 일시정지", DESIGN.md 2번 3항)
// 신호 대기 등으로 멈추면 "레이스 시간"을 멈춘다. 레이스 시간이 멈추면 상대 기록(고스트)도 같이 멈추고,
// 엔진이 돌지 않으니 중계도 나가지 않는다. 다시 달리면 이어서 흐른다.
//  - 멈춤: 최근 5초 동안 2.5m도 못 움직였다.
//  - 재개: 최근 3초 동안 4m 이상 움직였다 (멈춤보다 기준을 높여 흔들림 때문에 껐다 켜지지 않게 한다).
//  - 신호가 끊긴 시간은 멈춘 것으로 보지 않는다. 터널이나 건물 사이에서는 계속 달리고 있을 수 있어서,
//    상대 기록은 그대로 흐르고 위치가 다시 잡히면 그동안 달린 거리가 한꺼번에 반영된다. (DESIGN 7번의 "끊기면 일시정지"와 다르다)
// 이 파일은 계산만 한다. 입력·화면·소리를 모른다.

export type AutoPauseOptions = {
  stopWindowSec?: number;
  stopMaxMovedM?: number;
  resumeWindowSec?: number;
  resumeMinMovedM?: number;
};

export type AutoPauseState = {
  /** 지금 멈춰 있는가 */
  paused: boolean;
  /** 멈춘 시간을 뺀 레이스 시간(초). 줄어들지 않는다 */
  raceTimeSec: number;
};

export type AutoPause = {
  /** 시계(t초)와 누적 거리(m)를 넣는다. 시계는 앞으로만 흐른다 */
  update(t: number, distanceM: number): AutoPauseState;
  /** 지금까지 멈춘 시간(초) */
  readonly pausedTotalSec: number;
};

type Point = { t: number; d: number };

export function createAutoPause(options: AutoPauseOptions = {}): AutoPause {
  const stopWindowSec = options.stopWindowSec ?? 5;
  const stopMaxMovedM = options.stopMaxMovedM ?? 2.5;
  const resumeWindowSec = options.resumeWindowSec ?? 3;
  const resumeMinMovedM = options.resumeMinMovedM ?? 4;
  const keepSec = Math.max(stopWindowSec, resumeWindowSec) + 1;

  let history: Point[] = [];
  let paused = false;
  let pauseStart = 0;
  let closedPausedSec = 0; // 이미 끝난 멈춤 시간의 합
  let lastRaceTime = 0;

  /** 지금(now)부터 windowSec초 전 이전의 가장 가까운 점. 그만큼 오래된 점이 없으면 null */
  const pointAtLeastAgo = (now: number, windowSec: number): Point | null => {
    let found: Point | null = null;
    for (const point of history) {
      if (point.t <= now - windowSec) found = point;
      else break;
    }
    return found;
  };

  return {
    update(t, distanceM) {
      history.push({ t, d: distanceM });
      history = history.filter((p) => p.t >= t - keepSec);

      if (!paused) {
        const start = pointAtLeastAgo(t, stopWindowSec);
        if (start && distanceM - start.d < stopMaxMovedM) {
          paused = true;
          pauseStart = start.t; // 멈춘 시점은 그 5초 창이 시작한 때로 되돌린다
        }
      } else {
        const start = pointAtLeastAgo(t, resumeWindowSec);
        if (start && distanceM - start.d >= resumeMinMovedM) {
          paused = false;
          closedPausedSec += Math.max(0, start.t - pauseStart); // 다시 움직이기 시작한 때까지가 멈춘 시간
        }
      }

      const openPausedSec = paused ? Math.max(0, t - pauseStart) : 0;
      const computed = t - closedPausedSec - openPausedSec;
      lastRaceTime = Math.max(lastRaceTime, computed);
      return { paused, raceTimeSec: lastRaceTime };
    },

    get pausedTotalSec() {
      return closedPausedSec + (paused ? Math.max(0, (history[history.length - 1]?.t ?? pauseStart) - pauseStart) : 0);
    },
  };
}
