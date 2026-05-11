import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const bodySchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1),
});

export async function POST(req: Request) {
  const auth = await requirePermission("warehouse.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const orderIds = [...new Set(parsed.data.orderIds)];

  try {
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      let revertedOrders = 0;
      let revertedShipmentQty = 0;

      for (const orderId of orderIds) {
        const order = await tx.salesOrder.findUnique({
          where: { id: orderId },
          include: {
            lines: {
              include: {
                shipLogs: true,
              },
            },
          },
        });
        if (!order) continue;

        const byProductId = new Map<string, number>();
        for (const ln of order.lines) {
          const shipped = ln.shipLogs.reduce((s, x) => s + x.quantity, 0);
          if (shipped <= 0) continue;
          byProductId.set(ln.productId, (byProductId.get(ln.productId) ?? 0) + shipped);
          revertedShipmentQty += shipped;
        }

        for (const [productId, qty] of byProductId.entries()) {
          await tx.productInbound.create({
            data: {
              productId,
              quantity: qty,
              receivedAt: now,
              purchaseOrderNo: order.customerOrderNo?.trim() || null,
              partDescription: "销售出货作废回退",
              remark: `作废回退 · ${order.customerOrderNo?.trim() || order.id}`,
              operatorUserId: auth.user.id,
            },
          });
        }

        for (const ln of order.lines) {
          await tx.salesOrderLineShipLog.deleteMany({
            where: { salesOrderLineId: ln.id },
          });
          await tx.salesOrderLine.update({
            where: { id: ln.id },
            data: { quantityShipped: 0 },
          });
        }
        await tx.salesOrder.update({
          where: { id: order.id },
          data: { actualDeliveredAt: null },
        });
        revertedOrders += 1;
      }

      return { revertedOrders, revertedShipmentQty };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[POST /api/warehouse/sales-orders/void]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "作废失败" },
      { status: 500 },
    );
  }
}

