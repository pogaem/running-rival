// 공유 올리기 API의 입구 검사 시험: 다른 사이트 요청, JSON이 아닌 요청, 너무 큰 요청을 막는다
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "shared-route-"));
  vi.stubEnv("SHARED_STORE_PATH", path.join(dir, "records.json"));
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

function post(headers: Record<string, string>, body: string) {
  return new Request("http://localhost/api/shared-records", { method: "POST", headers: { host: "localhost", ...headers }, body });
}
const GOOD = JSON.stringify({
  completedDistanceM: 1000,
  totalElevationGainM: null,
  points: [
    { t: 0, d: 0 },
    { t: 330, d: 1000 },
  ],
});

describe("POST /api/shared-records 입구 검사", () => {
  it("다른 사이트(Origin이 다름)에서 온 요청은 403", async () => {
    const { POST } = await import("@/app/api/shared-records/route");
    const response = await POST(post({ "content-type": "application/json", origin: "https://evil.example" }, GOOD));
    expect(response.status).toBe(403);
  });

  it("JSON이 아닌 형식(text/plain)은 415", async () => {
    const { POST } = await import("@/app/api/shared-records/route");
    const response = await POST(post({ "content-type": "text/plain" }, GOOD));
    expect(response.status).toBe(415);
  });

  it("너무 큰 본문은 413", async () => {
    const { POST } = await import("@/app/api/shared-records/route");
    const big = JSON.stringify({ junk: "x".repeat(70 * 1024) });
    expect((await POST(post({ "content-type": "application/json" }, big))).status).toBe(413);
  });

  it("같은 사이트에서 온 정상 요청은 201", async () => {
    const { POST } = await import("@/app/api/shared-records/route");
    const response = await POST(post({ "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": "1.2.3.4" }, GOOD));
    expect(response.status).toBe(201);
  });
});

describe("GET /api/shared-records", () => {
  it("잠깐 같이 쓰도록 캐시 머리글을 붙인다", async () => {
    const { GET } = await import("@/app/api/shared-records/route");
    expect((await GET()).headers.get("cache-control")).toContain("s-maxage=60");
  });
});
