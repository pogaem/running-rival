// 중계 멘트 템플릿 (PLAN.md 작업 9, PRD 5번 "음성 설계 원칙")
// 이벤트마다 3~5개의 멘트를 두고 번갈아 고른다. 같은 멘트가 연달아 두 번 나오지 않게 한다.
// 말투는 사용자를 "도전자"로 부르는 3인칭 스포츠 중계다. "더 밀어붙이세요" 같은 코칭 말투는 쓰지 않는다.
// 멘트는 템플릿으로 만들고 실시간 AI는 쓰지 않는다 (지연·비용·네트워크 문제).
import type { Prediction } from "../engine/catchup";
import type { RaceEvent } from "../engine/race-engine";

/** 난수 함수: 0 이상 1 미만의 숫자를 돌려준다. 시험에서는 정해진 값을 돌려주는 가짜로 바꿔 끼운다 */
export type Random = () => number;

/** 멘트에 끼워 넣는 값 */
type Vars = Record<string, string | number>;

/** 멘트 후보들. {이름} 자리는 값으로 바뀐다 */
const PHRASES = {
  overtake: [
    "추월! 도전자가 앞서 나갑니다!",
    "역전입니다! 도전자, 선두로 올라섭니다!",
    "치고 나갑니다! 도전자가 상대를 제쳤습니다!",
    "도전자, 드디어 앞에 섰습니다!",
  ],
  overtaken: [
    "추월당했습니다! 상대가 앞서 나갑니다!",
    "상대가 치고 나갑니다! 도전자, 다시 따라붙어야 합니다!",
    "역전을 허용했습니다! 아직 승부는 끝나지 않았습니다!",
    "상대가 앞에 섰습니다! 도전자, 기회는 아직 남아 있습니다!",
  ],
  closeEnter: [
    "접전입니다! 두 선수의 거리가 10미터 안으로 좁혀졌습니다!",
    "바짝 붙었습니다! 승부를 알 수 없습니다!",
    "격차가 거의 없습니다! 손에 땀을 쥐게 합니다!",
  ],
  closeLeaveAhead: [
    "도전자가 조금씩 달아나고 있습니다!",
    "도전자, 격차를 벌립니다!",
    "도전자가 앞에서 거리를 만들어 갑니다!",
  ],
  closeLeaveBehind: [
    "상대가 달아나고 있습니다! 격차가 벌어집니다!",
    "간격이 벌어지고 있습니다! 상대가 앞서 갑니다!",
    "상대가 조금씩 거리를 벌립니다!",
  ],
  stageAdvantage: [
    "승부의 흐름이 도전자 쪽으로 기웁니다!",
    "도전자, 우세한 흐름입니다!",
    "이 페이스라면 도전자가 유리합니다!",
  ],
  stageClose: ["승부는 팽팽한 접전입니다!", "아직 어느 쪽도 장담할 수 없습니다!", "한 치 앞을 알 수 없는 승부입니다!"],
  stageDisadvantage: [
    "상대가 조금 더 유리한 흐름입니다!",
    "도전자, 열세에 놓였습니다. 아직 기회는 있습니다!",
    "흐름은 상대 쪽입니다. 하지만 레이스는 계속됩니다!",
  ],
  last200m: [
    "마지막 200미터! 결승선이 보입니다!",
    "남은 거리 200미터! 끝까지 달립니다!",
    "라스트 스퍼트 구간에 들어섭니다!",
  ],
  km: ["{km}킬로미터를 통과합니다!", "{km}킬로미터 통과! 레이스는 계속됩니다!", "벌써 {km}킬로미터입니다!"],
  finishWon: ["결승선 통과! 도전자의 승리입니다!", "우승입니다! 도전자가 먼저 들어옵니다!", "골인! 도전자가 이겼습니다!"],
  finishLost: [
    "결승선 통과! 아쉽게 상대가 먼저 들어왔습니다.",
    "상대가 먼저 골인했습니다. 도전자, 수고했습니다!",
    "아쉬운 결과입니다. 그래도 끝까지 달렸습니다!",
  ],
  start: ["출발! 도전자와 상대, 레이스가 시작됩니다!", "자, 출발합니다! 도전자, 좋은 스타트입니다!", "경기 시작! 끝까지 함께 지켜봅니다!"],
  half: [
    "절반을 통과합니다! 남은 거리는 {remain}미터입니다!",
    "반환점을 돌았습니다! 이제 {remain}미터 남았습니다!",
    "벌써 절반입니다! {remain}미터만 더 가면 결승선입니다!",
  ],
  statusAhead: [
    "도전자가 상대를 {gap}미터 앞서 달립니다! 남은 거리 {remain}미터!",
    "도전자가 앞서 갑니다! 격차 {gap}미터, 결승까지 {remain}미터!",
    "선두는 도전자! 상대와 {gap}미터 차이입니다!",
    "도전자, 리드를 지키고 있습니다! {gap}미터 앞섭니다!",
  ],
  statusBehind: [
    "상대가 {gap}미터 앞서 있습니다! 도전자, 남은 거리 {remain}미터!",
    "도전자가 {gap}미터 뒤에서 쫓고 있습니다! 아직 승부는 모릅니다!",
    "상대가 앞서지만 격차는 {gap}미터뿐입니다! 결승까지 {remain}미터!",
    "도전자, 상대의 뒤를 바짝 쫓습니다! {gap}미터 차이입니다!",
  ],
  statusEven: [
    "두 선수가 나란히 달립니다! 남은 거리 {remain}미터!",
    "거의 같은 위치입니다! 승부는 지금부터입니다!",
    "한 발짝도 차이가 없습니다! 결승까지 {remain}미터!",
  ],
  predictOvertakeNumber: [
    "도전자, {sec}초 뒤 추월 페이스입니다!",
    "이 페이스라면 {sec}초 뒤에 따라잡습니다!",
    "{sec}초 뒤 역전이 보입니다!",
  ],
  predictOvertakeVague: ["도전자, 따라붙고 있습니다!", "조금씩 거리를 좁힙니다!", "도전자가 상대의 등을 바라보며 달립니다!"],
  predictOvertakenNumber: ["{sec}초 뒤 따라잡힐 수 있습니다!", "이 페이스라면 {sec}초 뒤에 상대가 따라붙습니다!"],
  predictOvertakenVague: ["상대가 뒤에서 따라붙고 있습니다!", "뒤에서 상대가 거리를 좁혀 옵니다!"],
} as const;

export type PhraseKey = keyof typeof PHRASES;

/** 멘트 후보 목록 (시험과 확인용) */
export function phraseCandidates(key: PhraseKey): readonly string[] {
  return PHRASES[key];
}

/** {이름} 자리를 값으로 바꾼다 */
function fill(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}

/** 남은 거리를 읽기 좋게 10미터 단위로 맞춘다 (최소 10) */
function roundTo10(meters: number): number {
  return Math.max(10, Math.round(meters / 10) * 10);
}

export type PhraseBook = {
  /** 이벤트에 맞는 멘트 하나를 고른다 */
  forEvent(event: RaceEvent): string;
  /** 추월 예측에 맞는 멘트 하나를 고른다 */
  forPrediction(prediction: Prediction): string;
};

/**
 * 멘트를 고르는 도구. 종류마다 마지막으로 쓴 멘트를 기억해서, 후보가 둘 이상이면 같은 멘트를 연달아 쓰지 않는다.
 */
export function createPhraseBook(random: Random = Math.random): PhraseBook {
  const lastIndex = new Map<PhraseKey, number>();

  const pick = (key: PhraseKey, vars: Vars = {}): string => {
    const list = PHRASES[key];
    let index = Math.min(list.length - 1, Math.floor(random() * list.length));
    const previous = lastIndex.get(key);
    if (list.length > 1 && index === previous) index = (index + 1) % list.length;
    lastIndex.set(key, index);
    return fill(list[index], vars);
  };

  return {
    forEvent(event) {
      switch (event.type) {
        case "overtake":
          return pick("overtake");
        case "overtaken":
          return pick("overtaken");
        case "closeEnter":
          return pick("closeEnter");
        case "closeLeave":
          return pick(event.gapM >= 0 ? "closeLeaveAhead" : "closeLeaveBehind");
        case "winStage":
          return pick(
            event.to === "advantage" ? "stageAdvantage" : event.to === "disadvantage" ? "stageDisadvantage" : "stageClose",
          );
        case "last200m":
          return pick("last200m");
        case "km":
          return pick("km", { km: event.km });
        case "finish":
          return pick(event.won ? "finishWon" : "finishLost");
        case "start":
          return pick("start");
        case "half":
          return pick("half", { remain: roundTo10(event.remainingM) });
        case "status": {
          const gap = Math.abs(Math.round(event.gapM));
          const remain = roundTo10(event.remainingM);
          if (gap < 3) return pick("statusEven", { remain });
          return pick(event.gapM > 0 ? "statusAhead" : "statusBehind", { gap, remain });
        }
      }
    },

    forPrediction(prediction) {
      const sec = Math.max(1, Math.round(prediction.inSec));
      if (prediction.type === "overtake") {
        return prediction.speak === "number" ? pick("predictOvertakeNumber", { sec }) : pick("predictOvertakeVague");
      }
      return prediction.speak === "number" ? pick("predictOvertakenNumber", { sec }) : pick("predictOvertakenVague");
    },
  };
}
