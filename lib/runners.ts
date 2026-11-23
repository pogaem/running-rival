// 상대 기록 불러오기 (PLAN.md 작업 2, DESIGN.md 3·4번)
// 가상 러너(data/virtual-runners.json)와 캠프 참가자 기록(data/camp-records.json)을
// 같은 기록 형식(RunRecord)으로 읽어서 검사한 뒤 돌려준다.
//
// 가상 러너 9명의 설계 (모두 5km 완주, 이름 대신 익명 이름표 "가상러너-NN"):
//   평균 페이스(분:초/km) · 달리는 모양(4구간 페이스를 평균 대비 비율로 적은 것) · 상승 고도
//   01  5:00  일정형        평지 쪽 10m
//   02  5:10  후반 스퍼트형  25m
//   03  5:30  초반 질주형    40m
//   04  5:40  후반 스퍼트형  5m
//   05  6:00  중반 처짐형    60m
//   06  6:10  초반 질주형    15m
//   07  6:30  후반 스퍼트형  고도 정보 없음(null)
//   08  6:40  중반 처짐형    0m
//   09  7:00  일정형        45m
// 모양의 비율: 일정형 1.00 ×4, 초반 질주형 0.90·0.97·1.04·1.09,
//   후반 스퍼트형 1.08·1.03·0.97·0.92, 중반 처짐형 0.96·1.07·1.06·0.91
// 기록은 250m마다 한 점이고, 구간 안에서는 같은 페이스로 달린 것으로 만들었다.
// 러너 유형(초반 질주형 등)은 기록에 따로 적지 않는다. 구간 페이스를 분석해서 나중에 붙이는 라벨이다.
//
// 캠프 참가자 기록은 동의를 받은 것만 넣는다. 등록 순번은 가상 러너(1~99)와 겹치지 않게 100번부터 쓴다.
import campRecordsJson from "@/data/camp-records.json";
import virtualRunnersJson from "@/data/virtual-runners.json";
import { validateRunRecord, type RunRecord, type RunSource } from "./record";

/**
 * 파일에서 읽은 값이 기록 목록의 모양을 지키는지 검사한다.
 * 문제가 있으면 어느 기록의 무엇이 문제인지 한국어로 적어 오류를 던진다.
 */
export function parseRunRecords(raw: unknown, expectedSource: RunSource, label: string): RunRecord[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${label}: 기록 목록(배열)이어야 한다`);
  }

  const problems: string[] = [];
  raw.forEach((item, index) => {
    const name = `${label} ${index + 1}번째 기록`;
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.id !== "string" ||
      !Array.isArray(item.points)
    ) {
      problems.push(`${name}: 기록 모양이 아니다`);
      return;
    }
    const record = item as RunRecord;
    if (record.source !== expectedSource) {
      problems.push(`${name}(${record.id}): 출처가 "${expectedSource}"이어야 한다`);
    }
    for (const problem of validateRunRecord(record)) {
      problems.push(`${name}(${record.id}): ${problem}`);
    }
  });

  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
  return raw as RunRecord[];
}

/** 기록들 사이에서 익명 이름표(id)와 등록 순번이 겹치지 않는지 검사한다 */
export function assertUniqueRecords(records: RunRecord[]): void {
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const record of records) {
    if (ids.has(record.id)) {
      throw new Error(`익명 이름표가 겹친다: ${record.id}`);
    }
    if (orders.has(record.registrationOrder)) {
      throw new Error(`등록 순번이 겹친다: ${record.registrationOrder} (${record.id})`);
    }
    ids.add(record.id);
    orders.add(record.registrationOrder);
  }
}

/** 가상 러너 기록 */
export const virtualRunners: RunRecord[] = parseRunRecords(
  virtualRunnersJson,
  "virtual",
  "data/virtual-runners.json",
);

/** 동의를 받은 캠프 참가자 기록 (아직 받은 것이 없으면 빈 목록) */
export const campRecords: RunRecord[] = parseRunRecords(
  campRecordsJson,
  "camp",
  "data/camp-records.json",
);

const opponentRecords: RunRecord[] = [...virtualRunners, ...campRecords];
assertUniqueRecords(opponentRecords);

/** 대결 상대가 될 수 있는 모든 기록 (가상 러너 + 캠프 참가자) */
export function getOpponentRecords(): RunRecord[] {
  return opponentRecords;
}
