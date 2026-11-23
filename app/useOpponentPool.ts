"use client";
// 대결 상대 후보 모으기 (PLAN.md 작업 24)
// 가상 러너·캠프 기록(앱 안 파일)에 더해, 다른 사용자가 동의하고 공유한 기록을 서버에서 받아 합친다.
// 서버에서 못 받으면(연결 실패 등) 앱 안 기록만으로 대결한다.
import { useEffect, useMemo, useState } from "react";
import type { RunRecord } from "@/lib/record";
import { getOpponentRecords } from "@/lib/runners";
import { fetchSharedRecords } from "@/lib/shared/client";

export function useOpponentPool(): { records: RunRecord[]; sharedCount: number; ready: boolean } {
  const [shared, setShared] = useState<RunRecord[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchSharedRecords().then((records) => {
      if (cancelled) return;
      setShared(records);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const records = useMemo(() => [...getOpponentRecords(), ...shared], [shared]);
  return { records, sharedCount: shared.length, ready };
}
