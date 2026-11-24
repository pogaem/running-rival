// 공유 기록 목록 보기(GET)와 올리기(POST) (PLAN.md 작업 23)
// 올리기는 공개 인터넷에 열려 있으므로 다음을 지킨다: JSON만 받기, 다른 사이트에서 온 요청 거절, 본문 크기 제한, 접속 주소별 속도 제한.
import { createHmac } from "node:crypto";
import { getSharedStore } from "@/lib/shared";
import { listRecords, submitRecord } from "@/lib/shared/service";

/** 올리기 본문의 최대 크기(바이트). 정상 기록은 400점 × 약 30바이트라 12KB 안팎이다 */
export const MAX_BODY_BYTES = 64 * 1024;

export async function GET() {
  const records = await listRecords(getSharedStore());
  // 매번 수 MB를 받지 않도록 잠깐(60초) 같이 쓴다. 새 기록은 길어도 1분 뒤에 보인다
  return Response.json({ records }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}

/** 접속 주소를 그대로 저장하지 않고 한 번 뒤섞은 값으로만 쓴다 (속도 제한용) */
function ipHashOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "dev").update(ip).digest("hex").slice(0, 32);
}

/** 거절·실패를 서버 로그(Vercel 대시보드)에 남긴다. 접속 주소나 기록 내용은 남기지 않는다 */
function reject(status: number, message: string, why: string): Response {
  console.warn(`[shared-records] POST 거절 ${status}: ${why}`);
  return Response.json({ message }, { status });
}

/** 다른 사이트의 화면에서 몰래 보낸 요청이면 true. 브라우저는 올리기 요청에 Origin을 붙여 보낸다 */
function isCrossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false; // 브라우저가 아닌 도구(curl 등). 이쪽은 속도 제한이 막는다
  try {
    return new URL(origin).host !== (request.headers.get("host") ?? new URL(request.url).host);
  } catch {
    return true;
  }
}

export async function POST(request: Request) {
  if (isCrossSite(request)) return reject(403, "허용되지 않은 요청입니다", "다른 사이트에서 온 요청");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return reject(415, "JSON으로 보내 주세요", "JSON이 아닌 형식");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return reject(413, "내용이 너무 큽니다", "본문 크기 초과(머리글)");

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return reject(413, "내용이 너무 큽니다", "본문 크기 초과");
    body = JSON.parse(text);
  } catch {
    return reject(400, "요청 내용을 읽을 수 없습니다", "JSON 해석 실패");
  }
  const result = await submitRecord(getSharedStore(), body, ipHashOf(request));
  if (!result.ok) return reject(result.status, result.message, result.status === 429 ? "속도 제한" : result.status === 507 ? "저장소 가득 참" : "내용 검증 실패");
  return Response.json({ id: result.id, deleteToken: result.deleteToken }, { status: 201 });
}
