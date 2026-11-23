// 브라우저 소리 장치(AudioContext)는 앱 전체에서 하나만 만들어 같이 쓴다.
// 레이스를 다시 시작할 때마다 새로 만들면 아이폰 등에서 개수 제한에 걸려 두 번째 대결부터 소리가 안 날 수 있다.
let shared: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (shared && shared.state !== "closed") return shared;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  shared = new Ctor();
  return shared;
}
