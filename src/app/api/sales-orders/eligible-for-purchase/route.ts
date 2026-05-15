import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

/** 可选作采购源的销售订单：未出货完成、未标记无需采购、且从未关联过采购单 */
export async function GET() {
  const auth = await requirePermission("purchase.create");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const list = await prisma.salesOrder.findMany({
      where: {
        actualDeliveredAt: null,
        noPurchaseRequiredAt: null,
        purchaseOrders: { none: {} },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        customer: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
      },
    });

    return NextResponse.json({
      list: list.slice(0, 200).map((r) => ({
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
