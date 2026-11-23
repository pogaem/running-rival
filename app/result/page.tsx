// 결과 화면 (DESIGN.md 1.3)
// 지금은 뼈대만 있다. 실제 결과·그래프는 PLAN.md의 작업 17에서 채운다.
import Link from "next/link";

export default function ResultPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <header className="pt-4">
        <h1 className="text-2xl font-bold">결과</h1>
        <p className="mt-1 text-sm text-foreground/70">누가 언제 앞섰는지 돌아봅니다.</p>
      </header>

      <section aria-label="경기 결과" className="flex flex-col gap-3">
        <div className="rounded-lg border border-dashed border-foreground/30 p-3">
          <h2 className="text-sm font-semibold">승패와 기록</h2>
          <p className="mt-1 text-sm text-foreground/60">승 / 패, 기록 시간 (작업 17에서 만든다)</p>
        </div>
        <div className="rounded-lg border border-dashed border-foreground/30 p-3">
          <h2 className="text-sm font-semibold">시간대별 격차 그래프</h2>
          <p className="mt-1 text-sm text-foreground/60">누가 언제 앞섰는지 (작업 17에서 만든다)</p>
        </div>
        <div className="rounded-lg border border-dashed border-foreground/30 p-3">
          <h2 className="text-sm font-semibold">기록 조건과 성장</h2>
          <p className="mt-1 text-sm text-foreground/60">
            양쪽 기록 조건, 지난 대결 대비 성장, 개인 최고 기록 (작업 17·18에서 만든다)
          </p>
        </div>
      </section>

      <div className="mt-auto flex gap-3">
        <Link
          href="/race"
          className="flex-1 rounded-lg border border-foreground px-4 py-3 text-center font-semibold"
        >
          리매치
        </Link>
        <Link
          href="/"
          className="flex-1 rounded-lg bg-foreground px-4 py-3 text-center font-semibold text-background"
        >
          처음으로
        </Link>
      </div>
    </main>
  );
}
