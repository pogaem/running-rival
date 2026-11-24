// 기록 공유 저장소 창구 (PLAN.md 작업 23, DESIGN.md 3번)
// 서비스는 이 창구만 보고, 뒤에 무엇이 있는지는 모른다.
//   개발 중: 내 컴퓨터의 파일(.data/shared-records.json)   배포 때: Supabase (작업 25)
import type { RunRecord } from "../record";

export type SharedEntry = {
  record: RunRecord;
  /** 삭제용 비밀 키의 해시. 비밀 키 자체는 서버에 남기지 않는다 */
  tokenHash: string;
  /** 올린 사람의 접속 주소를 한 번 더 뒤섞은 값(속도 제한용). 하루가 지나면 지운다. 개발용 저장소에서만 여기에 둔다 */
  ipHash?: string | null;
  /** 올린 시각(밀리초). 개발용 저장소에서만 쓴다 */
  createdAtMs?: number;
};

/** 올리기 한도 */
export type AddLimits = {
  /** 저장소 전체 상한 */
  maxTotal: number;
  /** 같은 접속 주소가 window 안에 올릴 수 있는 수 */
  perIpLimit: number;
  windowSec: number;
  /** 등록 순번의 시작 번호 */
  orderStart: number;
};

/** 올리기 결과: 성공하면 저장소가 정한 등록 순번을 돌려준다 */
export type AddResult = { result: "ok"; registrationOrder: number } | { result: "full" } | { result: "rate-limited" };

/** 한도를 확인하고 순번을 정한다 (메모리·파일 저장소가 함께 쓰는 규칙. Supabase는 같은 규칙을 DB 안에서 한 번에 처리한다) */
export function planAdd(
  entries: SharedEntry[],
  ipHash: string,
  limits: AddLimits,
  nowMs: number,
): { result: "ok"; registrationOrder: number } | { result: "full" } | { result: "rate-limited" } {
  if (entries.length >= limits.maxTotal) return { result: "full" };
  const since = nowMs - limits.windowSec * 1000;
  const recent = entries.filter((entry) => entry.ipHash === ipHash && (entry.createdAtMs ?? 0) > since).length;
  if (recent >= limits.perIpLimit) return { result: "rate-limited" };
  const last = Math.max(limits.orderStart - 1, ...entries.map((entry) => entry.record.registrationOrder));
  return { result: "ok", registrationOrder: last + 1 };
}

export type SharedStore = {
  list(): Promise<SharedEntry[]>;
  /** 한도를 확인하고, 통과하면 순번을 정해 저장한다 (한 번에 하나씩 처리해야 한다) */
  add(entry: SharedEntry, ipHash: string, limits: AddLimits): Promise<AddResult>;
  /** 이름표가 id인 기록을 지운다. 지웠으면 true */
  remove(id: string): Promise<boolean>;
};

/** 시험과 임시용: 메모리에만 둔다 */
export function createMemoryStore(initial: SharedEntry[] = []): SharedStore {
  const entries = [...initial];
  return {
    async list() {
      return entries.map((entry) => ({ ...entry }));
    },
    async add(entry, ipHash, limits) {
      const plan = planAdd(entries, ipHash, limits, Date.now());
      if (plan.result !== "ok") return plan;
      entries.push({ ...entry, record: { ...entry.record, registrationOrder: plan.registrationOrder }, ipHash, createdAtMs: Date.now() });
      return plan;
    },
    async remove(id) {
      const index = entries.findIndex((entry) => entry.record.id === id);
      if (index < 0) return false;
      entries.splice(index, 1);
      return true;
    },
  };
}
