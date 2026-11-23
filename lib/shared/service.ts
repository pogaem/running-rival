// 기록 공유 서비스 (PLAN.md 작업 23): 올리기·목록·삭제의 규칙. 저장소 창구만 보고 동작한다.
// 로그인이 없으므로 올릴 때 비밀 키(deleteToken)를 한 번만 돌려주고, 서버에는 그 해시만 둔다. 지울 때 이 키가 맞아야 한다.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { RunRecord } from "../record";
import type { SharedStore } from "./store";
import { validateSubmission } from "./validate";

/** 공유 기록의 등록 순번은 200번부터 (가상 러너 1~99, 캠프 100~) */
export const SHARED_ORDER_START = 200;
/** 저장소가 이만큼 차면 더 받지 않는다 (남용 방지) */
export const MAX_SHARED_RECORDS = 1000;

export type SubmitResult =
  | { ok: true; id: string; deleteToken: string }
  | { ok: false; status: 400 | 507; message: string };

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function submitRecord(store: SharedStore, body: unknown): Promise<SubmitResult> {
  const checked = validateSubmission(body);
  if (!checked.ok) return { ok: false, status: 400, message: checked.message };

  const entries = await store.list();
  if (entries.length >= MAX_SHARED_RECORDS) {
    return { ok: false, status: 507, message: "공유 저장소가 가득 찼습니다" };
  }

  const used = new Set(entries.map((entry) => entry.record.id));
  let id = "";
  do {
    id = `러너-${randomBytes(3).toString("hex")}`;
  } while (used.has(id));

  const order = Math.max(SHARED_ORDER_START - 1, ...entries.map((entry) => entry.record.registrationOrder)) + 1;
  const record: RunRecord = {
    id,
    source: "shared",
    registrationOrder: order,
    completedDistanceM: checked.value.completedDistanceM,
    totalElevationGainM: checked.value.totalElevationGainM,
    points: checked.value.points,
  };
  const deleteToken = randomBytes(16).toString("hex");
  await store.add({ record, tokenHash: hashToken(deleteToken) });
  return { ok: true, id, deleteToken };
}

export async function listRecords(store: SharedStore): Promise<RunRecord[]> {
  return (await store.list()).map((entry) => entry.record);
}

export type RemoveResult = "removed" | "not-found" | "forbidden";

export async function removeRecord(store: SharedStore, id: string, token: string): Promise<RemoveResult> {
  const entry = (await store.list()).find((item) => item.record.id === id);
  if (!entry) return "not-found";
  const given = Buffer.from(hashToken(token));
  const stored = Buffer.from(entry.tokenHash);
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return "forbidden";
  await store.remove(id);
  return "removed";
}
