// 입력의 공통 모양 (DESIGN.md 2번 "데이터 흐름")
// 실제 GPS(PLAN 작업 14)와 데모 재생(작업 3)이 모두 이 모양으로 점을 내보낸다.
// 그래야 분석 엔진이 입력이 GPS인지 데모인지 모르고 똑같이 동작한다.

/** 위치 입력의 한 점 */
export type PositionSample = {
  /** 레이스 시간(초). 출발 순간이 0이다. 데모를 10배속으로 재생해도 이 값은 레이스 안의 시간 그대로다 */
  t: number;
  /** 위도 */
  lat: number;
  /** 경도 */
  lon: number;
  /** 위치 정확도(미터). 작을수록 정확하다. 정확도가 낮은 점은 GPS 보정(작업 15)에서 버린다 */
  accuracyM: number;
  /** 고도(미터). 기기가 주지 않으면 null */
  ele: number | null;
};

/** 입력을 쓰는 쪽이 넘기는 받는 함수들 */
export type InputHandlers = {
  /** 점이 하나 들어올 때마다 불린다 */
  onSample: (sample: PositionSample) => void;
  /** 입력이 끝났을 때(데모는 경로의 마지막 점까지 보낸 뒤) 한 번 불린다 */
  onEnd?: () => void;
};

/** 위치 입력: 실제 GPS 입력과 데모 입력이 똑같이 지키는 약속 */
export type PositionInput = {
  /** 입력을 시작한다. 한 번만 시작할 수 있다 */
  start(handlers: InputHandlers): void;
  /** 입력을 멈춘다. 멈춘 입력은 다시 시작할 수 없다 */
  stop(): void;
};
