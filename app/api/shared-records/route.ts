// 공유 기록 목록 보기(GET)와 올리기(POST) (PLAN.md 작업 23)
import { getSharedStore } from "@/lib/shared";
import { listRecords, submitRecord } from "@/lib/shared/service";

export async function GET() {
  return Response.json({ records: await listRecords(getSharedStore()) });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "요청 내용을 읽을 수 없습니다" }, { status: 400 });
  }
  const result = await submitRecord(getSharedStore(), body);
  if (!result.ok) return Response.json({ message: result.message }, { status: result.status });
  return Response.json({ id: result.id, deleteToken: result.deleteToken }, { status: 201 });
}
