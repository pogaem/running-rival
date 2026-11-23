// 레이스 화면 (DESIGN.md 1.2)
// 화면의 실제 내용과 움직임은 RaceScreen(브라우저에서 동작하는 부분)이 맡는다.
// 시작 화면에서 정한 설정은 주소의 쿼리로 받으므로 Suspense로 감싼다.
import { Suspense } from "react";
import RaceScreen from "./RaceScreen";

export default function RacePage() {
  return (
    <Suspense fallback={<main className="p-4 text-sm text-foreground/60">레이스를 준비하는 중…</main>}>
      <RaceScreen />
    </Suspense>
  );
}
