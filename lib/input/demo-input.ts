// 데모 모드 입력 (PLAN.md 작업 3, DESIGN.md 2번)
// 기록된 경로를 10배속으로 재생해서, GPS 없이 책상 앞에서도 레이스를 확인하게 해 준다.
// 실제 GPS 입력과 같은 모양(PositionInput)으로 점을 내보낸다.
//
// 시간 기준: 점의 시간(t)은 "레이스 안의 시간"이고 재생 속도와 상관없이 그대로다.
// 10배속이면 실제 시계로는 t초짜리 경로가 t/10초 만에 흘러간다.
import type { InputHandlers, PositionInput, PositionSample } from "./types";

/** 데모 재생 속도: 레이스 시간이 실제 시계보다 몇 배 빠르게 흐르는가 */
export const DEMO_SPEED = 10;

/** 시계와 타이머. 시험에서 가짜로 바꿔 끼울 수 있게 따로 뺐다 */
export type DemoClock = {
  /** 지금 시각(밀리초) */
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

const realClock: DemoClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export type DemoInputOptions = {
  /** 재생 속도(배). 기본은 10배속 */
  speed?: number;
  clock?: DemoClock;
};

/**
 * 경로를 재생하는 입력을 만든다.
 * 첫 점은 시작하자마자 내보내고, 다음 점들은 "시작 시각 + (그 점의 시간 − 첫 점의 시간) ÷ 속도"에 맞춰 내보낸다.
 * 타이머가 조금 늦게 울려도 다음 점의 시각은 시작 시각을 기준으로 계산하므로 오차가 쌓이지 않는다.
 */
export function createDemoInput(track: PositionSample[], options: DemoInputOptions = {}): PositionInput {
  const speed = options.speed ?? DEMO_SPEED;
  const clock = options.clock ?? realClock;

  if (!(speed > 0)) {
    throw new Error("재생 속도는 0보다 커야 한다");
  }
  if (track.length === 0) {
    throw new Error("재생할 경로가 비어 있다");
  }
  for (let i = 1; i < track.length; i++) {
    if (track[i].t < track[i - 1].t) {
      throw new Error(`${i + 1}번째 점의 시간이 앞 점보다 작다`);
    }
  }

  let state: "idle" | "running" | "done" = "idle";
  let timer: unknown = null;

  return {
    start(handlers: InputHandlers) {
      if (state !== "idle") {
        throw new Error("데모 입력은 한 번만 시작할 수 있다");
      }
      state = "running";
      const startedAt = clock.now();
      let index = 0;

      const emitNext = () => {
        timer = null;
        if (state !== "running") return;

        const sample = track[index];
        index += 1;
        handlers.onSample(sample);
        // 받는 쪽이 점을 받다가 stop()을 불렀을 수 있다
        if (state !== "running") return;

        if (index >= track.length) {
          state = "done";
          handlers.onEnd?.();
          return;
        }
        const dueAt = startedAt + ((track[index].t - track[0].t) * 1000) / speed;
        timer = clock.setTimeout(emitNext, Math.max(0, dueAt - clock.now()));
      };

      emitNext();
    },

    stop() {
      state = "done";
      if (timer !== null) {
        clock.clearTimeout(timer);
        timer = null;
      }
    },
  };
}
