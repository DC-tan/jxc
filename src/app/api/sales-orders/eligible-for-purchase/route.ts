import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

/**
 * 若销售订单下存在「由本单拆分生成」的采购单，且所有未取消的采购单均已收料确认，则不再允许从本单新建采购（下拉中隐藏）。
 */
function salesOrderStillEligibleForNewPurchaseFromWizard(
  purchaseStatuses: { status: string }[],
): boolean {
  const active = purchaseStatuses
    .map((p) => p.status)
    .filter((s) => s !== "CANCELLED");
  if (active.length === 0) return true;
  return active.some((s) => s !== "CONFIRMED");
}

/** 可选作采购源的销售订单：未出货完成，且非「关联采购单均已收料确认」 */
export async function GET() {
  const auth = await requirePermission("purchase.create");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const list = await prisma.salesOrder.findMany({
      where: { actualDeliveredAt: null, noPurchaseRequiredAt: null },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        customer: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
        purchaseOrders: { select: { status: true } },
      },
    });

    const filtered = list.filter((r) =>
      salesOrderStillEligibleForNewPurchaseFromWizard(r.purchaseOrders),
    );

    return NextResponse.json({
      list: filtered.slice(0, 200).map((r) => ({
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
