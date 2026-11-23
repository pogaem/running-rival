// 경기 흐름 분석 엔진: 하나로 묶기 (PLAN.md 작업 8, DESIGN.md 2번 "이벤트 발행")
// 격차·역전(gap.ts), 추월 예측(catchup.ts), 예상 승률(winprob.ts)을 한 번에 돌리고,
// 거리에 따라 생기는 사건(1km 통과, 마지막 200m, 결승)과 접전 사건까지 모아서 "이벤트"로 내보낸다.
//
// 이 파일도 계산만 한다. 음성·진동·자막·GPS를 모른다. 이벤트를 어떻게 보여 줄지는 출력부(lib/output)가 정한다.
// 시간(t)은 레이스 안의 시간(초)이다.
import { timeToReachDistance } from "../record";
import {
  createPredictor,
  type Prediction,
  type RecentPace,
} from "./catchup";
import {
  createGapEngine,
  type GapSnapshot,
  type Leader,
  type RaceSetup,
} from "./gap";
import {
  createWinTracker,
  type WinEstimate,
  type WinStage,
} from "./winprob";

/** 격차가 이 값(미터) 이내로 들어오면 "접전" (DESIGN.md 이벤트 표) */
export const CLOSE_ENTER_M = 10;
/** 접전에서 이 값(미터)보다 더 벌어져야 "벗어났다"고 본다. 10m 근처에서 자꾸 들락거리지 않게 하는 여유(초안) */
export const CLOSE_LEAVE_M = 15;
/** 결승선까지 이 거리(미터) 이하가 남으면 "마지막 200m" */
export const LAST_STRETCH_M = 200;
/** 중간 상황(status)을 내보내는 거리 간격(미터). 앞서든 뒤처지든 내가 이만큼 달릴 때마다 중계한다.
 * 시간이 아니라 거리 기준이라 데모 배속이나 페이스에 상관없이 코스 위 같은 자리에서 중계가 나온다 */
export const STATUS_INTERVAL_M = 300;
/** 적극 중계는 조금 더 자주(미터) */
export const ACTIVE_STATUS_INTERVAL_M = 200;
/** 결승선까지 이 거리(미터) 이하가 남으면 중간 상황은 더 말하지 않는다 (마지막 200m 멘트와 결승이 있다) */
const STATUS_STOP_M = 40;
/** 결승선에 닿았다고 보는 오차 범위(미터). 거리 계산의 아주 작은 오차를 감안한다 */
const ARRIVED_TOLERANCE_M = 1e-6;

/** 엔진이 내보내는 이벤트 */
export type RaceEvent =
  /** 추월: 내가 상대를 10m 이상 앞서게 됨 / 추월당함: 상대가 나를 10m 이상 앞서게 됨 */
  | { type: "overtake" | "overtaken"; t: number; gapM: number }
  /** 접전: 격차가 10m 이내로 들어옴 / 벗어남 */
  | { type: "closeEnter" | "closeLeave"; t: number; gapM: number }
  /** 승률 단계(우세·접전·열세)가 바뀜 */
  | { type: "winStage"; t: number; from: WinStage; to: WinStage; probability: number }
  /** 결승선까지 200m 이하가 남음 */
  | { type: "last200m"; t: number }
  /** 1km 통과 (결승선과 겹치는 마지막 km는 결승 이벤트로 대신한다) */
  | { type: "km"; t: number; km: number }
  /** 결승선 통과. won은 내가 상대보다 먼저 도착했는지 */
  | { type: "finish"; t: number; won: boolean }
  /** 출발: 레이스가 시작됐다 */
  | { type: "start"; t: number }
  /** 절반 지점 통과. remainingM은 남은 거리 */
  | { type: "half"; t: number; gapM: number; remainingM: number }
  /** 중간 상황: 이기든 지든 일정한 시간마다 지금 누가 얼마나 앞서는지 알린다 (gapM은 내가 앞서면 +) */
  | { type: "status"; t: number; gapM: number; remainingM: number };

/** 1초마다의 결과 */
export type RaceTick = {
  t: number;
  /** 같은 시점의 나와 상대 거리, 격차 */
  snapshot: GapSnapshot;
  /** 지금 앞서 있다고 확정된 쪽 */
  leader: Leader;
  /** 최근 60초 페이스 (60초 전에는 null) */
  recentPace: RecentPace | null;
  /** 지금의 추월 예측 (말할 만한 것이 없으면 null) */
  prediction: Prediction | null;
  /** 예상 승률 (60초 전에는 null) */
  estimate: WinEstimate | null;
  stage: WinStage | null;
  /** 이번 1초에 새로 생긴 이벤트들 */
  events: RaceEvent[];
  /** 결승선을 통과해 레이스가 끝났는가 */
  finished: boolean;
};

export type RaceEngine = {
  /** 1초마다 레이스 시간과 나의 누적 거리를 알려 준다. 결승선을 통과한 뒤에는 이벤트 없이 마지막 결과를 그대로 돌려준다 */
  update(t: number, myDistanceM: number): RaceTick;
  /** 중간 상황을 내보내는 거리 간격(미터)을 바꾼다. 중계 강도를 바꿀 때 쓴다 */
  setStatusIntervalM(meters: number): void;
};

export function createRaceEngine(setup: RaceSetup): RaceEngine {
  const gapEngine = createGapEngine(setup);
  const predictor = createPredictor(setup);
  const winTracker = createWinTracker(setup);

  const race = setup.raceDistanceM;
  const opponentFinishAt = timeToReachDistance(setup.opponent, race) ?? Infinity;

  let closeness: "unknown" | "close" | "apart" = "unknown";
  let kmSent = 0;
  let last200Sent = false;
  let finishedTick: RaceTick | null = null;
  let started = false;
  let halfSent = false;
  let lastStatusDistanceM = 0;
  let statusIntervalM = STATUS_INTERVAL_M;

  return {
    setStatusIntervalM(meters) {
      if (meters > 0) statusIntervalM = meters;
    },
    update(t, myDistanceM) {
      if (finishedTick) return { ...finishedTick, events: [] };

      const events: RaceEvent[] = [];
      if (!started) {
        started = true;
        events.push({ type: "start", t });
      }

      // 1) 격차와 추월·추월당함
      const { snapshot, event: leadEvent } = gapEngine.update(t, myDistanceM);
      if (leadEvent) events.push(leadEvent);

      // 2) 접전: 처음부터 가까운 것(출발 직후)은 사건으로 세지 않고, 한 번 벌어졌다 다시 들어올 때부터 센다
      const closeGap = Math.abs(snapshot.gapM);
      if (closeness === "unknown") {
        closeness = closeGap <= CLOSE_ENTER_M ? "close" : "apart";
      } else if (closeness === "apart" && closeGap <= CLOSE_ENTER_M) {
        closeness = "close";
        events.push({ type: "closeEnter", t, gapM: snapshot.gapM });
      } else if (closeness === "close" && closeGap > CLOSE_LEAVE_M) {
        closeness = "apart";
        events.push({ type: "closeLeave", t, gapM: snapshot.gapM });
      }

      // 3) 추월 예측과 예상 승률
      const { recentPace, prediction } = predictor.update(t, myDistanceM);
      const win = winTracker.update(t, myDistanceM, recentPace);
      if (win.change) {
        events.push({ type: "winStage", t, from: win.change.from, to: win.change.to, probability: win.change.probability });
      }

      // 4) 거리에 따른 사건: 1km 통과, 마지막 200m, 결승
      const traveled = snapshot.myDistanceM;
      const kmNow = Math.floor(traveled / 1000);
      while (kmSent < kmNow) {
        kmSent += 1;
        if (kmSent * 1000 < race) events.push({ type: "km", t, km: kmSent });
      }
      const arrived = race - traveled <= ARRIVED_TOLERANCE_M;
      if (!halfSent && traveled >= race / 2 && !arrived) {
        halfSent = true;
        lastStatusDistanceM = traveled; // 절반 멘트와 중간 상황이 겹쳐 나오지 않게 한다
        events.push({ type: "half", t, gapM: snapshot.gapM, remainingM: race - traveled });
      }
      if (!arrived && traveled - lastStatusDistanceM >= statusIntervalM && race - traveled > STATUS_STOP_M) {
        lastStatusDistanceM = traveled;
        events.push({ type: "status", t, gapM: snapshot.gapM, remainingM: race - traveled });
      }
      if (!last200Sent && race - traveled <= LAST_STRETCH_M) {
        last200Sent = true;
        lastStatusDistanceM = traveled;
        events.push({ type: "last200m", t });
      }
      if (arrived) {
        events.push({ type: "finish", t, won: t < opponentFinishAt });
      }

      const tick: RaceTick = {
        t,
        snapshot,
        leader: gapEngine.leader,
        recentPace,
        prediction,
        estimate: win.estimate,
        stage: win.stage,
        events,
        finished: arrived,
      };
      if (arrived) finishedTick = tick;
      return tick;
    },
  };
}
