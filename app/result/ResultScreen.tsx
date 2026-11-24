"use client";
// 결과 화면 (PLAN.md 작업 17, DESIGN.md 1.3)
// 레이스가 끝나면 레이스 화면이 이 기기의 sessionStorage에 담아 둔 요약을 읽어 보여 준다.
// 승패와 기록, 시간대별 격차 그래프(누가 언제 앞섰는지), 양쪽 기록 조건, 리매치.
// 라이벌 전적과 개인 최고 기록(작업 18)은 레이스 화면이 저장하면서 요약에 함께 담아 둔다.
import RouteMap, { type RouteMarker } from "../RouteMap";
import { displayName } from "@/lib/runner-names";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { buildAnalysis, computeGraphGeometry, describeElevation } from "@/lib/result";
import { shareMyRecord, unshareMyRecord } from "@/lib/shared/client";
import { describeNewBest } from "@/lib/storage/history";
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
/** 상세 분석 창: 시간대별 격차 그래프 + 분석 글 + 기록 조건 */
function AnalysisSheet({ summary, onClose }: { summary: RaceSummary; onClose: () => void }) {
  const W = 320;
  const H = 120;
  const g = computeGraphGeometry(summary, W, H);
  const path = g.line.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const lines = buildAnalysis(summary);
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-label="상세 분석" onClick={onClose}>
      <div className="glass w-full max-h-[88%] overflow-y-auto bg-[#10131a]/95 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">상세 분석</h2>
          <button type="button" onClick={onClose} className="btn-secondary !px-3 !py-1 text-xs">닫기</button>
        </div>
        <p className="mt-3 text-xs text-white/55">시간대별 격차 (위쪽이 내가 앞, 최대 ±{g.rangeM}m)</p>
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label="시간대별 격차 그래프">
          <line x1="0" x2={W} y1={g.zeroY} y2={g.zeroY} stroke="rgba(255,255,255,0.3)" strokeDasharray="4 4" />
          <text x="4" y="12" fontSize="10" fill="rgba(255,255,255,0.55)">내가 앞</text>
          <text x="4" y={H - 4} fontSize="10" fill="rgba(255,255,255,0.55)">상대가 앞</text>
          <path d={path} fill="none" stroke="#facc15" strokeWidth="2.5" strokeLinejoin="round" />
          {g.markers.map((m, i) => (
            <circle key={i} cx={m.x} cy={g.zeroY} r="4" fill={m.type === "overtake" ? "#34d399" : "#f87171"} />
          ))}
        </svg>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm text-white/85">
          {lines.map((line, i) => (
            <li key={i}>• {line}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-white/55">
          기록 조건: 나 {describeElevation(summary.myElevationGainM, summary.settings.distanceM)} · 상대{" "}
          {describeElevation(summary.opponent.elevationGainM, summary.settings.distanceM)}
        </p>
      </div>
    </div>
  );
}

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
  const [analysisOpen, setAnalysisOpen] = useState(false);
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
    <main className="relative mx-auto flex h-dvh w-full max-w-md flex-col gap-3 overflow-hidden p-3">
      {analysisOpen && <AnalysisSheet summary={summary} onClose={() => setAnalysisOpen(false)} />}
      <section aria-label="코스 타임라인" className="glass relative min-h-0 flex-1 overflow-hidden !p-0">
        <RouteMap variant="tall" distanceM={settings.distanceM} label="레이스 코스와 추월 지점" progress={1} markers={timelineMarkers} />
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

      <button type="button" onClick={() => setAnalysisOpen(true)} className="btn-secondary shrink-0 !py-2.5 text-sm">
        ✨ 상세 분석 보기 (격차 그래프·추월 분석)
      </button>

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
