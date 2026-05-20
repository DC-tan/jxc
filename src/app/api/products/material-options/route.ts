import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

/** 商品 BOM 选择器：轻量物料列表（需能查看商品即可选配档案物料） */
export async function GET() {
  const auth = await requirePermission("product.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const list = await prisma.material.findMany({
      where: { isDeprecated: false },
      orderBy: [{ code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        partDescription: true,
        unit: true,
        supplier: { select: { code: true, name: true } },
      },
    });

    return NextResponse.json({
      list: list.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        partDescription: m.partDescription,
        unit: m.unit,
        supplier: m.supplier,
      })),
    });
  } catch (e) {
    console.error("[GET /api/products/material-options]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
