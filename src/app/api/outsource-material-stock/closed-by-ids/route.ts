import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthedUser } from "@/lib/api-auth";
import { sumOutsourceStockByMaterialIds } from "@/lib/outsource-material-stock-query";

/**
 * 按加工方 + 物料 ids 批量查询外发物料库存（与「外发物料库存」页同一公式）。
 */
export async function GET(req: Request) {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 });
  }
  const can =
    user.isAdmin ||
    user.permissionCodes.has("outsource.view") ||
    user.permissionCodes.has("outsource.create") ||
    user.permissionCodes.has("outsource.edit");
  if (!can) {
    return NextResponse.json({ error: "没有操作权限" }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const idsRaw = sp.get("ids")?.trim() ?? "";
  const supplierRaw = sp.get("supplierId")?.trim();
  const supplierId =
    !supplierRaw
      ? undefined
      : supplierRaw.toUpperCase() === "NONE"
        ? null
        : supplierRaw;
  const ids = idsRaw
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
    const qtyMap = await sumOutsourceStockByMaterialIds(
      prisma,
      ids,
      supplierId,
    );
    const stocks: Record<string, number> = {};
    for (const id of ids) {
      stocks[id] = qtyMap.get(id) ?? 0;
    }
    return NextResponse.json({ stocks });
  } catch (e) {
    console.error("[GET /api/outsource-material-stock/closed-by-ids]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "查询失败" },
      { status: 500 },
    );
  }
}
