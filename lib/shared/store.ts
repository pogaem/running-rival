// 기록 공유 저장소 창구 (PLAN.md 작업 23, DESIGN.md 3번)
// 서비스는 이 창구만 보고, 뒤에 무엇이 있는지는 모른다.
//   개발 중: 내 컴퓨터의 파일(.data/shared-records.json)   배포 때: Supabase (작업 25)
import type { RunRecord } from "../record";

export type SharedEntry = {
  record: RunRecord;
  /** 삭제용 비밀 키의 해시. 비밀 키 자체는 서버에 남기지 않는다 */
  tokenHash: string;
};

export type SharedStore = {
  list(): Promise<SharedEntry[]>;
  add(entry: SharedEntry): Promise<void>;
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
    async add(entry) {
      entries.push(entry);
    },
    async remove(id) {
      const index = entries.findIndex((entry) => entry.record.id === id);
      if (index < 0) return false;
      entries.splice(index, 1);
      return true;
    },
  };
}
