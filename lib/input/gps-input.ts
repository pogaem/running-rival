// 실제 GPS 입력 (PLAN.md 작업 14, DESIGN.md 2번)
// 브라우저의 위치 기능(Geolocation)으로 폰의 위치를 받아 데모 입력과 똑같은 모양(PositionInput)으로 내보낸다.
// 그래서 분석 엔진은 입력이 GPS인지 데모인지 모르고 똑같이 동작한다.
//
// 시간 기준: 점의 시간(t)은 "start()를 부른 순간부터 흐른 실제 시간(초)"이다.
// 위치 보정(튀는 값 제거, 이동 평균)은 작업 15에서 만든다. 지금은 받은 값을 그대로 내보낸다.
// 브라우저 기능은 "환경(GpsEnv)"으로 받아서, 시험에서는 가짜 환경으로 확인한다.
import type { InputError, InputHandlers, PositionInput, PositionSample } from "./types";

/** 브라우저가 알려 주는 위치 한 점(GeolocationPosition 중에서 쓰는 부분) */
export type GeoPositionLike = {
  /** 위치를 잰 시각(밀리초, 1970년부터) */
  timestamp: number;
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude: number | null;
  };
};

/** 브라우저가 알려 주는 위치 오류 */
export type GeoErrorLike = { code: number; message?: string };

export type GpsEnv = {
  /** 위치 추적을 시작하고, 멈출 때 쓸 번호를 돌려준다. 이 기기가 위치를 지원하지 않으면 null */
  watch: ((onPosition: (position: GeoPositionLike) => void, onError: (error: GeoErrorLike) => void) => number) | null;
  clearWatch: (id: number) => void;
  /** 지금 시각(밀리초, 1970년부터) */
  now: () => number;
};

/** GeolocationPositionError.code 값 */
const CODE_DENIED = 1;
const CODE_UNAVAILABLE = 2;
const CODE_TIMEOUT = 3;

/** 위치 오류를 사용자에게 보여 줄 한국어 설명으로 바꾼다 */
export function describeGeoError(error: GeoErrorLike): InputError {
  switch (error.code) {
    case CODE_DENIED:
      return {
        kind: "denied",
        message: "위치 권한이 꺼져 있어요. 브라우저의 사이트 설정에서 위치를 허용하거나, 데모 모드로 체험해 보세요.",
      };
    case CODE_TIMEOUT:
      return { kind: "timeout", message: "위치 신호가 오래 오지 않아요. 하늘이 트인 곳에서 다시 시도해 주세요." };
    case CODE_UNAVAILABLE:
    default:
      return { kind: "unavailable", message: "지금은 위치를 알 수 없어요. 하늘이 트인 곳에서 다시 시도해 주세요." };
  }
}

/** 위치 입력을 만든다 */
export function createGpsInput(env: GpsEnv): PositionInput {
  let state: "idle" | "running" | "done" = "idle";
  let watchId: number | null = null;

  const stop = () => {
    state = "done";
    if (watchId !== null) {
      env.clearWatch(watchId);
      watchId = null;
    }
  };

  return {
    start(handlers: InputHandlers) {
      if (state !== "idle") {
        throw new Error("GPS 입력은 한 번만 시작할 수 있다");
      }
      state = "running";

      if (!env.watch) {
        state = "done";
        handlers.onError?.({ kind: "unsupported", message: "이 기기(브라우저)는 위치 기능을 지원하지 않아요. 데모 모드로 체험해 보세요." });
        return;
      }

      const startedAt = env.now();
      watchId = env.watch(
        (position) => {
          if (state !== "running") return;
          const sample: PositionSample = {
            // 시작 전에 잰 오래된 위치가 오면 0초로 본다
            t: Math.max(0, (position.timestamp - startedAt) / 1000),
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracyM: position.coords.accuracy,
            ele: position.coords.altitude,
          };
          handlers.onSample(sample);
        },
        (error) => {
          if (state !== "running") return;
          const described = describeGeoError(error);
          // 일시적인 신호 문제(timeout/unavailable)는 브라우저가 계속 시도하므로 입력은 유지하고 알리기만 한다.
          // 권한 거부는 더 할 수 있는 일이 없어 입력을 멈춘다
          if (described.kind === "denied") stop();
          handlers.onError?.(described);
        },
      );
    },

    stop,
  };
}

/** 실제 브라우저 환경. 브라우저에서만 부른다(서버에서는 "지원 안 됨"인 환경이 나온다) */
export function createBrowserGpsEnv(): GpsEnv {
  const geolocation = typeof navigator !== "undefined" && "geolocation" in navigator ? navigator.geolocation : null;
  return {
    watch: geolocation
      ? (onPosition, onError) =>
          geolocation.watchPosition(onPosition, onError, {
            enableHighAccuracy: true, // 러닝에는 GPS의 정확한 위치가 필요하다
            maximumAge: 0, // 오래된 위치를 쓰지 않는다
            timeout: 15000,
          })
      : null,
    clearWatch: (id) => geolocation?.clearWatch(id),
    now: () => Date.now(),
  };
}
