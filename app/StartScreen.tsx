"use client";
// 시작 화면 (PLAN.md 작업 12, DESIGN.md 1.1)
// 대결 거리, 평소 페이스, 중계 강도를 정하고 레이스 화면으로 보낸다.
// 매칭된 상대 칸은 역전 예측 매칭(작업 13)의 결과를 보여 준다. 역전이 "예상"된다는 뜻이지 보장은 아니다.
import { useOpponentPool } from "./useOpponentPool";
import RouteMap, { type RouteMarker } from "./RouteMap";
import { displayName } from "@/lib/runner-names";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { bestPaceSecPerKm, formatRivalRecord, loadHistoryText, parseHistory } from "@/lib/storage/history";
import { INTENSITY_LABEL, type Intensity } from "@/lib/output/voice-policy";
import {
  averagePaceSecPerKm,
  DEFAULT_RACE_SETTINGS,
  formatPace,
  parsePaceInput,
  parseDistanceInput,
  matchForSettings,
  freshRaceHref,
  type RaceSource,
} from "@/lib/race-settings";

/** 중계 양(강도)마다 무엇을 말해 주는지 한 줄 설명 */
const INTENSITY_HELP: Record<Intensity, string> = {
  off: "",
  minimal: "추월·접전·결승 같은 큰 순간만 말해요",
  normal: "큰 순간 + 1km·절반·마지막 200m, 300m마다 중간 상황",
  active: "일반 + 200m마다 중간 상황, 추월 예상 시간, 승률 변화",
};

/** 화면에서 고르는 중계 강도 (끄기는 실험용이라 따로 둔다) */
const MAIN_INTENSITIES: Intensity[] = ["minimal", "normal", "active"];

const OPPONENT_SOURCE_LABEL = { virtual: "가상 러너", camp: "캠프 참가자", mine: "내 기록", shared: "다른 러너 기록" } as const;

function choiceClass(selected: boolean) {
  return `rounded-full border px-3 py-2 text-sm font-semibold ${
    selected ? "border-white bg-white text-[#0a0c12]" : "border-white/20 bg-white/5"
  }`;
}

/** 이 기기에 저장된 전적·최고 기록 글. 서버에서 그릴 때는 비어 있다 */
function useHistoryText(): string | null {
  return useSyncExternalStore(() => () => {}, loadHistoryText, () => null);
}

export default function StartScreen() {
  const router = useRouter();
  const historyText = useHistoryText();
  const history = useMemo(() => parseHistory(historyText), [historyText]);
  const [distanceText, setDistanceText] = useState(String(DEFAULT_RACE_SETTINGS.distanceM / 1000));
  const [minutes, setMinutes] = useState(String(Math.floor(DEFAULT_RACE_SETTINGS.paceSecPerKm / 60)));
  const [seconds, setSeconds] = useState(String(DEFAULT_RACE_SETTINGS.paceSecPerKm % 60).padStart(2, "0"));
  const [mainIntensity, setMainIntensity] = useState<Intensity>(DEFAULT_RACE_SETTINGS.intensity);

  const pace = useMemo(() => parsePaceInput(minutes, seconds), [minutes, seconds]);
  const distance = useMemo(() => parseDistanceInput(distanceText), [distanceText]);
  const distanceM = distance.ok ? distance.distanceM : DEFAULT_RACE_SETTINGS.distanceM;
  const intensity: Intensity = mainIntensity;

  const pool = useOpponentPool();
  const match = useMemo(
    () =>
      pace.ok && distance.ok
        ? matchForSettings(
            { source: "gps", distanceM, paceSecPerKm: pace.paceSecPerKm, intensity: "normal" },
            pool.records,
            history.runs?.[String(distanceM)], // 내 최고 기록 때의 달린 모양·고도(있으면 매칭에 쓴다)
          )
        : null,
    [pace, distance, distanceM, pool.records, history],
  );
  const opponent = match?.opponent ?? null;
  const rivalRecord = opponent ? formatRivalRecord(history.rivals[opponent.id]) : null;
  const bestPace = bestPaceSecPerKm(history, distanceM);

  // 코스 미리보기: 출발과 도착, 1km마다 거리 표시
  const previewMarkers: RouteMarker[] = [
    { fraction: 0, label: "출발", tone: "flag", side: "right" },
    ...Array.from({ length: Math.max(0, Math.ceil(distanceM / 1000) - 1) }, (_, k): RouteMarker => ({
      fraction: ((k + 1) * 1000) / distanceM,
      label: `${k + 1}km`,
      tone: "km",
      side: k % 2 === 0 ? "left" : "right",
    })),
    { fraction: 1, label: `도착 ${distanceM / 1000}km`, tone: "flag", side: "left" },
  ];

  const start = (source: RaceSource) => {
    if (!pace.ok || !distance.ok) return;
    router.push(freshRaceHref({ source, distanceM, paceSecPerKm: pace.paceSecPerKm, intensity, opponentId: opponent?.id }));
  };

  return (
    <main className="mx-auto flex h-dvh w-full max-w-md flex-col gap-3 overflow-hidden p-4">
      <header className="relative h-[26dvh] min-h-[150px] shrink-0 overflow-hidden rounded-3xl border border-white/10">
        <RouteMap variant="banner" distanceM={distanceM} label={`${distanceM / 1000}km 코스 미리보기`} markers={previewMarkers} />
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-5 pb-8 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/60">Running Rival</p>
          <h1 className="text-3xl font-bold leading-tight tracking-tight">러닝 라이벌</h1>
        </div>
      </header>

      <section aria-label="대결 설정" className="glass flex shrink-0 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white/70">거리</h2>
          <div className="flex items-center gap-2">
            <input
              aria-label="대결 거리(km)"
              inputMode="decimal"
              maxLength={4}
              value={distanceText}
              onChange={(event) => setDistanceText(event.target.value)}
              className="field !px-2 !py-1.5 !text-xl w-20"
            />
            <span className="whitespace-nowrap text-xs text-white/60">km (0.1 단위)</span>
          </div>
        </div>
        {!distance.ok && (
          <p role="alert" className="text-xs text-red-400">
            {distance.message}
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white/70">평소 페이스</h2>
            <p className="text-[11px] text-white/50">1km를 뛰는 데 걸리는 시간</p>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              aria-label="분"
              inputMode="numeric"
              maxLength={2}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              className="field !px-2 !py-1.5 !text-xl w-14"
            />
            <span className="text-sm text-white/70">:</span>
            <input
              aria-label="초"
              inputMode="numeric"
              maxLength={2}
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
              className="field !px-2 !py-1.5 !text-xl w-14"
            />
            <span className="w-14 text-xs text-white/60">/ 1km</span>
          </div>
        </div>
        {pace.ok && distance.ok && (
          <p className="text-right text-[11px] text-white/50">
            {distance.distanceM / 1000}km를 뛰면 약 {formatPace(Math.round((pace.paceSecPerKm * distance.distanceM) / 1000))}
          </p>
        )}
        {!pace.ok && (
          <p role="alert" className="text-xs text-red-400">
            {pace.message}
          </p>
        )}
        {bestPace !== null && (
          <button
            type="button"
            onClick={() => {
              setMinutes(String(Math.floor(bestPace / 60)));
              setSeconds(String(bestPace % 60).padStart(2, "0"));
            }}
            className="-mt-1 self-end text-xs text-white/60 underline"
          >
            지난 최고 기록 페이스 불러오기 ({formatPace(bestPace)})
          </button>
        )}

        <div>
          <h2 className="text-sm font-semibold text-white/70">중계 양</h2>
          <p className="text-[11px] text-white/50">{INTENSITY_HELP[mainIntensity]}</p>
        </div>
        <div role="radiogroup" aria-label="중계 양" className="grid grid-cols-3 gap-2">
          {MAIN_INTENSITIES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mainIntensity === option}
              onClick={() => setMainIntensity(option)}
              className={choiceClass(mainIntensity === option)}
            >
              {INTENSITY_LABEL[option]}
            </button>
          ))}
        </div>
      </section>

      <section className="glass flex shrink-0 items-center justify-between gap-3 px-4 py-3" aria-label="매칭된 상대">
        {opponent ? (
          <>
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-lg font-bold">
                <span className="truncate">{displayName(opponent.id)}</span>
                <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium">{OPPONENT_SOURCE_LABEL[opponent.source]}</span>
              </p>
              <p className="truncate text-xs text-white/60">
                {formatPace(averagePaceSecPerKm(opponent))} /km
                {match?.kind === "reversal" ? ` · 역전 ${match.forecast.count}번쯤 예상` : ""}
                {rivalRecord ? ` · 전적 ${rivalRecord}` : ""}
              </p>
            </div>
            <span className="shrink-0 text-xs text-white/50">매칭된 상대</span>
          </>
        ) : (
          <p className="text-sm text-white/60">{pace.ok && distance.ok ? "맞는 상대 기록이 없어요" : "거리와 페이스를 확인해 주세요"}</p>
        )}
      </section>

      <div className="mt-auto flex shrink-0 flex-col gap-2">
        <button
          type="button"
          onClick={() => start("gps")}
          disabled={!pace.ok || !distance.ok || !opponent}
          className="btn-primary"
        >
          대결 시작
        </button>
      </div>
    </main>
  );
}
