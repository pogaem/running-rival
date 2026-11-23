// 공유 기록 쓰는 쪽(브라우저) 도구 (PLAN.md 작업 24)
// 올린 기록의 이름표와 비밀 키는 이 기기의 localStorage에만 둔다. 비밀 키가 있어야 내가 올린 기록을 지울 수 있다.
import type { DistancePoint, RunRecord } from "../record";
import { validateRunRecord } from "../record";

export const SHARE_TOKENS_KEY = "running-rival:shared-tokens";

export type ShareTokens = Record<string, string>;

export function parseShareTokens(text: string | null): ShareTokens {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

export function loadShareTokensText(): string | null {
  try {
    return localStorage.getItem(SHARE_TOKENS_KEY);
  } catch {
    return null;
  }
}

function saveShareTokens(tokens: ShareTokens): void {
  try {
    localStorage.setItem(SHARE_TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    // 저장하지 못하면 나중에 이 기기에서 지울 수 없을 뿐, 경기에는 영향이 없다
  }
}

/** 서버가 보낸 기록 목록에서 모양이 맞는 공유 기록만 고르고, 내가 올린 기록은 뺀다(내 기록과 붙지 않게) */
export function pickUsableShared(raw: unknown, ownIds: ReadonlySet<string>): RunRecord[] {
  if (!Array.isArray(raw)) return [];
  const usable: RunRecord[] = [];
  for (const item of raw as RunRecord[]) {
    if (!item || typeof item.id !== "string" || item.source !== "shared" || !Array.isArray(item.points)) continue;
    if (ownIds.has(item.id)) continue;
    if (validateRunRecord(item).length > 0) continue;
    usable.push(item);
  }
  return usable;
}

/** 공유된 기록을 불러온다. 서버가 없거나 실패하면 빈 목록(가상 러너만으로 대결) */
export async function fetchSharedRecords(): Promise<RunRecord[]> {
  try {
    const response = await fetch("/api/shared-records", { cache: "no-store" });
    if (!response.ok) return [];
    const data: { records?: unknown } = await response.json();
    const own = new Set(Object.keys(parseShareTokens(loadShareTokensText())));
    return pickUsableShared(data.records, own);
  } catch {
    return [];
  }
}

export type ShareResult = { ok: true; id: string } | { ok: false; message: string };

/** 내 기록을 공유한다. 성공하면 비밀 키를 이 기기에 저장한다 */
export async function shareMyRecord(input: {
  completedDistanceM: number;
  totalElevationGainM: number | null;
  points: DistancePoint[];
}): Promise<ShareResult> {
  try {
    const response = await fetch("/api/shared-records", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const data: { id?: string; deleteToken?: string; message?: string } = await response.json();
    if (!response.ok || !data.id || !data.deleteToken) return { ok: false, message: data.message ?? "공유하지 못했어요" };
    saveShareTokens({ ...parseShareTokens(loadShareTokensText()), [data.id]: data.deleteToken });
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, message: "서버에 연결하지 못했어요" };
  }
}

/** 내가 공유한 기록을 지운다 */
export async function unshareMyRecord(id: string): Promise<ShareResult> {
  const tokens = parseShareTokens(loadShareTokensText());
  const token = tokens[id];
  if (!token) return { ok: false, message: "이 기기에서 공유한 기록이 아니에요" };
  try {
    const response = await fetch(`/api/shared-records/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "x-delete-token": token },
    });
    if (!response.ok && response.status !== 404) {
      const data: { message?: string } = await response.json().catch(() => ({}));
      return { ok: false, message: data.message ?? "지우지 못했어요" };
    }
    const { [id]: _removed, ...rest } = tokens;
    void _removed;
    saveShareTokens(rest);
    return { ok: true, id };
  } catch {
    return { ok: false, message: "서버에 연결하지 못했어요" };
  }
}
