// 배포용 공유 저장소: Supabase(무료 플랜)의 표 하나에 저장한다 (PLAN.md 작업 25, 서버에서만 쓴다)
// 별도 라이브러리 없이 Supabase의 REST 주소를 fetch로 부른다. 서버 전용 키는 서버 환경 변수에만 둔다.
import type { RunRecord } from "../record";
import type { SharedEntry, SharedStore } from "./store";

type Row = { id: string; token_hash: string; record: RunRecord };

export function createSupabaseStore(baseUrl: string, serviceKey: string): SharedStore {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/rest/v1/shared_records`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const check = async (response: Response, what: string) => {
    if (!response.ok) throw new Error(`공유 저장소 ${what} 실패 (${response.status})`);
    return response;
  };

  return {
    async list() {
      const response = await check(
        await fetch(`${endpoint}?select=id,token_hash,record&order=created_at.asc&limit=2000`, { headers, cache: "no-store" }),
        "목록 읽기",
      );
      const rows = (await response.json()) as Row[];
      return rows.map((row): SharedEntry => ({ record: row.record, tokenHash: row.token_hash }));
    },
    async add(entry) {
      await check(
        await fetch(endpoint, {
          method: "POST",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify({ id: entry.record.id, token_hash: entry.tokenHash, record: entry.record }),
        }),
        "저장",
      );
    },
    async remove(id) {
      const response = await check(
        await fetch(`${endpoint}?id=eq.${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { ...headers, Prefer: "return=representation" },
        }),
        "삭제",
      );
      return ((await response.json()) as unknown[]).length > 0;
    },
  };
}
