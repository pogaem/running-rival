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
  // 배포 환경에서 키가 빠졌는데 조용히 파일 저장소로 넘어가면 기록이 사라지거나 오류가 난다 → 분명히 멈춘다
  if (process.env.NODE_ENV === "production" && !(url && key)) {
    throw new Error("공유 저장소 환경 변수(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)가 없습니다");
  }
  // 배포 환경(키가 있을 때)은 Supabase, 개발 중에는 내 컴퓨터의 파일
  store =
    url && key
      ? createSupabaseStore(url, key)
      : createFileStore(process.env.SHARED_STORE_PATH ?? path.join(process.cwd(), ".data", "shared-records.json"));
  return store;
}
