import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

/** 物料设置页：一次性拉取种类、名称、品牌、单位 */
export async function GET() {
  try {
    const auth = await requirePermission("material.view");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const [kinds, names, brands, units] = await Promise.all([
      prisma.materialPresetKind.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.materialPresetName.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.materialPresetBrand.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.materialPresetUnit.findMany({ orderBy: { sortOrder: "asc" } }),
    ]);

    return NextResponse.json({ kinds, names, brands, units });
  } catch (e) {
    console.error("[GET /api/material-presets]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
