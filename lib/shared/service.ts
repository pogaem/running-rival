// 기록 공유 서비스 (PLAN.md 작업 23): 올리기·목록·삭제의 규칙. 저장소 창구만 보고 동작한다.
// 로그인이 없으므로 올릴 때 비밀 키(deleteToken)를 한 번만 돌려주고, 서버에는 그 해시만 둔다. 지울 때 이 키가 맞아야 한다.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { RunRecord } from "../record";
import type { AddLimits, SharedStore } from "./store";
import { validateSubmission } from "./validate";

/** 공유 기록의 등록 순번은 200번부터 (가상 러너 1~99, 캠프 100~) */
export const SHARED_ORDER_START = 200;
/** 저장소가 이만큼 차면 더 받지 않는다 (남용 방지) */
export const MAX_SHARED_RECORDS = 1000;

/** 같은 접속 주소가 이 시간(초) 안에 올릴 수 있는 기록 수 (한 경기에 하나씩이라 넉넉하다) */
export const PER_IP_LIMIT = 5;
export const PER_IP_WINDOW_SEC = 3600;

export const ADD_LIMITS: AddLimits = {
  maxTotal: MAX_SHARED_RECORDS,
  perIpLimit: PER_IP_LIMIT,
  windowSec: PER_IP_WINDOW_SEC,
  orderStart: SHARED_ORDER_START,
};

export type SubmitResult =
  | { ok: true; id: string; deleteToken: string }
  | { ok: false; status: 400 | 429 | 507; message: string };

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** ipHash: 올린 사람의 접속 주소를 뒤섞은 값(주소 자체는 저장하지 않는다). 속도 제한에만 쓴다 */
export async function submitRecord(store: SharedStore, body: unknown, ipHash = "unknown"): Promise<SubmitResult> {
  const checked = validateSubmission(body);
  if (!checked.ok) return { ok: false, status: 400, message: checked.message };

  // 이름표는 서버가 정한다 (겹치면 DB가 거절한다. 1천만 분의 1 수준이라 드물다)
  const id = `러너-${randomBytes(4).toString("hex")}`;

  const record: RunRecord = {
    id,
    source: "shared",
    registrationOrder: 0, // 저장소가 한도를 확인하면서 정한다
    completedDistanceM: checked.value.completedDistanceM,
    totalElevationGainM: checked.value.totalElevationGainM,
    points: checked.value.points,
  };
  const deleteToken = randomBytes(16).toString("hex");
  const added = await store.add({ record, tokenHash: hashToken(deleteToken) }, ipHash, ADD_LIMITS);
  if (added.result === "full") return { ok: false, status: 507, message: "공유 저장소가 가득 찼습니다" };
  if (added.result === "rate-limited") {
    return { ok: false, status: 429, message: "잠시 뒤에 다시 올려 주세요 (짧은 시간에 너무 많이 올렸어요)" };
  }
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
