// 시작 화면 (DESIGN.md 1.1)
// 지금은 뼈대만 있다. 각 칸의 실제 기능은 PLAN.md의 작업 12(시작 화면)와 13(매칭)에서 채운다.
import Link from "next/link";

export default function StartPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <header className="pt-4">
        <h1 className="text-2xl font-bold">러닝 라이벌</h1>
        <p className="mt-1 text-sm text-foreground/70">
          역전이 일어날 상대를 골라, 경기를 중계해 드립니다.
        </p>
      </header>

      <section aria-label="대결 설정" className="flex flex-col gap-3">
        <div className="rounded-lg border border-dashed border-foreground/30 p-3">
          <h2 className="text-sm font-semibold">대결 거리</h2>
          <p className="mt-1 text-sm text-foreground/60">3km / 5km 선택 (작업 12에서 만든다)</p>
        </div>
        <div className="rounded-lg border border-dashed border-foreground/30 p-3">
          <h2 className="text-sm font-semibold">평소 페이스</h2>
          <p className="mt-1 text-sm text-foreground/60">
            페이스 입력 또는 지난 기록 불러오기 (작업 12에서 만든다)
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-foreground/30 p-3">
          <h2 className="text-sm font-semibold">중계 강도</h2>
          <p className="mt-1 text-sm text-foreground/60">
            최소 · 일반 · 적극, 실험용 중계 끄기 (작업 12에서 만든다)
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-foreground/30 p-3">
          <h2 className="text-sm font-semibold">매칭된 상대</h2>
          <p className="mt-1 text-sm text-foreground/60">
            라이벌 전적과 상대 유형 표시 (작업 13에서 만든다)
          </p>
        </div>
      </section>

      <p className="text-xs text-foreground/60">
        이어폰의 외부 소리 듣기 모드를 켜고 뛰는 것을 권장합니다.
      </p>

      <Link
        href="/race"
        className="mt-auto rounded-lg bg-foreground px-4 py-3 text-center font-semibold text-background"
      >
        대결 시작
      </Link>
    </main>
  );
}
