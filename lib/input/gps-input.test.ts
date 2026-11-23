// 실제 GPS 입력(lib/input/gps-input.ts) 시험: 가짜 위치 환경으로 확인한다
import { describe, expect, it } from "vitest";
import { createGpsInput, describeGeoError, type GeoErrorLike, type GeoPositionLike, type GpsEnv } from "./gps-input";
import type { InputError, PositionSample } from "./types";

function makeEnv(supported = true, startEpoch = 1_000_000) {
  let onPosition: (p: GeoPositionLike) => void = () => {};
  let onError: (e: GeoErrorLike) => void = () => {};
  const cleared: number[] = [];
  const env: GpsEnv = {
    watch: supported
      ? (p, e) => {
          onPosition = p;
          onError = e;
          return 7;
        }
      : null,
    clearWatch: (id) => cleared.push(id),
    now: () => startEpoch,
  };
  const position = (secondsAfterStart: number, lat = 37.5, lon = 127, accuracy = 5, altitude: number | null = 20): GeoPositionLike => ({
    timestamp: startEpoch + secondsAfterStart * 1000,
    coords: { latitude: lat, longitude: lon, accuracy, altitude },
  });
  return {
    env,
    cleared,
    position,
    send: (p: GeoPositionLike) => onPosition(p),
    fail: (e: GeoErrorLike) => onError(e),
  };
}

describe("createGpsInput", () => {
  it("위치를 데모 입력과 같은 모양의 점으로 바꿔 내보낸다 (시간은 시작부터 흐른 초)", () => {
    const { env, position, send } = makeEnv();
    const samples: PositionSample[] = [];
    createGpsInput(env).start({ onSample: (s) => samples.push(s) });
    send(position(3.5, 37.51, 127.02, 8, 31.5));
    expect(samples).toEqual([{ t: 3.5, lat: 37.51, lon: 127.02, accuracyM: 8, ele: 31.5 }]);
  });

  it("기기가 고도를 안 주면 고도는 null이다", () => {
    const { env, position, send } = makeEnv();
    const samples: PositionSample[] = [];
    createGpsInput(env).start({ onSample: (s) => samples.push(s) });
    send(position(1, 37.5, 127, 5, null));
    expect(samples[0].ele).toBeNull();
  });

  it("시작 전에 잰 오래된 위치는 0초로 본다", () => {
    const { env, position, send } = makeEnv();
    const samples: PositionSample[] = [];
    createGpsInput(env).start({ onSample: (s) => samples.push(s) });
    send(position(-4));
    expect(samples[0].t).toBe(0);
  });

  it("멈추면 위치 추적을 끄고 더 이상 점을 내보내지 않는다", () => {
    const { env, position, send, cleared } = makeEnv();
    const samples: PositionSample[] = [];
    const input = createGpsInput(env);
    input.start({ onSample: (s) => samples.push(s) });
    input.stop();
    send(position(1));
    expect(cleared).toEqual([7]);
    expect(samples).toHaveLength(0);
  });

  it("한 번만 시작할 수 있다", () => {
    const { env } = makeEnv();
    const input = createGpsInput(env);
    input.start({ onSample: () => {} });
    expect(() => input.start({ onSample: () => {} })).toThrow();
  });
});

describe("위치 오류", () => {
  it("권한을 거부하면 이유를 알리고 입력을 멈춘다", () => {
    const { env, fail, cleared, position, send } = makeEnv();
    const errors: InputError[] = [];
    const samples: PositionSample[] = [];
    createGpsInput(env).start({ onSample: (s) => samples.push(s), onError: (e) => errors.push(e) });
    fail({ code: 1 });
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe("denied");
    expect(errors[0].message).toContain("데모");
    expect(cleared).toEqual([7]);
    send(position(1));
    expect(samples).toHaveLength(0);
  });

  it("신호가 잠깐 안 잡히는 오류는 알리기만 하고 입력은 계속된다", () => {
    const { env, fail, cleared, position, send } = makeEnv();
    const errors: InputError[] = [];
    const samples: PositionSample[] = [];
    createGpsInput(env).start({ onSample: (s) => samples.push(s), onError: (e) => errors.push(e) });
    fail({ code: 3 });
    fail({ code: 2 });
    expect(errors.map((e) => e.kind)).toEqual(["timeout", "unavailable"]);
    expect(cleared).toEqual([]);
    send(position(5));
    expect(samples).toHaveLength(1);
  });

  it("위치를 지원하지 않는 기기는 지원 안 됨으로 알린다", () => {
    const { env } = makeEnv(false);
    const errors: InputError[] = [];
    createGpsInput(env).start({ onSample: () => {}, onError: (e) => errors.push(e) });
    expect(errors.map((e) => e.kind)).toEqual(["unsupported"]);
  });

  it("describeGeoError는 알 수 없는 코드도 '위치를 알 수 없음'으로 바꾼다", () => {
    expect(describeGeoError({ code: 99 }).kind).toBe("unavailable");
  });
});
