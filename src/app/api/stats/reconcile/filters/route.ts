import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

/**
 * 对帐页下拉：供应商 / 客户（仅需统计查看权限，避免依赖 supplier.view / customer.view）
 */
export async function GET() {
  const auth = await requirePermission("stats.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const [suppliers, customers, materials] = await Promise.all([
      prisma.supplier.findMany({
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true, shortName: true, priceIncludesTax: true },
      }),
      prisma.customer.findMany({
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true, shortName: true, priceIncludesTax: true },
      }),
      prisma.material.findMany({
        where: { isDeprecated: false },
        select: { name: true, partDescription: true },
        orderBy: { name: "asc" },
      }),
    ]);
    const materialNames = [
      ...new Set(materials.map((m) => m.name.trim()).filter((n) => n.length > 0)),
    ].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const partDescriptions = [
      ...new Set(
        materials
          .map((m) => m.partDescription?.trim() ?? "")
          .filter((d) => d.length > 0),
      ),
    ].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    return NextResponse.json({
      suppliers,
      customers,
      purchaseMaterialNames: materialNames,
      purchasePartDescriptions: partDescriptions,
    });
  } catch (e) {
    console.error("[GET /api/stats/reconcile/filters]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载筛选项失败" },
      { status: 500 },
    );
  }
}
