// 기록 공유(검증·서비스·파일 저장소) 시험
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileStore } from "./file-store";
import { listRecords, MAX_SHARED_RECORDS, removeRecord, submitRecord } from "./service";
import { createMemoryStore } from "./store";
import { validateSubmission } from "./validate";

/** 3km를 5:30/km로 달린 정상 기록 (250m마다 한 점) */
function goodBody(overrides: Record<string, unknown> = {}) {
  const points = [];
  for (let d = 0; d <= 3000; d += 250) points.push({ t: (d / 1000) * 330, d });
  return { completedDistanceM: 3000, totalElevationGainM: 20, points, ...overrides };
}

describe("validateSubmission", () => {
  it("정상 기록은 통과하고, 필요한 칸만 남긴다", () => {
    const result = validateSubmission({ ...goodBody(), lat: 37.5, name: "홍길동", date: "2026-11-23" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.value).sort()).toEqual(["completedDistanceM", "points", "totalElevationGainM"]);
  });

  it("점에 끼어 있는 좌표 같은 다른 칸은 버린다", () => {
    const body = goodBody();
    (body.points[1] as Record<string, unknown>).lat = 37.5;
    const result = validateSubmission(body);
    expect(result.ok && result.value.points[1]).toEqual({ t: 82.5, d: 250 });
  });

  it("고도가 없으면(null) 그대로 받는다", () => {
    const result = validateSubmission(goodBody({ totalElevationGainM: null }));
    expect(result.ok && result.value.totalElevationGainM).toBeNull();
  });

  it.each([
    ["완주 거리가 1km·3km가 아님", { completedDistanceM: 4000 }],
    ["점이 너무 적음", { points: [{ t: 0, d: 0 }] }],
    ["첫 점이 0이 아님", { points: [{ t: 1, d: 0 }, { t: 100, d: 3000 }] }],
    ["너무 빠름(시속 25km 초과)", { points: [{ t: 0, d: 0 }, { t: 100, d: 3000 }] }],
    ["너무 느림", { points: [{ t: 0, d: 0 }, { t: 4200, d: 3000 }] }],
    ["거리가 줄어듦", { points: [{ t: 0, d: 0 }, { t: 200, d: 600 }, { t: 400, d: 500 }, { t: 990, d: 3000 }] }],
    ["시간이 멈춤", { points: [{ t: 0, d: 0 }, { t: 0, d: 10 }, { t: 990, d: 3000 }] }],
    ["마지막 거리가 완주 거리와 다름", { points: [{ t: 0, d: 0 }, { t: 1500, d: 4500 }] }],
    ["고도가 비정상", { totalElevationGainM: 99999 }],
    ["숫자가 아님", { points: [{ t: 0, d: 0 }, { t: "많이", d: 3000 }] }],
  ])("거절한다: %s", (_name, override) => {
    expect(validateSubmission(goodBody(override)).ok).toBe(false);
  });

  it("객체가 아니면 거절한다", () => {
    expect(validateSubmission(null).ok).toBe(false);
    expect(validateSubmission("글").ok).toBe(false);
  });
});

describe("서비스", () => {
  it("올리면 이름표와 비밀 키를 받고, 목록에 공유 기록으로 나온다 (이름·날짜·비밀 키 해시 없음)", async () => {
    const store = createMemoryStore();
    const result = await submitRecord(store, goodBody());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const records = await listRecords(store);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: result.id, source: "shared", registrationOrder: 200 });
    expect(JSON.stringify(records)).not.toContain("tokenHash");
    expect(JSON.stringify(records)).not.toContain(result.deleteToken);
  });

  it("등록 순번이 계속 커진다", async () => {
    const store = createMemoryStore();
    await submitRecord(store, goodBody());
    await submitRecord(store, goodBody());
    expect((await listRecords(store)).map((r) => r.registrationOrder)).toEqual([200, 201]);
  });

  it("잘못된 기록은 400, 저장소가 가득 차면 507로 받지 않는다", async () => {
    const store = createMemoryStore();
    expect(await submitRecord(store, goodBody({ completedDistanceM: 1 }))).toMatchObject({ ok: false, status: 400 });
    const full = createMemoryStore(
      Array.from({ length: MAX_SHARED_RECORDS }, (_, i) => ({
        record: { id: `러너-${i}`, source: "shared" as const, registrationOrder: 200 + i, completedDistanceM: 3000, totalElevationGainM: null, points: [] },
        tokenHash: "x",
      })),
    );
    expect(await submitRecord(full, goodBody())).toMatchObject({ ok: false, status: 507 });
  });

  it("맞는 비밀 키로만 지울 수 있다", async () => {
    const store = createMemoryStore();
    const result = await submitRecord(store, goodBody());
    if (!result.ok) throw new Error("올리기 실패");
    expect(await removeRecord(store, result.id, "틀린키")).toBe("forbidden");
    expect(await listRecords(store)).toHaveLength(1);
    expect(await removeRecord(store, result.id, result.deleteToken)).toBe("removed");
    expect(await listRecords(store)).toHaveLength(0);
    expect(await removeRecord(store, result.id, result.deleteToken)).toBe("not-found");
  });
});

describe("파일 저장소", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("파일에 저장되어 다시 열어도 남아 있고, 동시에 올려도 하나도 잃지 않는다", async () => {
    const dir = await mkdtemp(path.join(process.cwd(), ".data-test-"));
    dirs.push(dir);
    const file = path.join(dir, "shared.json");
    const store = createFileStore(file);
    const results = await Promise.all(Array.from({ length: 10 }, () => submitRecord(store, goodBody())));
    expect(results.every((r) => r.ok)).toBe(true);
    const reopened = createFileStore(file);
    expect(await listRecords(reopened)).toHaveLength(10);
    const first = results[0];
    if (first.ok) await removeRecord(reopened, first.id, first.deleteToken);
    expect(await listRecords(createFileStore(file))).toHaveLength(9);
  });

  it("파일이 없거나 망가졌으면 빈 저장소로 시작한다", async () => {
    const dir = await mkdtemp(path.join(process.cwd(), ".data-test-"));
    dirs.push(dir);
    expect(await listRecords(createFileStore(path.join(dir, "없음.json")))).toEqual([]);
  });
});
