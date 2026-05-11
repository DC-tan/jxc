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
    const [suppliers, customers] = await Promise.all([
      prisma.supplier.findMany({
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true },
      }),
      prisma.customer.findMany({
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true },
      }),
    ]);
    return NextResponse.json({ suppliers, customers });
  } catch (e) {
    console.error("[GET /api/stats/reconcile/filters]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载筛选项失败" },
      { status: 500 },
    );
  }
}
