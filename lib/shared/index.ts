// 지금 쓰는 공유 저장소를 정한다 (서버에서만 쓴다)
// 개발 중에는 파일 저장소. 배포 때(작업 25)는 환경 변수에 따라 Supabase로 바꾼다.
import path from "node:path";
import { createFileStore } from "./file-store";
import { createSupabaseStore } from "./supabase-store";
import type { SharedStore } from "./store";

let store: SharedStore | null = null;

export function getSharedStore(): SharedStore {
  if (store) return store;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // 배포 환경(키가 있을 때)은 Supabase, 개발 중에는 내 컴퓨터의 파일
  store =
    url && key
      ? createSupabaseStore(url, key)
      : createFileStore(process.env.SHARED_STORE_PATH ?? path.join(process.cwd(), ".data", "shared-records.json"));
  return store;
}
