"use client";
// 결과 화면 (PLAN.md 작업 17, DESIGN.md 1.3)
// 레이스가 끝나면 레이스 화면이 이 기기의 sessionStorage에 담아 둔 요약을 읽어 보여 준다.
// 승패와 기록, 시간대별 격차 그래프(누가 언제 앞섰는지), 양쪽 기록 조건, 리매치.
// 라이벌 전적과 개인 최고 기록(작업 18)은 레이스 화면이 저장하면서 요약에 함께 담아 둔다.
import { displayName } from "@/lib/runner-names";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { describeNewBest } from "@/lib/history";
import { formatRaceClock } from "@/lib/output/subtitles";
import { settingsToQuery } from "@/lib/race-settings";
import {
  computeGraphGeometry,
  describeElevation,
  formatMargin,
  parseSummary,
  SUMMARY_STORAGE_KEY,
  type RaceSummary,
} from "@/lib/result";

const GRAPH_W = 320;
const GRAPH_H = 140;

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

function GapGraph({ summary }: { summary: RaceSummary }) {
  const geometry = computeGraphGeometry(summary, GRAPH_W, GRAPH_H);
  const points = geometry.line.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  // 선과 0m 선 사이를 칠해 "내가 앞선 구간"(위)과 "상대가 앞선 구간"(아래)이 보이게 한다
  const area =
    geometry.line.length > 0
      ? `M ${geometry.line[0].x.toFixed(1)},${geometry.zeroY} ` +
        geometry.line.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
        ` L ${geometry.line[geometry.line.length - 1].x.toFixed(1)},${geometry.zeroY} Z`
      : "";
  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
        role="img"
        aria-label="시간대별 격차 그래프. 위쪽은 내가 앞선 구간, 아래쪽은 상대가 앞선 구간입니다."
        className="w-full rounded-lg border border-foreground/30"
      >
        <line x1="0" x2={GRAPH_W} y1={geometry.zeroY} y2={geometry.zeroY} stroke="currentColor" strokeOpacity="0.4" strokeDasharray="4 3" />
        {area && <path d={area} fill="currentColor" fillOpacity="0.12" />}
        {points && <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />}
        {geometry.markers.map((marker, index) => (
          <g key={index}>
            <line x1={marker.x} x2={marker.x} y1="0" y2={GRAPH_H} stroke="currentColor" strokeOpacity="0.5" />
            <text x={marker.x + 3} y="12" fontSize="10" fill="currentColor">
              {marker.type === "overtake" ? "추월" : "추월당함"}
            </text>
          </g>
        ))}
        <text x="4" y="12" fontSize="9" fill="currentColor" opacity="0.6">
          내가 앞 (+{geometry.rangeM}m)
        </text>
        <text x="4" y={GRAPH_H - 4} fontSize="9" fill="currentColor" opacity="0.6">
          상대가 앞 (-{geometry.rangeM}m)
        </text>
      </svg>
      <figcaption className="text-xs text-foreground/60">가로는 레이스 시간(0:00 ~ {formatRaceClock(summary.myTimeSec)})입니다.</figcaption>
    </figure>
  );
}

export default function ResultScreen() {
  const text = useStoredSummaryText();
  const summary = text === undefined ? null : parseSummary(text);

  if (text === undefined) {
    return <main className="p-4 text-sm text-foreground/60">결과를 불러오는 중…</main>;
  }

  if (!summary) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
        <header className="pt-4">
          <h1 className="text-2xl font-bold">결과</h1>
        </header>
        <p className="rounded-lg border border-foreground/30 p-3 text-sm">
          보여 줄 결과가 없어요. 대결 거리를 끝까지 달려야 결과가 나옵니다. 중간에 끝낸 경기는 결과와 전적에 반영하지 않아요.
        </p>
        <Link href="/" className="mt-auto rounded-lg bg-foreground px-4 py-3 text-center font-semibold text-background">
          처음으로
        </Link>
      </main>
    );
  }

  const { settings } = summary;
  const distanceKm = settings.distanceM / 1000;
  const margin = summary.opponentTimeSec - summary.myTimeSec; // 양수면 내가 빠름
  const rematchHref = `/race?${settingsToQuery(settings)}`;
  const OPPONENT_SOURCE = { virtual: "가상 러너", camp: "캠프 참가자", mine: "내 기록" } as const;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <header className="pt-4">
        <h1 className="text-2xl font-bold">결과</h1>
        <p className="mt-1 text-sm text-foreground/70">
          {distanceKm}km · {displayName(summary.opponent.id)} ({OPPONENT_SOURCE[summary.opponent.source]}) 와의 대결
        </p>
      </header>

      <section aria-label="승패와 기록" className="flex flex-col gap-1 rounded-lg border border-foreground/30 p-3">
        <p className={`text-3xl font-bold ${summary.won ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {summary.won ? "승리" : "패배"}
        </p>
        <p className="tabular-nums">
          내 기록 <b>{formatRaceClock(summary.myTimeSec)}</b> · 상대 기록 <b>{formatRaceClock(summary.opponentTimeSec)}</b>
        </p>
        <p className="text-sm text-foreground/70">
          {summary.won ? `${formatMargin(margin)} 먼저 들어왔어요` : `${formatMargin(margin)} 차이로 아쉽게 졌어요`}
          {summary.reversals.length > 0 ? ` · 역전 ${summary.reversals.length}번` : " · 역전 없이 끝났어요"}
        </p>
      </section>

      {summary.history && (
        <section aria-label="전적과 최고 기록" className="flex flex-col gap-1 rounded-lg border border-foreground/30 p-3 text-sm">
          <p>
            {displayName(summary.opponent.id)} 상대 전적 <b>{summary.history.rival.wins}승 {summary.history.rival.losses}패</b>
          </p>
          {summary.history.newBest && (
            <p className="font-semibold">{describeNewBest(summary.myTimeSec, summary.history.previousBestSec)}</p>
          )}
          <p className="text-xs text-foreground/60">전적과 최고 기록은 이 기기에만 저장돼요.</p>
        </section>
      )}

      <section aria-label="시간대별 격차 그래프" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">누가 언제 앞섰는지</h2>
        <GapGraph summary={summary} />
      </section>

      <section aria-label="기록 조건" className="flex flex-col gap-1 rounded-lg border border-foreground/30 p-3 text-sm">
        <h2 className="font-semibold">기록 조건</h2>
        <p>
          상대 {describeElevation(summary.opponent.elevationGainM, settings.distanceM)} / 나{" "}
          {describeElevation(summary.myElevationGainM, settings.distanceM)}
        </p>
        <p className="text-xs text-foreground/60">공식 기록 비교가 아니라 재미를 위한 비공식 대결이에요. 코스와 오르막 차이는 보정하지 않았어요.</p>
      </section>

      <div className="mt-auto flex gap-3">
        <Link href={rematchHref} className="flex-1 rounded-lg border border-foreground px-4 py-3 text-center font-semibold">
          리매치
        </Link>
        <Link href="/" className="flex-1 rounded-lg bg-foreground px-4 py-3 text-center font-semibold text-background">
          처음으로
        </Link>
      </div>
    </main>
  );
}
