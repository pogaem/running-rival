// 레이스 화면 (DESIGN.md 1.2)
// 지금은 뼈대만 있다. 실제 격차·자막은 PLAN.md의 작업 4~8에서 채운다.
import Link from "next/link";

export default function RacePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <header className="pt-4">
        <h1 className="text-2xl font-bold">레이스</h1>
        <p className="mt-1 text-sm text-foreground/70">
          화면을 보지 않아도 되게, 중계는 소리로 전해 드립니다.
        </p>
      </header>

      <section aria-label="진행 상황" className="flex flex-col gap-3">
        <div className="rounded-lg border border-dashed border-foreground/30 p-3">
          <h2 className="text-sm font-semibold">거리와 시간</h2>
          <p className="mt-1 text-sm text-foreground/60">예: 3.2km / 5km, 12:40 (작업 8에서 만든다)</p>
        </div>
        <div className="rounded-lg border border-dashed border-foreground/30 p-3">
          <h2 className="text-sm font-semibold">나와 상대의 격차</h2>
          <p className="mt-1 text-sm text-foreground/60">격차 막대와 예상 승률 (작업 6·8에서 만든다)</p>
        </div>
        <div className="rounded-lg border border-dashed border-foreground/30 p-3">
          <h2 className="text-sm font-semibold">중계 자막</h2>
          <p className="mt-1 text-sm text-foreground/60">
            나간 멘트를 시간과 함께 쌓는 칸 (작업 8에서 만든다)
          </p>
        </div>
      </section>

      <div className="mt-auto flex gap-3">
        <button
          type="button"
          disabled
          className="flex-1 rounded-lg border border-foreground/30 px-4 py-3 text-foreground/40"
        >
          일시정지 (작업 16)
        </button>
        <Link
          href="/result"
          className="flex-1 rounded-lg bg-foreground px-4 py-3 text-center font-semibold text-background"
        >
          종료
        </Link>
      </div>
    </main>
  );
}
