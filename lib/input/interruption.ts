// 도중 방해 처리 (PLAN.md 작업 20, PRD 5번 "예외 처리", DESIGN.md 7번)
// 전화·앱 전환 등으로 화면이 가려지면 경기를 멈추고, 돌아오면 이어간다.
// 가려진 동안은 레이스 시간이 흐르지 않는다(상대 기록도 같이 멈춘다). 그 시간은 "방해로 멈춘 시간"으로 따로 센다.
// 시계는 입력이 주는 시간(샘플의 t) 기준이라 데모(10배속)와 실제 GPS에 똑같이 쓴다.
// 이 파일은 계산만 한다. 화면·소리·브라우저 기능을 모른다.

export type InterruptionResult = {
  /** true면 이 샘플은 화면이 가려진 동안 온 것이라 쓰지 않는다 */
  skip: boolean;
  /** 지금까지 방해로 멈춘 시간(입력 시계 초). 레이스 시간 = 입력 시간 - 이 값 */
  interruptedSec: number;
};

export type InterruptionTracker = {
  /** 화면이 가려졌다 */
  hide(): void;
  /** 화면이 돌아왔다 */
  show(): void;
  /** 샘플이 올 때마다 부른다 */
  onSample(t: number): InterruptionResult;
  /** 지금 가려져 있는가 */
  readonly hidden: boolean;
  /** 가려졌다 돌아온 횟수 */
  readonly count: number;
};

export function createInterruptionTracker(): InterruptionTracker {
  let hidden = false;
  let awaitingResume = false;
  let lastT = 0; // 마지막으로 쓴 샘플의 시간
  let interrupted = 0;
  let count = 0;

  return {
    hide() {
      if (hidden) return;
      hidden = true;
      awaitingResume = false;
    },
    show() {
      if (!hidden) return;
      hidden = false;
      awaitingResume = true;
      count += 1;
    },
    onSample(t) {
      if (hidden) return { skip: true, interruptedSec: interrupted };
      if (awaitingResume) {
        // 마지막으로 쓴 샘플부터 돌아온 뒤 첫 샘플까지가 멈춘 시간이다
        interrupted += Math.max(0, t - lastT);
        awaitingResume = false;
      }
      lastT = t;
      return { skip: false, interruptedSec: interrupted };
    },
    get hidden() {
      return hidden;
    },
    get count() {
      return count;
    },
  };
}
