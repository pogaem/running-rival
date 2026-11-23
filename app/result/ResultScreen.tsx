"use client";
// 결과 화면 (PLAN.md 작업 17, DESIGN.md 1.3)
// 레이스가 끝나면 레이스 화면이 이 기기의 sessionStorage에 담아 둔 요약을 읽어 보여 준다.
// 승패와 기록, 시간대별 격차 그래프(누가 언제 앞섰는지), 양쪽 기록 조건, 리매치.
// 라이벌 전적과 개인 최고 기록(작업 18)은 레이스 화면이 저장하면서 요약에 함께 담아 둔다.
import RouteMap, { type RouteMarker } from "../RouteMap";
import { displayName } from "@/lib/runner-names";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { shareMyRecord, unshareMyRecord } from "@/lib/shared/client";
import { describeNewBest } from "@/lib/history";
import { formatRaceClock } from "@/lib/output/subtitles";
import { freshRaceHref } from "@/lib/race-settings";
import { useRouter } from "next/navigation";
import {
  formatMargin,
  parseSummary,
  serializeSummary,
  SUMMARY_STORAGE_KEY,
  type RaceSummary,
} from "@/lib/result";

/** 저장된 요약 글을 읽는다. 서버에서는 null이다 */
function readStoredText(): string | null {
  try {
    return sessionStorage.getItem(SUMMARY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function useStoredSummaryText(): string | null | undefined {
  // 서버에서 그린 화면과 맞추려고, 브라우저에서 읽기 전에는 undefined(아직 모름)로 둔다
  return useSyncExternalStore(
    () => () => {},
    readStoredText,
    () => undefined,
  );
}

/** 내 기록 공유 (작업 24): 동의한 경우에만 올리고, 올린 뒤에도 이 기기에서 지울 수 있다 */
function SharePanel({ summary }: { summary: RaceSummary }) {
  const [sharedId, setSharedId] = useState<string | null>(summary.sharedId ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const track = summary.myTrack;
  /** 새로 고침해도 공유 상태가 남게 이 탭의 결과 요약에도 적어 둔다 */
  const remember = (id: string | null) => {
    try {
      const { sharedId: _old, ...rest } = summary;
      void _old;
      sessionStorage.setItem(SUMMARY_STORAGE_KEY, serializeSummary(id ? { ...rest, sharedId: id } : rest));
    } catch {
      // 적지 못해도 공유 자체에는 영향이 없다
    }
  };
  if (!track || track.length < 2) return null;

  const share = async () => {
    setBusy(true);
    setMessage(null);
    const result = await shareMyRecord({
      completedDistanceM: summary.settings.distanceM,
      totalElevationGainM: summary.myElevationGainM,
      points: track,
    });
    setBusy(false);
    if (result.ok) {
      setSharedId(result.id);
      remember(result.id);
    } else setMessage(result.message);
  };
  const unshare = async () => {
    if (!sharedId) return;
    setBusy(true);
    setMessage(null);
    const result = await unshareMyRecord(sharedId);
    setBusy(false);
    if (result.ok) {
      setSharedId(null);
      remember(null);
    }
    else setMessage(result.message);
  };

  return (
    <section aria-label="내 기록 공유" className="glass flex flex-col gap-2 px-4 py-3 text-sm">
      {sharedId ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-white/70">공유했어요. 다른 러너가 이 기록과 대결할 수 있어요.</p>
          <button type="button" onClick={unshare} disabled={busy} className="btn-secondary !px-3 !py-1.5 text-xs disabled:opacity-40">
            공유 취소
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-white/60">시간·거리만 익명으로 올라가요 (이름·위치 없음)</p>
          <button type="button" onClick={share} disabled={busy} className="btn-secondary !px-3 !py-1.5 text-xs disabled:opacity-40">
            {busy ? "올리는 중…" : "내 기록 공유"}
          </button>
        </div>
      )}
      {message && (
        <p role="alert" className="text-xs text-red-400">
          {message}
        </p>
      )}
    </section>
  );
}

export default function ResultScreen() {
  const router = useRouter();
  const text = useStoredSummaryText();
  const summary = text === undefined ? null : parseSummary(text);

  if (text === undefined) {
    return <main className="p-4 text-sm text-foreground/60">결과를 불러오는 중…</main>;
  }

  if (!summary) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
        <header className="pt-4">
          <h1 className="text-3xl font-bold tracking-tight">결과</h1>
        </header>
        <p className="glass p-4 text-sm">
          보여 줄 결과가 없어요. 대결 거리를 끝까지 달려야 결과가 나옵니다. 중간에 끝낸 경기는 결과와 전적에 반영하지 않아요.
        </p>
        <Link href="/" className="mt-auto btn-primary">
          처음으로
        </Link>
      </main>
    );
  }

  const { settings } = summary;
  const distanceKm = settings.distanceM / 1000;
  const margin = summary.opponentTimeSec - summary.myTimeSec; // 양수면 내가 빠름
  const OPPONENT_SOURCE = { virtual: "가상 러너", camp: "캠프 참가자", mine: "내 기록", shared: "다른 러너 기록" } as const;

  // 코스 타임라인: 출발, 추월 지점(걸린 시간 비율로 위치를 잡는다), 도착
  const timelineMarkers: RouteMarker[] = [
    { fraction: 0, label: "출발", tone: "flag", side: "right" },
    ...summary.reversals.map((reversal, i): RouteMarker => ({
      fraction: Math.min(0.96, Math.max(0.04, reversal.t / summary.myTimeSec)),
      label: `${reversal.type === "overtake" ? "추월" : "추월당함"} ${formatRaceClock(reversal.t)}`,
      tone: reversal.type === "overtake" ? "me" : "rival",
      side: i % 2 === 0 ? "left" : "right",
    })),
    { fraction: 1, label: `도착 ${formatRaceClock(summary.myTimeSec)}`, tone: "flag", side: "left" },
  ];

  return (
    <main className="mx-auto flex h-dvh w-full max-w-md flex-col gap-3 overflow-hidden p-3">
      <section aria-label="코스 타임라인" className="glass relative min-h-0 flex-1 overflow-hidden !p-0">
        <RouteMap variant="tall" label="레이스 코스와 추월 지점" progress={1} markers={timelineMarkers} />
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 to-transparent p-4 pb-10">
          <p className="text-[11px] font-semibold text-white/60">
            {distanceKm}km · {displayName(summary.opponent.id)} ({OPPONENT_SOURCE[summary.opponent.source]})
          </p>
          <p className={`text-6xl font-bold tracking-tight ${summary.won ? "text-emerald-400" : "text-red-400"}`}>
            {summary.won ? "승리" : "패배"}
          </p>
          <p className="mt-1 text-sm text-white/75">
            {summary.won ? `${formatMargin(margin)} 먼저 들어왔어요` : `${formatMargin(margin)} 차이로 아쉽게 졌어요`}
            {summary.reversals.length > 0 ? ` · 역전 ${summary.reversals.length}번` : ""}
          </p>
        </div>
      </section>

      <section aria-label="기록" className="grid shrink-0 grid-cols-2 gap-3 tabular-nums">
        <div className="glass px-4 py-3">
          <p className="text-xs text-white/55">내 기록</p>
          <p className="text-2xl font-bold">{formatRaceClock(summary.myTimeSec)}</p>
        </div>
        <div className="glass px-4 py-3">
          <p className="text-xs text-white/55">상대 기록</p>
          <p className="text-2xl font-bold">{formatRaceClock(summary.opponentTimeSec)}</p>
        </div>
      </section>

      {summary.history && (
        <p className="shrink-0 px-1 text-center text-sm text-white/80">
          {displayName(summary.opponent.id)} 상대 전적 <b>{summary.history.rival.wins}승 {summary.history.rival.losses}패</b>
          {summary.history.newBest ? ` · ${describeNewBest(summary.myTimeSec, summary.history.previousBestSec)}` : ""}
        </p>
      )}

      <div className="shrink-0">
        <SharePanel key={summary.raceId ?? 0} summary={summary} />
      </div>

      <div className="flex shrink-0 gap-3 pb-1">
        <Link
          href="/race"
          onClick={(event) => {
            event.preventDefault();
            router.push(freshRaceHref(settings));
          }}
          className="flex-1 btn-secondary"
        >
          리매치
        </Link>
        <Link href="/" className="flex-1 btn-primary">
          처음으로
        </Link>
      </div>
    </main>
  );
}
