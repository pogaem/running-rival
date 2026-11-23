// 지금 쓰는 공유 저장소를 정한다 (서버에서만 쓴다)
// 개발 중에는 파일 저장소. 배포 때(작업 25)는 환경 변수에 따라 Supabase로 바꾼다.
import path from "node:path";
import { createFileStore } from "./file-store";
import type { SharedStore } from "./store";

let store: SharedStore | null = null;

export function getSharedStore(): SharedStore {
  store ??= createFileStore(process.env.SHARED_STORE_PATH ?? path.join(process.cwd(), ".data", "shared-records.json"));
  return store;
}
