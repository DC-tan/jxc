import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { salesOrderEligibleForNewPurchase } from "@/lib/purchase-sales-eligibility";

/**
 * 可选作采购源的销售订单：
 * - 未整单出货、未标记无需采购
 * - 从未下过采购单 → 显示
 * - 有效采购单已覆盖全部 BOM 需求 → 不显示
 * - 删除了部分采购单 / 仍有未覆盖物料 / 存在已取消单需补开 → 显示
 */
export async function GET() {
  const auth = await requirePermission("purchase.create");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const candidates = await prisma.salesOrder.findMany({
      where: {
        actualDeliveredAt: null,
        noPurchaseRequiredAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        customer: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
        purchaseOrders: { select: { status: true } },
      },
    });

    const eligible: typeof candidates = [];
    for (const r of candidates) {
      const ok = await salesOrderEligibleForNewPurchase(
        prisma,
        r.id,
        r.purchaseOrders,
      );
      if (ok) eligible.push(r);
      if (eligible.length >= 200) break;
    }

    return NextResponse.json({
      list: eligible.map((r) => ({
        id: r.id,
        customerOrderNo: r.customerOrderNo,
        customerModel: r.customerModel,
        deliveryDueAt: r.deliveryDueAt?.toISOString() ?? null,
        customer: r.customer,
        lineCount: r._count.lines,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    console.error("[GET /api/sales-orders/eligible-for-purchase]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
