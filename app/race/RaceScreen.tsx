"use client";
// 레이스 화면 (PLAN.md 작업 8·9, DESIGN.md 1.2)
// 데모 경로(나)와 가상러너-03의 5km 레이스를 10배속으로 재생하면서, 엔진이 판단한 결과를 화면과 소리로 전한다.
// 시작 화면(작업 12)과 매칭(작업 13), 실제 GPS(작업 14)가 생기기 전이라 지금은 고정된 데모 한 판이다.
// 중계 강도 선택은 원래 시작 화면(작업 12)에 들어갈 것인데, 거기가 생기기 전까지 이 화면에 임시로 둔다.
// 브라우저는 사용자가 버튼을 누르기 전에는 소리를 막는다. 그래서 "소리 켜고 시작" 버튼을 누르면 레이스가 시작된다.
// 음성과 효과음(작업 9·10)이 이 화면의 이벤트에 붙어 있다. 진동은 쓰지 않기로 했다.
import { displayName } from "@/lib/runner-names";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Prediction } from "@/lib/engine/catchup";
import type { RaceEvent, RaceTick } from "@/lib/engine/race-engine";
import RouteMap, { type RouteMarker } from "../RouteMap";
import { ACTIVE_STATUS_INTERVAL_M, CLOSE_ENTER_M, createRaceEngine, STATUS_INTERVAL_M } from "@/lib/engine/race-engine";
import { displayPercent } from "@/lib/engine/winprob";
import { distanceBetweenM } from "@/lib/geo";
import { createDemoInput, DEMO_SPEED } from "@/lib/input/demo-input";
import { createBrowserGpsEnv, createGpsInput } from "@/lib/input/gps-input";
import { createElevationTracker } from "@/lib/input/elevation";
import { appendGapPoint, buildRaceSummary, formatMargin, serializeSummary, SUMMARY_STORAGE_KEY, type GapPoint } from "@/lib/result";
import { createAutoPause } from "@/lib/input/auto-pause";
import { createAutoStart } from "@/lib/input/auto-start";
import { createPositionFilter } from "@/lib/input/gps-filter";
import type { InputError, PositionInput } from "@/lib/input/types";
import { makeNoisyTrack } from "@/lib/input/synthetic-track";
import { createTrackRecorder } from "@/lib/track-recorder";
import { useOpponentPool } from "../useOpponentPool";
import { createInterruptionTracker } from "@/lib/input/interruption";
import { detectDeviceEnv, ENV_LABEL, LOCATION_GUIDE, type DeviceEnv } from "@/lib/device";
import { loadHistoryText, parseHistory, recordRace, rivalryIntro, saveHistory } from "@/lib/storage/history";
import { freshRaceHref, matchForSettings, settingsFromQuery } from "@/lib/race-settings";
import { distanceAtTime } from "@/lib/record";
import {
  AUTO_START_ACCURACY_FACTOR,
  AUTO_START_COUNT,
  AUTO_START_MAX_ACCURACY_M,
  AUTO_START_MAX_SPEED_MPS,
  AUTO_START_MIN_SPEED_MPS,
  AUTO_START_WINDOW_SEC,
  SIGNAL_LOST_AFTER_SEC,
} from "@/lib/config";
import { useRouter, useSearchParams } from "next/navigation";
import type { PositionSample } from "@/lib/input/types";
import { createBrowserSfxEnv, createSfx, type Sfx } from "@/lib/output/sfx";
import { createPhraseBook, type PhraseBook } from "@/lib/output/phrases";
import { createBrowserSpeakerEnv, createSpeaker, type Speaker } from "@/lib/output/speaker";
import {
  applyVoiceResult,
  displayText,
  formatGap,
  formatEta,
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

/** 화면에 보여 줄 중계 강도 선택지 */
const INTENSITY_OPTIONS: Intensity[] = ["minimal", "normal", "active"];

/** 자막 색 */
const TONE_CLASS: Record<SubtitleTone, string> = {
  good: "text-emerald-400",
  bad: "text-rose-400",
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

/** 250m마다 찍은 점 끝에 결승선 지점(완주 거리, 결승 시각)을 붙인다. 공유할 때 "마지막 점이 완주 거리와 같아야" 해서 필요하다 */
function withFinishPoint(points: { t: number; d: number }[], finishT: number, distanceM: number): { t: number; d: number }[] {
  const last = points[points.length - 1];
  if (last && last.d >= distanceM) return points;
  const t = last && finishT > last.t ? finishT : (last?.t ?? 0) + 0.1;
  return [...points, { t: Math.round(t * 10) / 10, d: distanceM }];
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

/** 음성이 안 나온 자막에만 붙이는 짧은 설명. 정상으로 읽는 중이거나 읽은 것은 설명이 필요 없다 */
function voiceNote(voice: VoiceStatus): string | null {
  switch (voice.state) {
    case "failed":
      return null; // 기술적인 실패 이유는 보여 주지 않는다
    case "skipped":
      return {
        off: "음성 없음 (중계 끄기)",
        intensity: "자막만 (이 강도에서는 말하지 않음)",
        gap: "자막만 (직전 멘트와 간격이 짧음)",
        unsupported: "자막만 (이 기기는 음성을 지원하지 않음)",
      }[voice.reason];
    default:
      return null;
  }
}

/**
 * 주소(설정·n)가 바뀌면 레이스 화면을 통째로 새로 만든다.
 * 앱이 /race 화면을 되살려 쓰는 바람에, 다시 대결해도 지난 레이스 상태가 남아 "소리 켜고 시작" 없이 바로 달리던 문제를 막는다.
 */
export default function RaceScreen() {
  const searchParams = useSearchParams();
  return <RaceScreenInner key={searchParams.toString()} />;
}

function RaceScreenInner() {
  const [phase, setPhase] = useState<"ready" | "running">("ready");
  const router = useRouter();
  const searchParams = useSearchParams();
  const settings = useMemo(() => settingsFromQuery((key) => searchParams.get(key)), [searchParams]);
  const pool = useOpponentPool();
  // 시작 화면에서 정해 보낸 상대(o)를 우선 쓰고, 없으면 같은 설정으로 다시 매칭한다
  const opponent = useMemo(
    () =>
      (settings.opponentId ? pool.records.find((record) => record.id === settings.opponentId) : undefined) ??
      matchForSettings(settings, pool.records)?.opponent ??
      null,
    [settings, pool.records],
  );
  // 시작 화면에서 고른 상대가 그 사이 지워졌으면(공유 기록을 내린 경우 등) 다른 상대로 바뀐다. 말없이 바꾸지 않고 알린다
  const opponentSwapped =
    pool.ready && !!settings.opponentId && !!opponent && opponent.id !== settings.opponentId;
  const raceDistanceM = settings.distanceM;
  // 레이스 시간이 실제 시계보다 몇 배 빠른가. 중계 간격을 "실제로 듣는 시간" 기준으로 맞추는 데 쓴다
  const raceTimeScale = settings.source === "gps" ? 1 : DEMO_SPEED;
  const [intensity, setIntensity] = useState<Intensity>(settings.intensity);
  const [tick, setTick] = useState<RaceTick | null>(null);
  /** 결승선을 지난 뒤 보여 줄 최종 결과. 결승선에서는 두 러너 거리가 같아 격차로는 승패를 알 수 없다 */
  const [finalResult, setFinalResult] = useState<{ won: boolean; marginSec: number } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(true);
  // 실제 GPS일 때: 마지막 위치 정확도(m)와 위치 오류
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<InputError | null>(null);
  /** 위치 신호가 한동안 끊겼을 때: 상대는 계속 달리므로 상대 위치와 시계를 직접 이어 보여 준다 */
  const [signalLost, setSignalLost] = useState<{ t: number; rivalDistanceM: number } | null>(null);
  /** 준비 화면에서 확인하는 위치 권한 상태 */
  const [locPerm, setLocPerm] = useState<"checking" | "granted" | "denied" | "unavailable">("checking");
  /** 위치 켜는 방법 안내: 기본은 접속한 기기에 맞는 것, 직접 바꿔 볼 수도 있다 */
  const [guideEnv, setGuideEnv] = useState<DeviceEnv | null>(null);
  const detectedEnv = useSyncExternalStore(
    () => () => {},
    () => detectDeviceEnv(navigator.userAgent),
    () => "other" as DeviceEnv,
  );
  const activeGuide = guideEnv ?? detectedEnv;
  /** 위치 권한을 요청한다. 처음이면 브라우저가 허용 창을 띄운다 */
  const askLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      queueMicrotask(() => setLocPerm("unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => setLocPerm("granted"),
      (error) => setLocPerm(error.code === 1 ? "denied" : "granted"), // 신호가 약한 것은 권한 문제가 아니다
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }, []);
  const [, setGpsRejected] = useState(0); // 보정에서 걸러 낸 점의 수
  const [autoPaused, setAutoPaused] = useState(false); // 멈춘 것이 감지돼 레이스가 일시정지됐는가
  const [interrupted, setInterrupted] = useState(false); // 화면이 가려져 경기를 멈춘 중인가
  const [, setInterruptCount] = useState(0);
  // 실제 GPS: 뛰기 시작한 것을 감지할 때까지 기다리는 중인가 (데모는 바로 시작)
  const [waitingStart, setWaitingStart] = useState(settings.source === "gps");
  const [userPaused, setUserPaused] = useState(false); // 내가 직접 일시정지를 눌렀는가
  const [, setInterruptedSec] = useState(0); // 방해로 멈춘 시간(입력 시계 초)
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [, setWake] = useState<WakeStatus>("waiting");
  const wakeSupported = useWakeLockSupported();
  const voiceSupport = useVoiceSupport();

  const nextLogId = useRef(1);
  const latestTick = useRef<RaceTick | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  /** 지난 대결 한마디. 출발 중계 때 대신 말한다 */
  const introRef = useRef<string | null>(null);
  const speakingCount = useRef(0); // 지금 읽는 중인 멘트 수(효과음을 낮추는 동안)
  const policyRef = useRef<VoicePolicy | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const pauseControlRef = useRef<{ setPaused(paused: boolean): void; startNow(): void } | null>(null);
  const engineRef = useRef<ReturnType<typeof createRaceEngine> | null>(null);
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
      // 중계가 나가는 동안 효과음(심장 박동·함성)은 작게 낮춘다. 멘트가 겹치거나 끊겨도 마지막 멘트가 끝날 때만 되돌린다
      let counted = false;
      void speaker
        ?.speak(text, {
          priority,
          onEnd: () => {
            if (!counted) return;
            counted = false;
            speakingCount.current = Math.max(0, speakingCount.current - 1);
            if (speakingCount.current === 0) sfxRef.current?.setDucked(false);
          },
        })
        .then((result) => {
          if (result.status === "started") {
            counted = true;
            speakingCount.current += 1;
            sfxRef.current?.setDucked(true);
          }
          setLog((current) => applyVoiceResult(current, id, result));
        });
    };

    const hasStart = events.some((event) => event.type === "start");
    for (const event of events) {
      // 출발 순간에는 격차가 0이라 "접전"이 같이 나오는데, 그 자막·멘트가 출발(또는 재대결) 멘트를 덮지 않게 한다.
      // 심장 박동 효과음만 켠다
      if (hasStart && event.type === "closeEnter") {
        sfxRef.current?.handleEvent(event, intensityRef.current);
        continue;
      }
      const id = nextLogId.current++;
      const decision = policy.decideEvent(event);
      // 효과음(함성·심장 박동)도 음성 간격과 상관없이 이벤트에 맞춰 바로 낸다
      sfxRef.current?.handleEvent(event, intensityRef.current);
      const intro = event.type === "start" ? introRef.current : null;
      if (intro) introRef.current = null;
      if (decision.speak && speaker?.supported) {
        const text = intro ?? book.forEvent(event);
        const voice: VoiceStatus = { state: "pending", text };
        entries.push(intro ? makePredictionLogEntry(id, t, intro, decidedAtMs, nowMs(), voice) : makeLogEntry(id, event, decidedAtMs, nowMs(), voice));
        speak(id, text, decision.priority);
      } else if (intro) {
        entries.push(makePredictionLogEntry(id, t, intro, decidedAtMs, nowMs(), { state: "skipped", reason: decision.speak ? "unsupported" : decision.reason }));
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
      entries.push(makePredictionLogEntry(id, t, text, decidedAtMs, nowMs(), { state: "pending", text }, prediction.inSec));
      speak(id, text, false);
    }

    if (entries.length > 0) setLog((current) => prependLog(current, entries));
  }, []);

  // 중계 강도를 바꾸면 정책에도 바로 알린다
  useEffect(() => {
    policyRef.current?.setIntensity(intensity);
    intensityRef.current = intensity;
    engineRef.current?.setStatusIntervalM(intensity === "active" ? ACTIVE_STATUS_INTERVAL_M : STATUS_INTERVAL_M);
  }, [intensity]);

  // 데모 레이스 재생: 입력 → 엔진 → 화면과 소리. "소리 켜고 시작"을 누르면 시작한다
  useEffect(() => {
    if (phase !== "running") return;
    if (!opponent) return;
    const engine = createRaceEngine({ opponent, raceDistanceM });
    engineRef.current = engine;
    engine.setStatusIntervalM(intensityRef.current === "active" ? ACTIVE_STATUS_INTERVAL_M : STATUS_INTERVAL_M);
    // 데모: 입력한 평소 페이스로 달리는 "만든 경로"를 10배속으로 재생한다. 실제 GPS처럼 오차(흔들림·튀는 점·끊김)를 섞어서
    // 위치 보정과 자동 일시정지를 똑같이 거친다.
    // GPS: 폰의 실제 위치를 받는다. 둘 다 같은 모양(PositionInput)이라 아래는 똑같이 동작한다
    const input: PositionInput =
      settings.source === "gps"
        ? createGpsInput(createBrowserGpsEnv())
        : createDemoInput(makeNoisyTrack({ paceSecPerKm: settings.paceSecPerKm, distanceM: raceDistanceM }));
    let previous: PositionSample | null = null;
    let traveled = 0; // 누적 거리. 실제 GPS는 보정(정확도 나쁜 점·순간 이동 제거, 이동 평균)을 거친 점만 더한다
    let filter = createPositionFilter(); // 데모도 실제 GPS와 같은 보정을 거친다
    const autoPause = createAutoPause();
    let lastInterruptedSec = 0;
    let wasAutoPaused = false;
    // 멈췄다 돌아온 뒤 접전 상태였다면 심장 박동을 다시 켠다 (멈출 때 효과음을 모두 껐으므로)
    const restoreHeartbeat = () => {
      const last = latestTick.current;
      if (last && !last.finished && Math.abs(last.snapshot.gapM) <= CLOSE_ENTER_M) {
        sfxRef.current?.handleEvent({ type: "closeEnter", t: last.t, gapM: last.snapshot.gapM }, intensityRef.current);
      }
    };
    const elevation = createElevationTracker();
    const track = createTrackRecorder();
    // 전화·앱 전환으로 화면이 가려지면 경기를 멈추고, 돌아오면 이어간다 (레이스 시간·상대 기록도 같이 멈춤)
    const interruption = createInterruptionTracker();
    // 멈춤은 두 가지: 화면이 가려진 때, 내가 일시정지를 누른 때. 둘 중 하나라도 켜져 있으면 경기를 멈춘다
    let userPausedNow = false;
    let screenHides = 0;
    let wasScreenHidden = false;
    let isPaused = false;
    const sync = () => {
      const screenHidden = document.visibilityState === "hidden";
      if (screenHidden && !wasScreenHidden) screenHides += 1;
      wasScreenHidden = screenHidden;
      const wantPaused = userPausedNow || screenHidden;
      if (wantPaused && !isPaused) {
        if (input.pause) input.pause();
        else interruption.hide();
        speakerRef.current?.cancel();
        sfxRef.current?.stopAll();
      } else if (!wantPaused && isPaused) {
        if (input.resume) input.resume();
        else interruption.show();
        restoreHeartbeat();
      }
      isPaused = wantPaused;
      setInterrupted(screenHidden);
      setInterruptCount(screenHides);
    };
    const onVisibility = sync;
    // 달리기 자동 시작(폰의 GPS만 사용): 걷는 속도보다 빠른 움직임(초속 2m≈시속 7km 이상)이 3번 이어지면 그때부터 레이스를 시작한다
    const autoStart = settings.source === "gps";
    let raceStarted = !autoStart;
    let startOffsetSec = 0;
    let startNowRequested = false;
    const autoStartDetector = createAutoStart({
      maxAccuracyM: AUTO_START_MAX_ACCURACY_M,
      minSpeedMps: AUTO_START_MIN_SPEED_MPS,
      maxSpeedMps: AUTO_START_MAX_SPEED_MPS,
      windowSec: AUTO_START_WINDOW_SEC,
      count: AUTO_START_COUNT,
      accuracyFactor: AUTO_START_ACCURACY_FACTOR,
    });
    pauseControlRef.current = {
      startNow() {
        startNowRequested = true;
      },
      setPaused(paused) {
        userPausedNow = paused;
        setUserPaused(paused);
        sync();
      },
    };
    document.addEventListener("visibilitychange", onVisibility);
    const gapSeries: GapPoint[] = [];
    const allEvents: RaceEvent[] = [];
    let summarySaved = false;
    try {
      sessionStorage.removeItem(SUMMARY_STORAGE_KEY); // 지난 대결의 결과가 남아 있지 않게
    } catch {
      // 저장소를 못 쓰는 환경이면 결과 화면이 "결과 없음"으로 나온다
    }

    // 위치 신호가 4초 넘게 안 들어오면(터널·건물 사이) 상대는 계속 달리는 모습을 보여 준다.
    // 중계와 판정은 하지 않는다(내 위치를 모르는 채로 "추월당함"을 말하면 가짜일 수 있다). 신호가 돌아오면 그동안 달린 거리가 한꺼번에 반영된다
    let lastEngineT = 0;
    let lastEngineWallMs = nowMs();
    let engineFinished = false;
    const lostTimer =
      settings.source === "gps"
        ? setInterval(() => {
            if (!raceStarted || isPaused || wasAutoPaused || engineFinished) return;
            const sinceMs = nowMs() - lastEngineWallMs;
            if (sinceMs < SIGNAL_LOST_AFTER_SEC * 1000) return;
            const t = lastEngineT + sinceMs / 1000;
            setSignalLost({ t, rivalDistanceM: Math.min(distanceAtTime(opponent, t), raceDistanceM) });
          }, 1000)
        : null;

    input.start({
      onSample: (incoming) => {
        const gate = interruption.onSample(incoming.t);
        if (gate.skip) return; // 화면이 가려진 동안의 위치는 쓰지 않는다
        setInterruptedSec(gate.interruptedSec);
        // 멈춘 시간을 뺀 시계로 바꿔서 쓴다. 이하 필터·자동 일시정지·엔진은 이 시계를 본다
        if (!raceStarted) {
          const started = autoStartDetector.push(incoming);
          if (!started && !startNowRequested) return; // 아직 뛰지 않는 중: 거리도 시간도 세지 않는다
          raceStarted = true;
          startOffsetSec = incoming.t;
          setWaitingStart(false);
        }
        const rawSample: PositionSample = { ...incoming, t: incoming.t - gate.interruptedSec - startOffsetSec };
        // 멈췄다 돌아온 첫 점: 멈춘 시간은 레이스 시간에서 빠지므로, 그동안 움직인 거리도 세지 않는다.
        // 보정기와 기준점을 새로 시작해서, 돌아온 위치가 "순간 이동"으로 버려지거나 한꺼번에 더해지지 않게 한다
        if (gate.interruptedSec > lastInterruptedSec) {
          lastInterruptedSec = gate.interruptedSec;
          filter = createPositionFilter();
          previous = null;
        }
        const filtered = filter.push(rawSample);
        setGpsAccuracyM(rawSample.accuracyM);
        setGpsRejected(filter.rejected.accuracy + filter.rejected.speed);
        if (!filtered.accepted) return; // 버린 점은 거리에도 엔진에도 넣지 않는다
        const sample = filtered.sample;
        if (previous) traveled += distanceBetweenM(previous, sample);
        previous = sample;

        // 멈춘 동안은 레이스 시간이 흐르지 않는다: 상대 기록도 멈추고, 엔진을 돌리지 않으니 중계도 나가지 않는다
        const pause = autoPause.update(sample.t, traveled);
        setAutoPaused(pause.paused);
        if (pause.paused) {
          // 멈춘 동안은 음성과 효과음(심장 박동)도 멈춘다
          if (!wasAutoPaused) {
            speakerRef.current?.cancel();
            sfxRef.current?.stopAll();
          }
          wasAutoPaused = true;
          return;
        }
        if (wasAutoPaused) {
          wasAutoPaused = false;
          restoreHeartbeat();
        }
        const raceTimeSec = pause.raceTimeSec;

        elevation.update(sample.ele);
        track.add(raceTimeSec, traveled);
        const decidedAtMs = nowMs();
        const result = engine.update(raceTimeSec, traveled);
        // 결승선에서는 두 러너 거리가 같아 격차가 0으로 막히므로, 결승 순간의 점은 그래프에 넣지 않는다
        if (!result.finished) appendGapPoint(gapSeries, { t: raceTimeSec, gapM: result.snapshot.gapM });
        allEvents.push(...result.events);
        // 결승선을 지나면 결과를 이 기기에 잠깐 담아 결과 화면이 읽게 한다
        const finish = result.events.find((event) => event.type === "finish");
        if (finish && finish.type === "finish" && !summarySaved) {
          summarySaved = true;
          // 결승 순간의 격차는 두 러너 모두 결승선 위치로 막혀 0이 되어 그래프 끝이 튀므로 넣지 않는다
          const summary = buildRaceSummary({
            settings,
            opponent,
            finishEvent: finish,
            gapSeries,
            events: allEvents,
            myElevationGainM: elevation.gainM,
            myTrack: withFinishPoint(track.points, raceTimeSec, settings.distanceM),
          });
          if (summary) {
            summary.raceId = Date.now();
            setFinalResult({ won: summary.won, marginSec: summary.opponentTimeSec - summary.myTimeSec });
            // 전적과 개인 최고 기록에 반영한다 (이 기기에만 저장). 데모는 실제로 뛴 것이 아니므로 반영하지 않는다
            if (settings.source === "gps") {
              const outcome = recordRace(parseHistory(loadHistoryText()), {
                opponentId: summary.opponent.id,
                distanceM: settings.distanceM,
                won: summary.won,
                myTimeSec: summary.myTimeSec,
                run: summary.myTrack ? { elevationGainM: summary.myElevationGainM, points: summary.myTrack } : undefined,
              });
              saveHistory(outcome.history);
              summary.history = {
                newBest: outcome.newBest,
                previousBestSec: outcome.previousBestSec,
                rival: { wins: outcome.rival.wins, losses: outcome.rival.losses },
              };
            }
            try {
              sessionStorage.setItem(SUMMARY_STORAGE_KEY, serializeSummary(summary));
            } catch {
              // 저장하지 못해도 레이스는 계속된다
            }
          }
        }
        lastEngineT = raceTimeSec;
        lastEngineWallMs = nowMs();
        engineFinished = result.finished;
        setSignalLost(null);
        latestTick.current = result;
        setTick(result);
        outputMoments(result.events, result.prediction, raceTimeSec, decidedAtMs);
        if (settings.source === "gps") setGpsError(null);
        if (result.finished) {
          sfxRef.current?.stopHeartbeat(); // 결승선을 지나면 심장 박동은 어떤 경우에도 끈다
          input.stop(); // 결승선을 지나면 위치 추적(또는 데모 재생)을 끈다
          setRunning(false);
        }
      },
      onEnd: () => {
        sfxRef.current?.stopHeartbeat(); // 경기가 끝났는데 심장 박동이 남지 않게
        setRunning(false);
      },
      onError: (error) => setGpsError(error),
    });

    return () => {
      if (lostTimer) clearInterval(lostTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      pauseControlRef.current = null;
      input.stop();
      speakerRef.current?.cancel();
      sfxRef.current?.stopAll();
    };
  }, [phase, outputMoments, opponent, raceDistanceM, raceTimeScale, settings]);

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

  useEffect(() => {
    if (phase === "ready" && settings.source === "gps") askLocation();
  }, [phase, settings.source, askLocation]);

  /** "소리 켜고 시작": 소리 잠금을 풀고(사용자가 누른 때만 가능), 멘트 도구를 준비하고, 레이스를 시작한다 */
  /** 실제 GPS로 뛰려는데 위치가 꺼져 있거나 지원하지 않으면 시작할 수 없다 (데모로 바꾸면 된다) */
  const locBlocked = settings.source === "gps" && (locPerm === "denied" || locPerm === "unavailable");
  const startRace = () => {
    const speaker = createSpeaker(createBrowserSpeakerEnv());
    speaker.unlock();
    speakerRef.current = speaker;
    policyRef.current = createVoicePolicy({ intensity, timeScale: raceTimeScale });
    intensityRef.current = intensity;
    const sfx = createSfx(createBrowserSfxEnv());
    void sfx.preload(); // 버튼을 누른 직후에 불러 두면 첫 효과음 전에 준비된다
    sfxRef.current = sfx;
    bookRef.current = createPhraseBook();
    // 지난 대결이 있으면 출발 중계 대신 그 한마디를 먼저 전한다 ("설욕전입니다!"). 출발 멘트와 겹쳐 말이 끊기지 않게 하나로 합친다
    introRef.current = opponent ? rivalryIntro(parseHistory(loadHistoryText()).rivals[opponent.id]) : null;
    setPhase("running");
  };

  // 개발 중에만 쓰는 이벤트 테스트 버튼: 2분을 기다리지 않고 자막과 음성이 나오는 모습을 바로 본다
  const pushTestEvent = (type: "overtake" | "overtaken" | "last200m") => {
    const t = latestTick.current?.t ?? 0;
    const event: RaceEvent =
      type === "last200m" ? { type, t } : { type, t, gapM: type === "overtake" ? 12 : -12 };
    outputMoments([event], null, t, nowMs());
  };

  const myDistance = tick?.snapshot.myDistanceM ?? 0;
  const rivalDistance = signalLost ? signalLost.rivalDistanceM : (tick?.snapshot.opponentDistanceM ?? 0);
  const gap = signalLost ? myDistance - rivalDistance : (tick?.snapshot.gapM ?? 0);
  /** 코스 위 위치(0~100%) */
  const trackPercent = (distanceM: number) => Math.max(0, Math.min(100, (distanceM / raceDistanceM) * 100));
  const meAhead = myDistance >= rivalDistance;
  const raceMarkers: RouteMarker[] = [
    { fraction: 0, label: "출발", tone: "flag", side: "right" },
    ...Array.from({ length: Math.max(0, Math.ceil(raceDistanceM / 1000) - 1) }, (_, k): RouteMarker => ({
      fraction: ((k + 1) * 1000) / raceDistanceM,
      label: `${k + 1}km`,
      tone: "km",
      side: "right",
    })),
    { fraction: 1, label: "도착", tone: "flag", side: "left" },
    { fraction: trackPercent(rivalDistance) / 100, label: `상대 ${(rivalDistance / 1000).toFixed(2)}km`, tone: "rival", side: meAhead ? "right" : "left", dy: meAhead ? -15 : 15 },
    { fraction: trackPercent(myDistance) / 100, label: `나 ${(myDistance / 1000).toFixed(2)}km`, tone: "me", side: meAhead ? "left" : "right", dy: meAhead ? 15 : -15 },
  ];
  const gapPosition = finalResult ? (finalResult.won ? 92 : 8) : 50 + (Math.max(-GAP_BAR_RANGE_M, Math.min(GAP_BAR_RANGE_M, gap)) / GAP_BAR_RANGE_M) * 50;
  const percent = tick?.estimate ? displayPercent(tick.estimate.probability) : null;
  const finished = tick?.finished ?? false;

  const intensitySelector = (
    <div role="radiogroup" aria-label="중계 강도" className="grid grid-cols-3 gap-2">
      {INTENSITY_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={intensity === option}
          onClick={() => setIntensity(option)}
          className={`rounded-full border px-2 py-2 text-xs font-semibold ${
            intensity === option ? "border-white bg-white text-[#0a0c12]" : "border-white/20 bg-white/5"
          }`}
        >
          {INTENSITY_LABEL[option]}
        </button>
      ))}
    </div>
  );

  if (phase === "ready") {
    return (
      <main className="mx-auto flex h-dvh w-full max-w-md flex-col gap-3 overflow-hidden p-4">
        <header className="pt-2">
          <h1 className="text-3xl font-bold tracking-tight">레이스 준비</h1>
        </header>

        <section aria-label="준비" className="glass flex flex-col gap-3 p-5">
          <p className="text-2xl font-bold">
            {opponent ? displayName(opponent.id) : "상대 없음"}
            <span className="ml-2 text-sm font-medium text-white/60">
              {opponent?.source === "virtual" ? "가상 러너" : opponent?.source === "shared" ? "다른 러너 기록" : "기록"}
            </span>
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl bg-white/5 px-2 py-3">
              <p className="text-xs text-white/55">거리</p>
              <p className="text-xl font-bold tabular-nums">{raceDistanceM / 1000}km</p>
            </div>
            <div className="rounded-2xl bg-white/5 px-2 py-3">
              <p className="text-xs text-white/55">내 페이스</p>
              <p className="text-xl font-bold tabular-nums">{formatPace(settings.paceSecPerKm)}</p>
            </div>
            <div className="rounded-2xl bg-white/5 px-2 py-3">
              <p className="text-xs text-white/55">중계</p>
              <p className="text-xl font-bold">{INTENSITY_LABEL[intensity]}</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-3 py-2.5">
            <div>
              <p className="text-sm font-semibold">데모 모드 (10배속)</p>
              <p className="text-[11px] text-white/50">뛰지 않고 책상에서 체험해요</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.source === "demo"}
              aria-label="데모 모드"
              onClick={() => router.replace(freshRaceHref({ ...settings, source: settings.source === "demo" ? "gps" : "demo" }))}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${settings.source === "demo" ? "bg-emerald-400" : "bg-white/25"}`}
            >
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${settings.source === "demo" ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
          {settings.source === "gps" && (
            <div className="rounded-2xl bg-white/5 px-3 py-2.5 text-xs">
              {locPerm === "checking" && <p className="text-white/70">위치 허용 창이 뜨면 &ldquo;허용&rdquo;을 눌러 주세요…</p>}
              {locPerm === "granted" && <p className="text-emerald-300">위치 사용 허용됨 · 뛰기 시작하면 자동으로 출발해요</p>}
              {(locPerm === "denied" || locPerm === "unavailable") && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-red-300">
                    {locPerm === "denied" ? "위치가 꺼져 있어요." : "이 기기는 위치를 지원하지 않아요."}
                  </p>
                  <details className="text-white/70">
                    <summary className="cursor-pointer underline">위치 켜는 방법 보기</summary>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(Object.keys(ENV_LABEL) as DeviceEnv[]).map((key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setGuideEnv(key)}
                          className={`rounded-full border px-2.5 py-1 ${activeGuide === key ? "border-white bg-white text-[#0a0c12]" : "border-white/25"}`}
                        >
                          {ENV_LABEL[key]}
                        </button>
                      ))}
                    </div>
                    <ol className="mt-2 list-decimal space-y-1 pl-4">
                      {LOCATION_GUIDE[activeGuide].map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </details>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setLocPerm("checking");
                        askLocation();
                      }}
                      className="underline"
                    >
                      다시 확인하기
                    </button>
                    <button
                      type="button"
                      onClick={() => router.replace(freshRaceHref({ ...settings, source: "demo" }))}
                      className="font-semibold underline"
                    >
                      위치 없이 데모로 체험하기
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {!voiceSupport.speech && <p className="text-xs text-white/55">이 기기는 음성 미지원(자막만)</p>}
        </section>

        {opponentSwapped && (
          <p role="status" className="px-1 text-center text-xs text-amber-300">
            고른 상대의 기록이 없어져서, 비슷한 다른 상대({displayName(opponent.id)})로 바꿨어요.
          </p>
        )}
        <p className="px-1 text-center text-sm text-white/60">이어폰을 끼고, 외부 소리 듣기 모드를 켜고 뛰세요.</p>

        <details className="px-1 text-xs text-white/50">
          <summary className="cursor-pointer">음원 출처</summary>
          <p className="mt-1">
            함성 Gregor Quendel (CC BY 4.0) · 심장 박동 bart (CC0) · 박수 Thomas Bresson (CC BY 4.0, Wikimedia Commons)
          </p>
        </details>

        <div className="mt-auto flex gap-3 pb-1">
          <Link href="/" className="btn-secondary">
            돌아가기
          </Link>
          <button
            type="button"
            onClick={startRace}
            disabled={!pool.ready || !opponent || locBlocked}
            className="flex-1 btn-primary disabled:opacity-40"
          >
            {!pool.ready ? "불러오는 중…" : locBlocked ? "위치를 켜 주세요" : "소리 켜고 시작"}
          </button>
        </div>
      </main>
    );
  }

  // 화면 맨 위에 보여 줄 한 줄 안내: 멈춤·위치 문제가 있으면 그것을, 없으면 가장 최근 중계 자막을
  const latest = log[0];
  const notice = gpsError
    ? gpsError.message
    : userPaused && !interrupted
      ? "일시정지 중이에요. 이어달리기를 누르면 계속됩니다"
      : interrupted
        ? "화면이 가려져서 경기를 멈췄어요. 돌아오면 이어집니다"
        : autoPaused
          ? "멈춘 것이 감지돼 일시정지 중이에요. 다시 달리면 이어집니다"
          : signalLost
            ? "위치 신호가 약해요. 상대는 계속 달리는 중이에요 (신호가 돌아오면 이어져요)"
            : settings.source === "gps" && gpsAccuracyM === null
            ? "위치 신호를 기다리는 중…"
            : waitingStart
              ? "뛰기 시작하면 자동으로 출발해요"
              : null;

  return (
    <main className="mx-auto flex h-dvh w-full max-w-md flex-col gap-3 overflow-hidden p-3">
      <section aria-label="진행 상황" className="glass relative min-h-0 flex-1 overflow-hidden !p-0">
        <RouteMap
          variant="compact"
          distanceM={raceDistanceM}
          label="코스 위 나와 상대의 위치"
          progress={trackPercent(myDistance) / 100}
          markers={raceMarkers}
        />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/75 to-transparent p-4 pb-8">
          <div>
            <p className="text-[11px] font-semibold text-white/60">
              {opponent ? displayName(opponent.id) : "상대"} 와 {raceDistanceM / 1000}km
            </p>
            <p className="text-5xl font-bold tracking-tight tabular-nums">
              {(myDistance / 1000).toFixed(2)}
              <span className="ml-1 text-sm font-medium text-white/60">km</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold text-white/60">시간</p>
            <p className="text-3xl font-bold tracking-tight tabular-nums">{formatRaceClock(signalLost?.t ?? tick?.t ?? 0)}</p>
          </div>
        </div>
      </section>

      <section aria-label="나와 상대의 격차" className="glass shrink-0 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xl font-bold tabular-nums">
            {finalResult
              ? finalResult.won
                ? `내 승리! ${formatMargin(finalResult.marginSec)} 먼저 도착`
                : `상대 승리 · ${formatMargin(finalResult.marginSec)} 차이`
              : tick
                ? `${formatGap(gap)} ${gap >= 0 ? "내가 앞서는 중" : "상대가 앞서는 중"}`
                : "출발 준비 중"}
          </p>
          <p className="shrink-0 text-sm font-semibold tabular-nums text-white/70">
            {finalResult ? "경기 종료" : percent === null ? "승률 계산 중" : `승률 ${percent}%`}
          </p>
        </div>
        <div className="relative my-2.5 h-2.5 rounded-full bg-white/10" role="img" aria-label={`격차 ${formatGap(gap)}`}>
          <div className="absolute left-1/2 top-0 h-2.5 w-px bg-white/40" />
          <div
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_14px_rgba(255,255,255,0.6)]"
            style={{ left: `${gapPosition}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-white/50">
          <span>◀ 상대가 앞</span>
          <span>내가 앞 ▶</span>
        </div>
      </section>

      <section aria-label="중계 자막" aria-live="polite" className="glass flex h-[72px] shrink-0 items-center px-4">
        {notice ? (
          <div className="flex w-full items-center justify-between gap-3">
            <p role="status" className="text-sm font-semibold text-white/85">
              {notice}
            </p>
            {gpsError && (gpsError.kind === "denied" || gpsError.kind === "unsupported") && (
              <button
                type="button"
                onClick={() => router.replace(freshRaceHref({ ...settings, source: "demo" }))}
                className="btn-secondary shrink-0 !px-3 !py-1.5 text-xs"
              >
                데모로 체험
              </button>
            )}
          </div>
        ) : latest ? (
          <div className="min-w-0">
            <p className={`line-clamp-2 text-base font-semibold leading-snug ${TONE_CLASS[latest.tone]}`}>
              <span className="mr-1.5 text-xs tabular-nums text-white/50">{formatRaceClock(latest.raceTimeSec)}</span>
              {displayText(latest)}
            </p>
            {(formatEta(latest.etaSec) || voiceNote(latest.voice)) && (
              <p className="truncate text-[11px] text-white/45">
                {[formatEta(latest.etaSec), voiceNote(latest.voice)].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-white/50">경기가 시작되면 중계가 나옵니다</p>
        )}
      </section>

      <div className="shrink-0">{intensitySelector}</div>

      {process.env.NODE_ENV === "development" && (
        <div className="flex shrink-0 gap-2">
          {(
            [
              ["overtake", "추월"],
              ["overtaken", "추월당함"],
              ["last200m", "마지막 200m"],
            ] as const
          ).map(([type, label]) => (
            <button key={type} type="button" onClick={() => pushTestEvent(type)} className="flex-1 btn-secondary !px-2 !py-1 text-[11px]">
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex shrink-0 flex-col gap-2 pb-1">
        {confirmingEnd && !finished && running && (
          <p role="alert" className="text-center text-xs text-white/70">
            경기를 잠깐 멈췄어요. 끝까지 달리지 않고 나가면 결과와 전적에 반영되지 않아요. 정말 나갈까요?
          </p>
        )}
        {finished || !running ? (
          <Link href="/result" className="btn-primary">
            결과 보기
          </Link>
        ) : waitingStart && !confirmingEnd ? (
          <div className="flex gap-3">
            <button type="button" onClick={() => pauseControlRef.current?.startNow()} className="flex-1 btn-primary">
              바로 시작
            </button>
            <button type="button" onClick={() => setConfirmingEnd(true)} className="flex-1 btn-secondary">
              나가기
            </button>
          </div>
        ) : confirmingEnd ? (
          <div className="flex gap-3">
            <button type="button" onClick={() => {
                setConfirmingEnd(false);
                if (!waitingStart) pauseControlRef.current?.setPaused(false); // 계속 달리기: 멈춘 경기를 이어간다
              }} className="flex-1 btn-secondary">
              계속 달리기
            </button>
            <Link href="/" className="flex-1 btn-primary">
              나가기
            </Link>
          </div>
        ) : (
          <div className="flex gap-3">
            <button type="button" onClick={() => pauseControlRef.current?.setPaused(!userPaused)} className="flex-1 btn-primary">
              {userPaused ? "이어달리기" : "중지"}
            </button>
            <button type="button" onClick={() => {
                setConfirmingEnd(true);
                if (!userPaused) pauseControlRef.current?.setPaused(true); // 나갈지 고르는 동안 경기는 멈춘다
              }} className="flex-1 btn-secondary">
              나가기
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
