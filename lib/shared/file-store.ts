// 개발용 공유 저장소: 내 컴퓨터의 파일 한 개에 저장한다 (서버에서만 쓴다)
// 파일은 .data/ 안에 있고 git에 올라가지 않는다. 쓰기는 한 번에 하나씩 순서대로 한다.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { planAdd, type SharedEntry, type SharedStore } from "./store";

export function createFileStore(filePath: string): SharedStore {
  let queue: Promise<unknown> = Promise.resolve();

  const read = async (): Promise<SharedEntry[]> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
      return Array.isArray(parsed) ? (parsed as SharedEntry[]) : [];
    } catch {
      return []; // 파일이 없거나 망가졌으면 빈 저장소로 본다
    }
  };

  const write = async (entries: SharedEntry[]) => {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.tmp`;
    await writeFile(temp, JSON.stringify(entries), "utf8");
    await rename(temp, filePath); // 쓰다가 끊겨도 기존 파일이 망가지지 않게
  };

  /** 쓰기 작업을 줄 세워 동시에 두 요청이 서로 덮어쓰지 않게 한다 */
  const exclusive = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job, job);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    list: () => read(),
    add: (entry, ipHash, limits) =>
      exclusive(async () => {
        const entries = await read();
        const plan = planAdd(entries, ipHash, limits, Date.now());
        if (plan.result !== "ok") return plan;
        entries.push({ ...entry, record: { ...entry.record, registrationOrder: plan.registrationOrder }, ipHash, createdAtMs: Date.now() });
        await write(entries);
        return plan;
      }),
    remove: (id) =>
      exclusive(async () => {
        const entries = await read();
        const next = entries.filter((entry) => entry.record.id !== id);
        if (next.length === entries.length) return false;
        await write(next);
        return true;
      }),
  };
}
