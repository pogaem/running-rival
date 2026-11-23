"use client";
// 시작 화면 (PLAN.md 작업 12, DESIGN.md 1.1)
// 대결 거리, 평소 페이스, 중계 강도를 정하고 레이스 화면으로 보낸다.
// 매칭된 상대 칸은 지금은 "페이스가 가장 가까운 기록"을 임시로 보여 준다. 역전 예측 매칭은 작업 13에서 만든다.
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { INTENSITY_LABEL, type Intensity } from "@/lib/output/voice-policy";
import {
  averagePaceSecPerKm,
  DEFAULT_RACE_SETTINGS,
  formatPace,
  parsePaceInput,
  pickInterimOpponent,
  RACE_DISTANCES_M,
  settingsToQuery,
  type RaceDistanceM,
} from "@/lib/race-settings";
import { getOpponentRecords } from "@/lib/runners";

/** 화면에서 고르는 중계 강도 (끄기는 실험용이라 따로 둔다) */
const MAIN_INTENSITIES: Intensity[] = ["minimal", "normal", "active"];

const OPPONENT_SOURCE_LABEL = { virtual: "가상 러너", camp: "캠프 참가자", mine: "내 기록" } as const;

function choiceClass(selected: boolean) {
  return `rounded-lg border px-3 py-2 text-sm font-medium ${
    selected ? "border-foreground bg-foreground text-background" : "border-foreground/30"
  }`;
}

export default function StartScreen() {
  const router = useRouter();
  const [distanceM, setDistanceM] = useState<RaceDistanceM>(DEFAULT_RACE_SETTINGS.distanceM);
  const [minutes, setMinutes] = useState(String(Math.floor(DEFAULT_RACE_SETTINGS.paceSecPerKm / 60)));
  const [seconds, setSeconds] = useState(String(DEFAULT_RACE_SETTINGS.paceSecPerKm % 60).padStart(2, "0"));
  const [mainIntensity, setMainIntensity] = useState<Intensity>(DEFAULT_RACE_SETTINGS.intensity);
  const [muted, setMuted] = useState(false); // 실험용 중계 끄기

  const pace = useMemo(() => parsePaceInput(minutes, seconds), [minutes, seconds]);
  const intensity: Intensity = muted ? "off" : mainIntensity;

  const opponent = useMemo(
    () => (pace.ok ? pickInterimOpponent(getOpponentRecords(), pace.paceSecPerKm, distanceM) : null),
    [pace, distanceM],
  );

  const start = () => {
    if (!pace.ok) return;
    router.push(`/race?${settingsToQuery({ distanceM, paceSecPerKm: pace.paceSecPerKm, intensity })}`);
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
          <div role="radiogroup" aria-label="대결 거리" className="grid grid-cols-2 gap-2">
            {RACE_DISTANCES_M.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={distanceM === option}
                onClick={() => setDistanceM(option)}
                className={choiceClass(distanceM === option)}
              >
                {option / 1000}km
              </button>
            ))}
          </div>
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
            disabled
            className="rounded-lg border border-dashed border-foreground/30 px-3 py-2 text-sm text-foreground/40"
          >
            지난 기록 불러오기 (저장된 기록이 아직 없어요)
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
            최소는 추월·결승만, 일반은 1km 통과·마지막 200m·접전까지, 적극은 추월 예측과 승률 변화까지 말합니다.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={muted} onChange={(event) => setMuted(event.target.checked)} />
            <span>
              실험용 <b>중계 끄기</b> <span className="text-foreground/60">(음성·효과음·진동 없이 기록만)</span>
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-1 rounded-lg border border-foreground/30 p-3" aria-label="매칭된 상대">
          <h2 className="text-sm font-semibold">매칭된 상대</h2>
          {opponent ? (
            <>
              <p className="text-sm">
                {opponent.id} <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs">{OPPONENT_SOURCE_LABEL[opponent.source]}</span>
              </p>
              <p className="text-xs text-foreground/60">
                평균 페이스 {formatPace(averagePaceSecPerKm(opponent))} /km · 임시 매칭: 페이스가 가장 가까운 기록입니다 (역전이
                일어날 상대를 고르는 매칭은 아직 만들지 않았어요)
              </p>
            </>
          ) : (
            <p className="text-sm text-foreground/60">{pace.ok ? "맞는 상대 기록이 없어요" : "페이스를 올바르게 적으면 상대가 보여요"}</p>
          )}
        </div>
      </section>

      <p className="text-xs text-foreground/60">이어폰의 외부 소리 듣기 모드를 켜고 뛰는 것을 권장합니다.</p>

      <button
        type="button"
        onClick={start}
        disabled={!pace.ok || !opponent}
        className="mt-auto rounded-lg bg-foreground px-4 py-3 text-center font-semibold text-background disabled:opacity-40"
      >
        대결 시작
      </button>
    </main>
  );
}
