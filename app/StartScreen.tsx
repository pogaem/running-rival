"use client";
// 시작 화면 (PLAN.md 작업 12, DESIGN.md 1.1)
// 대결 거리, 평소 페이스, 중계 강도를 정하고 레이스 화면으로 보낸다.
// 매칭된 상대 칸은 역전 예측 매칭(작업 13)의 결과를 보여 준다. 역전이 "예상"된다는 뜻이지 보장은 아니다.
import { useOpponentPool } from "./useOpponentPool";
import { displayName } from "@/lib/runner-names";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { bestPaceSecPerKm, formatRivalRecord, loadHistoryText, parseHistory } from "@/lib/history";
import { INTENSITY_LABEL, type Intensity } from "@/lib/output/voice-policy";
import {
  averagePaceSecPerKm,
  DEFAULT_RACE_SETTINGS,
  formatPace,
  parsePaceInput,
  parseDistanceInput,
  matchForSettings,
  settingsToQuery,
  type RaceSource,
} from "@/lib/race-settings";

/** 화면에서 고르는 중계 강도 (끄기는 실험용이라 따로 둔다) */
const MAIN_INTENSITIES: Intensity[] = ["minimal", "normal", "active"];

const OPPONENT_SOURCE_LABEL = { virtual: "가상 러너", camp: "캠프 참가자", mine: "내 기록", shared: "다른 러너 기록" } as const;

function choiceClass(selected: boolean) {
  return `rounded-lg border px-3 py-2 text-sm font-medium ${
    selected ? "border-foreground bg-foreground text-background" : "border-foreground/30"
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
  const [muted, setMuted] = useState(false); // 실험용 중계 끄기

  const pace = useMemo(() => parsePaceInput(minutes, seconds), [minutes, seconds]);
  const distance = useMemo(() => parseDistanceInput(distanceText), [distanceText]);
  const distanceM = distance.ok ? distance.distanceM : DEFAULT_RACE_SETTINGS.distanceM;
  const intensity: Intensity = muted ? "off" : mainIntensity;

  const pool = useOpponentPool();
  const match = useMemo(
    () =>
      pace.ok && distance.ok
        ? matchForSettings({ source: "gps", distanceM, paceSecPerKm: pace.paceSecPerKm, intensity: "normal" }, pool.records)
        : null,
    [pace, distance, distanceM, pool.records],
  );
  const opponent = match?.opponent ?? null;
  const rivalRecord = opponent ? formatRivalRecord(history.rivals[opponent.id]) : null;
  const bestPace = bestPaceSecPerKm(history, distanceM);

  const start = (source: RaceSource) => {
    if (!pace.ok || !distance.ok) return;
    router.push(`/race?${settingsToQuery({ source, distanceM, paceSecPerKm: pace.paceSecPerKm, intensity, opponentId: opponent?.id })}`);
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <header className="pt-4">
        <h1 className="text-2xl font-bold">러닝 라이벌</h1>
        <p className="mt-1 text-sm text-foreground/70">역전이 일어날 상대를 골라, 경기를 중계해 드립니다.</p>
      </header>

      <section aria-label="대결 설정" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">대결 거리</h2>
          <div className="flex items-center gap-2">
            <input
              aria-label="대결 거리(km)"
              inputMode="decimal"
              maxLength={4}
              value={distanceText}
              onChange={(event) => setDistanceText(event.target.value)}
              className="w-24 rounded-lg border border-foreground/30 bg-transparent px-3 py-2 text-center text-lg tabular-nums"
            />
            <span className="text-sm">km (0.5 단위)</span>
          </div>
          {!distance.ok && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {distance.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">평소 페이스</h2>
          <div className="flex items-center gap-2">
            <input
              aria-label="분"
              inputMode="numeric"
              maxLength={2}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              className="w-16 rounded-lg border border-foreground/30 bg-transparent px-3 py-2 text-center text-lg tabular-nums"
            />
            <span className="text-sm">분</span>
            <input
              aria-label="초"
              inputMode="numeric"
              maxLength={2}
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
              className="w-16 rounded-lg border border-foreground/30 bg-transparent px-3 py-2 text-center text-lg tabular-nums"
            />
            <span className="text-sm">초 /km</span>
          </div>
          {!pace.ok && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {pace.message}
            </p>
          )}
          <button
            type="button"
            disabled={bestPace === null}
            onClick={() => {
              if (bestPace === null) return;
              setMinutes(String(Math.floor(bestPace / 60)));
              setSeconds(String(bestPace % 60).padStart(2, "0"));
            }}
            className="rounded-lg border border-dashed border-foreground/30 px-3 py-2 text-sm disabled:text-foreground/40"
          >
            {bestPace === null
              ? "지난 기록 불러오기 (이 거리의 저장된 기록이 아직 없어요)"
              : `지난 최고 기록 페이스 불러오기 (${formatPace(bestPace)} /km)`}
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">중계 강도</h2>
          <div role="radiogroup" aria-label="중계 강도" className="grid grid-cols-3 gap-2">
            {MAIN_INTENSITIES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={!muted && mainIntensity === option}
                onClick={() => {
                  setMainIntensity(option);
                  setMuted(false);
                }}
                className={choiceClass(!muted && mainIntensity === option)}
              >
                {INTENSITY_LABEL[option]}
              </button>
            ))}
          </div>
          <p className="text-xs text-foreground/60">
            최소는 추월·결승만, 일반은 출발·15초마다 중간 상황(앞서든 뒤처지든)·절반·마지막 200m·접전까지, 적극은 추월 예측과 승률 변화까지 말합니다.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={muted} onChange={(event) => setMuted(event.target.checked)} />
            <span>
              실험용 <b>중계 끄기</b> <span className="text-foreground/60">(음성·효과음 없이 기록만)</span>
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-1 rounded-lg border border-foreground/30 p-3" aria-label="매칭된 상대">
          <h2 className="text-sm font-semibold">매칭된 상대</h2>
          {opponent ? (
            <>
              <p className="text-sm">
                {displayName(opponent.id)} <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs">{OPPONENT_SOURCE_LABEL[opponent.source]}</span>
              </p>
              <p className="text-xs text-foreground/60">
                평균 페이스 {formatPace(averagePaceSecPerKm(opponent))} /km
                {match?.kind === "reversal"
                  ? ` · 이 대결에서 역전이 ${match.forecast.count}번쯤 예상돼요`
                  : ""}
              </p>
              {rivalRecord && <p className="text-sm">라이벌 전적 {rivalRecord}</p>}
              <p className="text-xs text-foreground/60">
                {pool.ready ? `다른 러너가 공유한 기록 ${pool.sharedCount}개가 후보에 들어 있어요` : "공유 기록을 불러오는 중…"}
              </p>
              {match?.kind === "closest" && (
                <p className="text-xs text-foreground/60">조건에 맞는 상대가 없어 가장 가까운 기록으로 매칭했어요</p>
              )}
            </>
          ) : (
            <p className="text-sm text-foreground/60">{pace.ok && distance.ok ? "맞는 상대 기록이 없어요" : "거리와 페이스를 올바르게 적으면 상대가 보여요"}</p>
          )}
        </div>
      </section>

      <p className="text-xs text-foreground/60">이어폰의 외부 소리 듣기 모드를 켜고 뛰는 것을 권장합니다.</p>

      <div className="mt-auto flex flex-col gap-2">
        <button
          type="button"
          onClick={() => start("gps")}
          disabled={!pace.ok || !distance.ok || !opponent}
          className="rounded-lg bg-foreground px-4 py-3 text-center font-semibold text-background disabled:opacity-40"
        >
          대결 시작 (실제 GPS)
        </button>
        <button
          type="button"
          onClick={() => start("demo")}
          disabled={!pace.ok || !distance.ok || !opponent}
          className="rounded-lg border border-foreground/30 px-4 py-2 text-center text-sm disabled:opacity-40"
        >
          데모로 체험하기 (달리지 않고 10배속)
        </button>
      </div>
    </main>
  );
}
