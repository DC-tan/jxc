import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { queryMaterialInventoryList } from "@/lib/materialInventoryQuery";

/**
 * 商品 BOM：从「物料库存」多选时的列表与筛选（与物料信息-物料库存一致，权限为可查看商品）
 */
export async function GET(req: Request) {
  try {
    const auth = await requirePermission("product.view");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const { searchParams } = new URL(req.url);
    const bomPickerParams = new URLSearchParams(searchParams);
    bomPickerParams.set("deprecated", "0");
    const rows = await queryMaterialInventoryList(bomPickerParams);
    const kinds = await prisma.materialPresetKind.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    });

    return NextResponse.json({ list: rows, kinds });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "查询库存失败";
    if (
      msg === "入库开始时间无效" ||
      msg === "入库结束时间无效"
    ) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("[GET /api/products/material-inventory]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
