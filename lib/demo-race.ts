// 데모 레이스 설정 (PLAN.md 작업 8)
// 시작 화면(작업 12)과 매칭(작업 13)이 아직 없어서, 레이스 화면은 아래 고정된 한 판을 재생한다:
// 데모 경로(5km를 5:20/km 일정한 페이스로 달리는 "나")와 가상러너-03(5:30/km, 초반 질주형)의 5km 대결.
// 10배속으로 재생하면 약 2분 뒤에 역전이 한 번 일어난다.
import type { RaceSetup } from "./engine/gap";
import { virtualRunners } from "./runners";

/** 데모 레이스의 상대 */
export const DEMO_RIVAL_ID = "가상러너-03";

/** 데모 레이스의 대결 거리(미터) */
export const DEMO_RACE_DISTANCE_M = 5000;

/** 데모 레이스 설정을 만든다 */
export function getDemoRaceSetup(): RaceSetup {
  const opponent = virtualRunners.find((runner) => runner.id === DEMO_RIVAL_ID);
  if (!opponent) {
    throw new Error(`데모 상대(${DEMO_RIVAL_ID})를 가상 러너 기록에서 찾을 수 없다`);
  }
  return { opponent, raceDistanceM: DEMO_RACE_DISTANCE_M };
}
