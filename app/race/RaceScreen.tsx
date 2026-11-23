"use client";
// 레이스 화면 (PLAN.md 작업 8, DESIGN.md 1.2)
// 데모 경로(나)와 가상러너-03의 5km 레이스를 10배속으로 재생하면서, 엔진이 판단한 결과를 화면에 보여 준다.
// 시작 화면(작업 12)과 매칭(작업 13), 실제 GPS(작업 14)가 생기기 전이라 지금은 고정된 데모 한 판이다.
// 음성·효과음·진동은 작업 9~11에서 이 화면의 이벤트에 붙인다. 지금은 자막만 있다.
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RaceEvent, RaceTick } from "@/lib/engine/race-engine";
import { createRaceEngine } from "@/lib/engine/race-engine";
import { displayPercent, WIN_STAGE_LABEL } from "@/lib/engine/winprob";
import { DEMO_RACE_DISTANCE_M, DEMO_RIVAL_ID, getDemoRaceSetup } from "@/lib/demo-race";
import { distanceBetweenM } from "@/lib/geo";
import { createDemoInput, DEMO_SPEED } from "@/lib/input/demo-input";
import { makeDemoTrack } from "@/lib/input/synthetic-track";
import type { PositionSample } from "@/lib/input/types";
import {
  formatGap,
  formatPrediction,
  formatRaceClock,
  makeLogEntry,
  prependLog,
  type LogEntry,
  type SubtitleTone,
} from "@/lib/output/subtitles";

/** 격차 막대가 한쪽으로 보여 주는 최대 격차(미터). 이보다 벌어지면 막대 끝에 붙는다 */
const GAP_BAR_RANGE_M = 50;

/** 지금 시각(밀리초). 화면을 그리는 동안이 아니라 이벤트가 들어올 때만 부른다 */
const nowMs = () => performance.now();

/** 자막 색 */
const TONE_CLASS: Record<SubtitleTone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  bad: "text-rose-600 dark:text-rose-400",
  neutral: "text-foreground",
};

/** 페이스(초/km)를 "m:ss"로 쓴다. 멈춰 있어서 계산할 수 없으면 "-" */
function formatPace(secPerKm: number): string {
  if (!Number.isFinite(secPerKm)) return "-";
  const whole = Math.round(secPerKm);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** 이 기기가 화면 꺼짐 방지(Screen Wake Lock)를 지원하는지. 서버에서는 알 수 없어 false로 두었다가 브라우저에서 바로잡는다 */
function useWakeLockSupported(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => "wakeLock" in navigator,
    () => false,
  );
}

type WakeStatus = "waiting" | "on" | "off" | "denied";

export default function RaceScreen() {
  const [tick, setTick] = useState<RaceTick | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(true);
  const [wake, setWake] = useState<WakeStatus>("waiting");
  const wakeSupported = useWakeLockSupported();
  const nextLogId = useRef(1);
  const latestTick = useRef<RaceTick | null>(null);

  // 데모 레이스 재생: 입력 → 엔진 → 화면
  useEffect(() => {
    const engine = createRaceEngine(getDemoRaceSetup());
    const input = createDemoInput(makeDemoTrack());
    let previous: PositionSample | null = null;
    let traveled = 0; // 누적 거리. GPS 보정은 작업 15에서 만든다(데모 경로는 깨끗해서 필요 없다)

    input.start({
      onSample: (sample) => {
        if (previous) traveled += distanceBetweenM(previous, sample);
        previous = sample;

        const decidedAtMs = nowMs();
        const result = engine.update(sample.t, traveled);
        latestTick.current = result;
        setTick(result);

        if (result.events.length > 0) {
          const outputAtMs = nowMs();
          const entries = result.events.map((event) =>
            makeLogEntry(nextLogId.current++, event, decidedAtMs, outputAtMs),
          );
          setLog((current) => prependLog(current, entries));
        }
      },
      onEnd: () => setRunning(false),
    });

    return () => input.stop();
  }, []);

  // 화면 꺼짐 방지: 지원되는 기기에서만. 화면이 가려졌다 돌아오면 다시 건다
  useEffect(() => {
    if (!wakeSupported) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = () => {
      navigator.wakeLock
        .request("screen")
        .then((lock) => {
          if (cancelled) {
            void lock.release();
            return;
          }
          sentinel = lock;
          setWake("on");
          lock.addEventListener("release", () => {
            if (!cancelled) setWake("off");
          });
        })
        .catch(() => {
          if (!cancelled) setWake("denied");
        });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!sentinel || sentinel.released)) acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release();
    };
  }, [wakeSupported]);

  // 개발 중에만 쓰는 이벤트 테스트 버튼: 2분을 기다리지 않고 자막이 나오는 모습을 바로 본다
  const pushTestEvent = (type: "overtake" | "overtaken" | "last200m") => {
    const t = latestTick.current?.t ?? 0;
    const event: RaceEvent =
      type === "last200m" ? { type, t } : { type, t, gapM: type === "overtake" ? 12 : -12 };
    const decidedAtMs = nowMs();
    const entry = makeLogEntry(nextLogId.current++, event, decidedAtMs, nowMs());
    setLog((current) => prependLog(current, [entry]));
  };

  const myDistance = tick?.snapshot.myDistanceM ?? 0;
  const gap = tick?.snapshot.gapM ?? 0;
  const gapPosition = 50 + (Math.max(-GAP_BAR_RANGE_M, Math.min(GAP_BAR_RANGE_M, gap)) / GAP_BAR_RANGE_M) * 50;
  const predictionText = formatPrediction(tick?.prediction ?? null);
  const percent = tick?.estimate ? displayPercent(tick.estimate.probability) : null;
  const finished = tick?.finished ?? false;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <header className="pt-4">
        <h1 className="text-2xl font-bold">레이스</h1>
        <p className="mt-1 text-sm text-foreground/70">
          데모 · {DEMO_SPEED}배속 · {DEMO_RIVAL_ID}(가상 러너) · {DEMO_RACE_DISTANCE_M / 1000}km
        </p>
      </header>

      <section aria-label="진행 상황" className="flex items-end justify-between">
        <p className="text-3xl font-bold tabular-nums">
          {(myDistance / 1000).toFixed(2)}
          <span className="text-base font-normal text-foreground/70"> km / {DEMO_RACE_DISTANCE_M / 1000} km</span>
        </p>
        <p className="text-3xl font-bold tabular-nums">{formatRaceClock(tick?.t ?? 0)}</p>
      </section>

      <section aria-label="나와 상대의 격차" className="rounded-lg border border-foreground/30 p-3">
        <div className="flex justify-between text-xs text-foreground/60">
          <span>◀ 상대가 앞</span>
          <span>내가 앞 ▶</span>
        </div>
        <div className="relative my-2 h-3 rounded-full bg-foreground/10" role="img" aria-label={`격차 ${formatGap(gap)}`}>
          <div className="absolute left-1/2 top-0 h-3 w-px bg-foreground/40" />
          <div
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
            style={{ left: `${gapPosition}%` }}
          />
        </div>
        <p className="text-sm font-semibold tabular-nums">
          {tick ? `${formatGap(gap)} ${gap >= 0 ? "내가 앞서는 중" : "상대가 앞서는 중"}` : "출발 준비 중"}
        </p>
      </section>

      <section aria-label="예상 승률" className="rounded-lg border border-foreground/30 p-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">예상 승률</h2>
          <p className="text-sm font-semibold tabular-nums">
            {percent === null ? "60초 뒤부터 계산" : `${percent}% · ${tick?.stage ? WIN_STAGE_LABEL[tick.stage] : ""}`}
          </p>
        </div>
        <div className="mt-2 h-2 rounded-full bg-foreground/10">
          <div className="h-2 rounded-full bg-foreground" style={{ width: `${percent ?? 0}%` }} />
        </div>
        <p className="mt-2 text-sm">
          {predictionText ??
            (tick && tick.t >= 60 ? "지금은 예상되는 추월이 없습니다" : "추월 예측은 60초 뒤부터 시작됩니다")}
        </p>
        {tick?.recentPace && (
          <p className="mt-1 text-xs text-foreground/60">
            최근 60초 페이스 {formatPace(tick.recentPace.paceSecPerKm)}/km
          </p>
        )}
      </section>

      <section aria-label="중계 자막" className="flex min-h-0 flex-1 flex-col rounded-lg border border-foreground/30 p-3">
        <h2 className="text-sm font-semibold">중계 자막</h2>
        <ol aria-live="polite" className="mt-2 flex max-h-56 flex-col gap-2 overflow-y-auto">
          {log.length === 0 && <li className="text-sm text-foreground/60">경기가 시작되면 여기에 쌓입니다</li>}
          {log.map((entry) => (
            <li key={entry.id} className="text-sm">
              <p className={TONE_CLASS[entry.tone]}>
                <span className="tabular-nums text-foreground/60">{formatRaceClock(entry.raceTimeSec)}</span> {entry.text}
              </p>
              <p className="text-xs tabular-nums text-foreground/50">
                판정 {formatRaceClock(entry.raceTimeSec)} · 자막 출력까지 {entry.delayMs.toFixed(1)}ms
              </p>
            </li>
          ))}
        </ol>
      </section>

      {process.env.NODE_ENV === "development" && (
        <section aria-label="이벤트 테스트 (개발 중에만 보임)" className="rounded-lg border border-dashed border-foreground/30 p-3">
          <h2 className="text-xs font-semibold text-foreground/60">이벤트 테스트 (개발 중에만 보임)</h2>
          <div className="mt-2 flex gap-2">
            {(
              [
                ["overtake", "추월"],
                ["overtaken", "추월당함"],
                ["last200m", "마지막 200m"],
              ] as const
            ).map(([type, label]) => (
              <button
                key={type}
                type="button"
                onClick={() => pushTestEvent(type)}
                className="flex-1 rounded-md border border-foreground/30 px-2 py-2 text-xs"
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-foreground/60" data-testid="wake-status">
        화면 꺼짐 방지:{" "}
        {!wakeSupported
          ? "이 기기에서는 지원되지 않습니다 (화면이 꺼질 수 있어요)"
          : wake === "on"
            ? "켜짐"
            : wake === "denied"
              ? "허용되지 않았습니다"
              : wake === "off"
                ? "꺼짐 (화면이 돌아오면 다시 켭니다)"
                : "켜는 중"}
      </p>

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
          {finished || !running ? "결과 보기" : "종료"}
        </Link>
      </div>
    </main>
  );
}
