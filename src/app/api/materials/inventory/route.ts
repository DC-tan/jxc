import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/api-auth";
import { queryMaterialInventoryList } from "@/lib/materialInventoryQuery";

export async function GET(req: Request) {
  try {
    const auth = await requirePermission("material.view");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const { searchParams } = new URL(req.url);
    const rows = await queryMaterialInventoryList(searchParams);
    return NextResponse.json({ list: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "查询库存失败";
    if (
      msg === "入库开始时间无效" ||
      msg === "入库结束时间无效"
    ) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("[GET /api/materials/inventory]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
