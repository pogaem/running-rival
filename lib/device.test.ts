import { describe, expect, it } from "vitest";
import { detectDeviceEnv } from "./device";

describe("detectDeviceEnv", () => {
  it("아이폰 사파리", () => {
    expect(detectDeviceEnv("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1")).toBe("iphone-safari");
  });
  it("삼성 인터넷", () => {
    expect(detectDeviceEnv("Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit SamsungBrowser/24.0 Chrome/117 Mobile")).toBe("samsung-internet");
  });
  it("안드로이드 크롬", () => {
    expect(detectDeviceEnv("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit Chrome/120 Mobile Safari")).toBe("android-chrome");
  });
  it("컴퓨터", () => {
    expect(detectDeviceEnv("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Chrome/120")).toBe("other");
  });
});
