// 공유한 기록 지우기 (PLAN.md 작업 23): 올릴 때 받은 비밀 키(x-delete-token 헤더)가 맞아야 한다
import { getSharedStore } from "@/lib/shared";
import { removeRecord } from "@/lib/shared/service";

export async function DELETE(request: Request, ctx: RouteContext<"/api/shared-records/[id]">) {
  const { id } = await ctx.params;
  const token = request.headers.get("x-delete-token") ?? "";
  const result = await removeRecord(getSharedStore(), decodeURIComponent(id), token);
  if (result === "not-found") return Response.json({ message: "이미 지워졌거나 없는 기록입니다" }, { status: 404 });
  if (result === "forbidden") return Response.json({ message: "이 기기에서 올린 기록이 아닙니다" }, { status: 403 });
  return Response.json({ ok: true });
}
