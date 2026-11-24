// 배포용 공유 저장소: Supabase(무료 플랜)의 표 하나에 저장한다 (PLAN.md 작업 25, 서버에서만 쓴다)
// 별도 라이브러리 없이 Supabase의 REST 주소를 fetch로 부른다. 서버 전용 키는 서버 환경 변수에만 둔다.
import type { RunRecord } from "../record";
import type { AddResult, SharedEntry, SharedStore } from "./store";

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
        await fetch(`${endpoint}?select=id,token_hash,record&order=created_at.asc&limit=1000`, { headers, cache: "no-store" }),
        "목록 읽기",
      );
      const rows = (await response.json()) as Row[];
      return rows.map((row): SharedEntry => ({ record: row.record, tokenHash: row.token_hash }));
    },
    async add(entry, ipHash, limits): Promise<AddResult> {
      // 한도 확인과 순번 정하기와 저장을 DB 함수 안에서 한 번에 한다 (동시에 여러 요청이 와도 어긋나지 않게)
      const response = await check(
        await fetch(`${baseUrl.replace(/\/$/, "")}/rest/v1/rpc/insert_shared_record`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            p_id: entry.record.id,
            p_token_hash: entry.tokenHash,
            p_record: entry.record,
            p_ip_hash: ipHash,
            p_max_total: limits.maxTotal,
            p_per_ip: limits.perIpLimit,
            p_window_sec: limits.windowSec,
            p_order_start: limits.orderStart,
          }),
        }),
        "저장",
      );
      const out = (await response.json()) as { result: "ok" | "full" | "rate"; order?: number };
      if (out.result === "ok") return { result: "ok", registrationOrder: out.order ?? 0 };
      return out.result === "full" ? { result: "full" } : { result: "rate-limited" };
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
