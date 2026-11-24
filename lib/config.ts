// 설정값 모음 (DESIGN.md 6번 "설정값은 한 파일에 모은다")
// 앱이 쓰는 기준 숫자를 한곳에서 보고 고칠 수 있게 모았다. 값은 원래 자리(괄호)에 정의돼 있고 여기서 다시 내보낸다.
// 자동 출발 기준처럼 화면 코드에 박혀 있던 숫자는 이 파일이 원본이다.

// ── 자동 출발 (실제 GPS) ──────────────────────────────
/** 이 정확도(오차 반경, m)보다 나쁜 점은 출발 판단에 쓰지 않는다 */
export const AUTO_START_MAX_ACCURACY_M = 30;
/** 걷는 속도보다 빠르고(초속 2m ≈ 시속 7km) 달리기로 볼 수 있는 속도 범위 (m/s) */
export const AUTO_START_MIN_SPEED_MPS = 2;
export const AUTO_START_MAX_SPEED_MPS = 12;
/** 이 범위의 움직임이 연속으로 몇 번 이어지면 출발로 보는가 */
export const AUTO_START_COUNT = 3;
/** 위치 신호가 이 시간(초) 넘게 안 들어오면 "신호 약함" 안내와 함께 상대만 계속 달리는 모습을 보여 준다 */
export const SIGNAL_LOST_AFTER_SEC = 4;

// ── 올리기·저장 한도 ───────────────────────────────────
export { MAX_SHARED_RECORDS, PER_IP_LIMIT, PER_IP_WINDOW_SEC, SHARED_ORDER_START } from "./shared/service";

// ── 시작 화면 입력 범위 · 매칭 ─────────────────────────
export { MAX_PACE_SEC_PER_KM, MAX_RACE_DISTANCE_M, MIN_PACE_SEC_PER_KM, MIN_RACE_DISTANCE_M } from "./race-settings";
export { LATE_REVERSAL_FRACTION, MATCH_PACE_RANGE_SEC } from "./matching/match";

// ── 위치 보정 · 자동 일시정지 · 데모 ───────────────────
export { GAP_RESET_SEC, MAX_ACCURACY_M, MAX_SPEED_KMH, SMOOTHING_WINDOW } from "./input/gps-filter";
export { DEMO_SPEED } from "./input/demo-input";
export { ELEVATION_STEP_M } from "./input/elevation";
export { TRACK_STEP_M } from "./track-recorder";

// ── 분석 엔진 ─────────────────────────────────────────
export { LEAD_THRESHOLD_M } from "./engine/gap";
export { PACE_SEGMENT_SEC, PACE_WINDOW_SEC, PREDICTION_MAX_ANNOUNCE_SEC, PREDICTION_MAX_VARIATION, PREDICTION_MIN_RACE_TIME_SEC } from "./engine/catchup";
export { ADVANTAGE_MIN, DISADVANTAGE_MAX, STAGE_HYSTERESIS, WIN_CORRECTION_K, WIN_MIN_SIGMA_SEC } from "./engine/winprob";
export {
  ACTIVE_STATUS_INTERVAL_M,
  CLOSE_ENTER_M,
  CLOSE_LEAVE_HOLD_SEC,
  CLOSE_LEAVE_M,
  LAST_STRETCH_M,
  STATUS_INTERVAL_M,
} from "./engine/race-engine";

// ── 중계 · 소리 ───────────────────────────────────────
export { ACTIVE_VOICE_MIN_GAP_SEC, VOICE_MIN_GAP_SEC } from "./output/voice-policy";
export { VOICE_VOLUME_CAP } from "./output/speaker";
export { CHEER_VOLUME, HEARTBEAT_VOLUME } from "./output/sfx";
