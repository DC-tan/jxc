import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthedUser } from "@/lib/api-auth";
import { getMaterialInboundTotalsByIds } from "@/lib/materialStock";

/**
 * 按物料 id 批量查询当前库存（入库汇总），供外发建单等界面使用。
 */
export async function GET(req: Request) {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 });
  }
  const can =
    user.isAdmin ||
    user.permissionCodes.has("material.view") ||
    user.permissionCodes.has("purchase.view") ||
    user.permissionCodes.has("purchase.create") ||
    user.permissionCodes.has("outsource.view") ||
    user.permissionCodes.has("outsource.create");
  if (!can) {
    return NextResponse.json({ error: "没有操作权限" }, { status: 403 });
  }

  const raw = new URL(req.url).searchParams.get("ids")?.trim() ?? "";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ stocks: {} as Record<string, number> });
  }
  if (ids.length > 200) {
    return NextResponse.json({ error: "一次最多查询 200 个物料" }, { status: 400 });
  }

  try {
    const map = await getMaterialInboundTotalsByIds(prisma, ids);
    const stocks: Record<string, number> = {};
    for (const id of ids) {
      stocks[id] = map.get(id) ?? 0;
    }
    return NextResponse.json({ stocks });
  } catch (e) {
    console.error("[GET /api/materials/stock-by-ids]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "查询失败" },
      { status: 500 },
    );
  }
}
