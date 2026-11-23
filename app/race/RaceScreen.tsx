"use client";
// 레이스 화면 (PLAN.md 작업 8·9, DESIGN.md 1.2)
// 데모 경로(나)와 가상러너-03의 5km 레이스를 10배속으로 재생하면서, 엔진이 판단한 결과를 화면과 소리로 전한다.
// 시작 화면(작업 12)과 매칭(작업 13), 실제 GPS(작업 14)가 생기기 전이라 지금은 고정된 데모 한 판이다.
// 중계 강도 선택은 원래 시작 화면(작업 12)에 들어갈 것인데, 거기가 생기기 전까지 이 화면에 임시로 둔다.
// 브라우저는 사용자가 버튼을 누르기 전에는 소리를 막는다. 그래서 "소리 켜고 시작" 버튼을 누르면 레이스가 시작된다.
// 음성과 효과음(작업 9·10)이 이 화면의 이벤트에 붙어 있다. 진동은 쓰지 않기로 했다.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Prediction } from "@/lib/engine/catchup";
import type { RaceEvent, RaceTick } from "@/lib/engine/race-engine";
import { createRaceEngine } from "@/lib/engine/race-engine";
import { displayPercent, WIN_STAGE_LABEL } from "@/lib/engine/winprob";
import { distanceBetweenM } from "@/lib/geo";
import { createDemoInput, DEMO_SPEED } from "@/lib/input/demo-input";
import { createBrowserGpsEnv, createGpsInput } from "@/lib/input/gps-input";
import { createPositionFilter } from "@/lib/input/gps-filter";
import type { InputError, PositionInput } from "@/lib/input/types";
import { makeStraightTrack } from "@/lib/input/synthetic-track";
import { matchForSettings, settingsFromQuery, settingsToQuery } from "@/lib/race-settings";
import { useSearchParams } from "next/navigation";
import type { PositionSample } from "@/lib/input/types";
import { createBrowserSfxEnv, createSfx, type Sfx } from "@/lib/output/sfx";
import { createPhraseBook, type PhraseBook } from "@/lib/output/phrases";
import { createBrowserSpeakerEnv, createSpeaker, type Speaker } from "@/lib/output/speaker";
import {
  applyVoiceResult,
  displayText,
  formatGap,
  formatPrediction,
  formatRaceClock,
  makeLogEntry,
  makePredictionLogEntry,
  prependLog,
  type LogEntry,
  type SubtitleTone,
  type VoiceStatus,
} from "@/lib/output/subtitles";
import {
  createVoicePolicy,
  DEFAULT_INTENSITY,
  INTENSITY_LABEL,
  type Intensity,
  type VoicePolicy,
} from "@/lib/output/voice-policy";

/** 격차 막대가 한쪽으로 보여 주는 최대 격차(미터). 이보다 벌어지면 막대 끝에 붙는다 */
const GAP_BAR_RANGE_M = 50;

/** 판정부터 음성 시작까지 허용되는 시간(밀리초). PRD 성공 기준: 3초 이내 */
const VOICE_DELAY_LIMIT_MS = 3000;

/** 화면에 보여 줄 중계 강도 선택지 */
const INTENSITY_OPTIONS: Intensity[] = ["off", "minimal", "normal", "active"];

/** 자막 색 */
const TONE_CLASS: Record<SubtitleTone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  bad: "text-rose-600 dark:text-rose-400",
  neutral: "text-foreground",
};

/** 지금 시각(밀리초). 화면을 그리는 동안이 아니라 이벤트가 들어올 때만 부른다 */
const nowMs = () => performance.now();

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

/** 이 기기가 음성 읽기와 "다른 소리 낮추기(오디오 세션)"를 지원하는지 */
function useVoiceSupport(): { speech: boolean; audioSession: boolean } {
  const speech = useSyncExternalStore(
    () => () => {},
    () => "speechSynthesis" in window,
    () => false,
  );
  const audioSession = useSyncExternalStore(
    () => () => {},
    () => "audioSession" in navigator,
    () => false,
  );
  return { speech, audioSession };
}

type WakeStatus = "waiting" | "on" | "off" | "denied";

/** 로그 한 줄의 음성 상태를 한 줄 글로 */
function voiceLine(voice: VoiceStatus): string {
  switch (voice.state) {
    case "pending":
      return "음성 읽는 중…";
    case "started":
      return `음성 시작까지 ${Math.round(voice.delayMs)}ms${voice.delayMs > VOICE_DELAY_LIMIT_MS ? " ⚠ 3초 초과" : ""}${
        voice.ducked ? " · 다른 소리 낮춤" : voice.beeped ? " · 알림음" : ""
      }`;
    case "failed":
      return `음성 실패: ${voice.message}`;
    case "skipped":
      return {
        off: "음성 없음 (중계 끄기)",
        intensity: "자막만 (이 강도에서는 말하지 않음)",
        gap: "자막만 (직전 멘트와 간격이 짧음)",
        unsupported: "자막만 (이 기기는 음성을 지원하지 않음)",
      }[voice.reason];
  }
}

export default function RaceScreen() {
  const [phase, setPhase] = useState<"ready" | "running">("ready");
  const searchParams = useSearchParams();
  const settings = useMemo(() => settingsFromQuery((key) => searchParams.get(key)), [searchParams]);
  const opponent = useMemo(() => matchForSettings(settings)?.opponent ?? null, [settings]);
  const raceDistanceM = settings.distanceM;
  const [intensity, setIntensity] = useState<Intensity>(settings.intensity);
  const [tick, setTick] = useState<RaceTick | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(true);
  // 실제 GPS일 때: 마지막 위치 정확도(m)와 위치 오류
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<InputError | null>(null);
  const [gpsRejected, setGpsRejected] = useState(0); // 보정에서 걸러 낸 점의 수
  const [wake, setWake] = useState<WakeStatus>("waiting");
  const wakeSupported = useWakeLockSupported();
  const voiceSupport = useVoiceSupport();

  const nextLogId = useRef(1);
  const latestTick = useRef<RaceTick | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  const policyRef = useRef<VoicePolicy | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const intensityRef = useRef<Intensity>(DEFAULT_INTENSITY);
  const bookRef = useRef<PhraseBook | null>(null);

  /** 이벤트와 예측을 자막으로 올리고, 말하기로 정해진 것은 소리로 읽는다 */
  const outputMoments = useCallback((events: RaceEvent[], prediction: Prediction | null, t: number, decidedAtMs: number) => {
    const policy = policyRef.current;
    const book = bookRef.current;
    const speaker = speakerRef.current;
    if (!policy || !book) return;

    const entries: LogEntry[] = [];
    const speak = (id: number, text: string, priority: boolean) => {
      void speaker?.speak(text, { priority }).then((result) => {
        setLog((current) => applyVoiceResult(current, id, result));
      });
    };

    for (const event of events) {
      const id = nextLogId.current++;
      const decision = policy.decideEvent(event);
      // 효과음(함성·심장 박동)도 음성 간격과 상관없이 이벤트에 맞춰 바로 낸다
      sfxRef.current?.handleEvent(event, intensityRef.current);
      if (decision.speak && speaker?.supported) {
        const text = book.forEvent(event);
        entries.push(makeLogEntry(id, event, decidedAtMs, nowMs(), { state: "pending", text }));
        speak(id, text, decision.priority);
      } else {
        const voice: VoiceStatus = {
          state: "skipped",
          reason: decision.speak ? "unsupported" : decision.reason,
        };
        entries.push(makeLogEntry(id, event, decidedAtMs, nowMs(), voice));
      }
    }

    // 추월 예측은 적극에서만 말하고, 말한 것만 자막 로그에 남긴다 (화면의 "지금 예상" 줄은 따로 늘 보인다)
    const predictionDecision = policy.decidePrediction(t, prediction);
    if (predictionDecision.speak && prediction && speaker?.supported) {
      const id = nextLogId.current++;
      const text = book.forPrediction(prediction);
      entries.push(makePredictionLogEntry(id, t, text, decidedAtMs, nowMs(), { state: "pending", text }));
      speak(id, text, false);
    }

    if (entries.length > 0) setLog((current) => prependLog(current, entries));
  }, []);

  // 중계 강도를 바꾸면 정책에도 바로 알린다
  useEffect(() => {
    policyRef.current?.setIntensity(intensity);
    intensityRef.current = intensity;
  }, [intensity]);

  // 데모 레이스 재생: 입력 → 엔진 → 화면과 소리. "소리 켜고 시작"을 누르면 시작한다
  useEffect(() => {
    if (phase !== "running") return;
    if (!opponent) return;
    const engine = createRaceEngine({ opponent, raceDistanceM });
    // 데모: 입력한 평소 페이스로 일정하게 달리는 "만든 경로"를 10배속으로 재생한다.
    // GPS: 폰의 실제 위치를 받는다. 둘 다 같은 모양(PositionInput)이라 아래는 똑같이 동작한다
    const input: PositionInput =
      settings.source === "gps"
        ? createGpsInput(createBrowserGpsEnv())
        : createDemoInput(makeStraightTrack({ paceSecPerKm: settings.paceSecPerKm, distanceM: raceDistanceM }));
    let previous: PositionSample | null = null;
    let traveled = 0; // 누적 거리. 실제 GPS는 보정(정확도 나쁜 점·순간 이동 제거, 이동 평균)을 거친 점만 더한다
    const filter = settings.source === "gps" ? createPositionFilter() : null; // 데모 경로는 깨끗해서 보정이 필요 없다

    input.start({
      onSample: (rawSample) => {
        let sample = rawSample;
        if (filter) {
          const filtered = filter.push(rawSample);
          setGpsAccuracyM(rawSample.accuracyM);
          setGpsRejected(filter.rejected.accuracy + filter.rejected.speed);
          if (!filtered.accepted) return; // 버린 점은 거리에도 엔진에도 넣지 않는다
          sample = filtered.sample;
        }
        if (previous) traveled += distanceBetweenM(previous, sample);
        previous = sample;

        const decidedAtMs = nowMs();
        const result = engine.update(sample.t, traveled);
        latestTick.current = result;
        setTick(result);
        outputMoments(result.events, result.prediction, sample.t, decidedAtMs);
        if (settings.source === "gps") {
          setGpsError(null);
          if (result.finished) {
            input.stop(); // 결승선을 지나면 위치 추적을 끈다
            setRunning(false);
          }
        }
      },
      onEnd: () => setRunning(false),
      onError: (error) => setGpsError(error),
    });

    return () => {
      input.stop();
      speakerRef.current?.cancel();
      sfxRef.current?.stopAll();
    };
  }, [phase, outputMoments, opponent, raceDistanceM, settings.paceSecPerKm, settings.source]);

  // 화면 꺼짐 방지: 레이스가 시작된 뒤 지원되는 기기에서만. 화면이 가려졌다 돌아오면 다시 건다
  useEffect(() => {
    if (phase !== "running" || !wakeSupported) return;
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
  }, [phase, wakeSupported]);

  /** "소리 켜고 시작": 소리 잠금을 풀고(사용자가 누른 때만 가능), 멘트 도구를 준비하고, 레이스를 시작한다 */
  const startRace = () => {
    const speaker = createSpeaker(createBrowserSpeakerEnv());
    speaker.unlock();
    speakerRef.current = speaker;
    policyRef.current = createVoicePolicy({ intensity });
    intensityRef.current = intensity;
    const sfx = createSfx(createBrowserSfxEnv());
    void sfx.preload(); // 버튼을 누른 직후에 불러 두면 첫 효과음 전에 준비된다
    sfxRef.current = sfx;
    bookRef.current = createPhraseBook();
    setPhase("running");
  };

  // 개발 중에만 쓰는 이벤트 테스트 버튼: 2분을 기다리지 않고 자막과 음성이 나오는 모습을 바로 본다
  const pushTestEvent = (type: "overtake" | "overtaken" | "last200m") => {
    const t = latestTick.current?.t ?? 0;
    const event: RaceEvent =
      type === "last200m" ? { type, t } : { type, t, gapM: type === "overtake" ? 12 : -12 };
    outputMoments([event], null, t, nowMs());
  };

  const sourceLabel = settings.source === "gps" ? "실제 GPS" : `데모 · ${DEMO_SPEED}배속`;
  const demoUrl = `/race?${settingsToQuery({ ...settings, source: "demo" })}`;

  const myDistance = tick?.snapshot.myDistanceM ?? 0;
  const gap = tick?.snapshot.gapM ?? 0;
  const gapPosition = 50 + (Math.max(-GAP_BAR_RANGE_M, Math.min(GAP_BAR_RANGE_M, gap)) / GAP_BAR_RANGE_M) * 50;
  const predictionText = formatPrediction(tick?.prediction ?? null);
  const percent = tick?.estimate ? displayPercent(tick.estimate.probability) : null;
  const finished = tick?.finished ?? false;

  const intensitySelector = (
    <div role="radiogroup" aria-label="중계 강도" className="grid grid-cols-4 gap-2">
      {INTENSITY_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={intensity === option}
          onClick={() => setIntensity(option)}
          className={`rounded-md border px-2 py-2 text-xs ${
            intensity === option ? "border-foreground bg-foreground text-background" : "border-foreground/30"
          }`}
        >
          {INTENSITY_LABEL[option]}
        </button>
      ))}
    </div>
  );

  if (phase === "ready") {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
        <header className="pt-4">
          <h1 className="text-2xl font-bold">레이스</h1>
          <p className="mt-1 text-sm text-foreground/70">
            {sourceLabel} · {opponent?.id ?? "상대 없음"}({opponent?.source === "virtual" ? "가상 러너" : "기록"}) · {raceDistanceM / 1000}km · 내 페이스 {formatPace(settings.paceSecPerKm)}/km
          </p>
        </header>

        <section aria-label="준비" className="flex flex-col gap-3 rounded-lg border border-foreground/30 p-3">
          <h2 className="text-sm font-semibold">중계 강도: {INTENSITY_LABEL[intensity]}</h2>
          <p className="text-xs text-foreground/60">
            시작 화면에서 정한 강도입니다. 최소는 추월·결승만, 일반은 1km 통과·마지막 200m·접전까지, 적극은 추월 예측과 승률 변화까지 말합니다.
          </p>
        </section>

        {settings.source === "gps" && (
          <section aria-label="위치 안내" className="flex flex-col gap-1 rounded-lg border border-foreground/30 p-3 text-sm">
            <h2 className="font-semibold">위치 권한이 필요해요</h2>
            <p>시작을 누르면 브라우저가 위치 사용을 물어봐요. <b>허용</b>해야 내가 달린 거리를 잴 수 있어요.</p>
            <p className="text-xs text-foreground/60">
              위치 좌표는 이 기기 안에서 거리를 재는 데만 쓰고, 저장하거나 서버로 보내지 않아요. 하늘이 트인 야외에서 정확해요.
            </p>
            <Link className="text-xs underline" href={demoUrl}>
              실제로 뛰지 않고 데모로 체험하기
            </Link>
          </section>
        )}

        <section aria-label="소리 안내" className="flex flex-col gap-1 rounded-lg border border-foreground/30 p-3 text-sm">
          <p>이어폰을 끼고, 음악을 듣는다면 틀어 두세요. 이어폰의 외부 소리 듣기 모드를 켜고 뛰는 것을 권장합니다.</p>
          <p className="text-xs text-foreground/60">
            음성 중계: {voiceSupport.speech ? "이 기기에서 지원됩니다" : "이 기기에서는 지원되지 않습니다 (자막만 나옵니다)"}
          </p>
          <p className="text-xs text-foreground/60">
            효과음: 추월·승리 때 관중 함성, 격차 10m 이내일 때 심장 박동이 깔립니다. 음원 출처는 아래 &quot;음원 출처&quot;를 참고하세요.
          </p>
<p className="text-xs text-foreground/60">
            음악 위에서 들리게 하기:{" "}
            {voiceSupport.audioSession
              ? "멘트 동안 다른 소리를 낮춥니다"
              : "다른 소리를 낮출 수 없는 기기라서 멘트 앞에 짧은 알림음을 넣습니다"}
          </p>
        </section>

        <section aria-label="음원 출처" className="flex flex-col gap-1 rounded-lg border border-foreground/30 p-3 text-xs text-foreground/60">
          <h2 className="text-sm font-semibold text-foreground">음원 출처</h2>
          <p>
            관중 함성: Gregor Quendel, &quot;Free Crowd Cheering Sounds&quot; (CC BY 4.0) ·{" "}
            <a className="underline" href="https://opengameart.org/content/free-crowd-cheering-sounds" target="_blank" rel="noreferrer">
              OpenGameArt
            </a>
          </p>
          <p>
            심장 박동: bart, &quot;heartbeat sounds&quot; (CC0) ·{" "}
            <a className="underline" href="https://opengameart.org/content/heartbeat-sounds" target="_blank" rel="noreferrer">
              OpenGameArt
            </a>
          </p>
        </section>

        <div className="mt-auto flex gap-3">
          <Link href="/" className="flex-1 rounded-lg border border-foreground/30 px-4 py-3 text-center">
            돌아가기
          </Link>
          <button
            type="button"
            onClick={startRace}
            className="flex-1 rounded-lg bg-foreground px-4 py-3 text-center font-semibold text-background"
          >
            소리 켜고 시작
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <header className="pt-4">
        <h1 className="text-2xl font-bold">레이스</h1>
        <p className="mt-1 text-sm text-foreground/70">
          {sourceLabel} · {opponent?.id ?? "상대 없음"}({opponent?.source === "virtual" ? "가상 러너" : "기록"}) · {raceDistanceM / 1000}km · 내 페이스 {formatPace(settings.paceSecPerKm)}/km
        </p>
      </header>

      {settings.source === "gps" && (
        <section aria-label="위치 상태" className="flex flex-col gap-1 rounded-lg border border-foreground/30 p-3 text-sm">
          {gpsError ? (
            <>
              <p role="alert" className="text-red-600 dark:text-red-400">
                {gpsError.message}
              </p>
              <Link className="underline" href={demoUrl}>
                데모 모드로 체험하기
              </Link>
            </>
          ) : gpsAccuracyM === null ? (
            <p className="text-foreground/70">위치 신호를 기다리는 중…</p>
          ) : (
            <p className="text-foreground/70">
              위치 정확도 약 ±{Math.round(gpsAccuracyM)}m
              {gpsRejected > 0 ? ` · 튀는 위치 ${gpsRejected}개는 걸러 냈어요` : ""}
            </p>
          )}
        </section>
      )}

      <section aria-label="진행 상황" className="flex items-end justify-between">
        <p className="text-3xl font-bold tabular-nums">
          {(myDistance / 1000).toFixed(2)}
          <span className="text-base font-normal text-foreground/70"> km / {raceDistanceM / 1000} km</span>
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

      <section aria-label="중계 강도" className="rounded-lg border border-foreground/30 p-3">
        <h2 className="mb-2 text-sm font-semibold">중계 강도</h2>
        {intensitySelector}
      </section>

      <section aria-label="중계 자막" className="flex min-h-0 flex-1 flex-col rounded-lg border border-foreground/30 p-3">
        <h2 className="text-sm font-semibold">중계 자막</h2>
        <ol aria-live="polite" className="mt-2 flex max-h-56 flex-col gap-2 overflow-y-auto">
          {log.length === 0 && <li className="text-sm text-foreground/60">경기가 시작되면 여기에 쌓입니다</li>}
          {log.map((entry) => (
            <li key={entry.id} className="text-sm">
              <p className={TONE_CLASS[entry.tone]}>
                <span className="tabular-nums text-foreground/60">{formatRaceClock(entry.raceTimeSec)}</span>{" "}
                {displayText(entry)}
              </p>
              <p className="text-xs tabular-nums text-foreground/50">
                판정 {formatRaceClock(entry.raceTimeSec)} · 자막 {entry.delayMs.toFixed(1)}ms · {voiceLine(entry.voice)}
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
