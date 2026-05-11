import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

/** 新建商品下拉：客户、单位（与物料设置共用） */
export async function GET() {
  try {
    const auth = await requirePermission("product.view");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const [customers, units] = await Promise.all([
      prisma.customer.findMany({
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true },
      }),
      prisma.materialPresetUnit.findMany({
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, isDefault: true, sortOrder: true },
      }),
    ]);

    return NextResponse.json({ customers, units });
  } catch (e) {
    console.error("[GET /api/product-presets]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
