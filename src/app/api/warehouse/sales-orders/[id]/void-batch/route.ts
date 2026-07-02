import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const bodySchema = z.object({
  batchDeliveredAt: z.string().min(1),
  deliveryNoteNo: z.string().optional().nullable(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("warehouse.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;
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
  const at = new Date(parsed.data.batchDeliveredAt);
  if (Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: "批次时间无效" }, { status: 400 });
  }
  const deliveryNoteNo = parsed.data.deliveryNoteNo?.trim() || null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUnique({
        where: { id },
        include: {
          lines: {
            include: {
              shipLogs: {
                where: {
                  batchDeliveredAt: at,
                  ...(deliveryNoteNo
                    ? { deliveryNoteNo }
                    : {}),
                },
              },
            },
          },
        },
      });
      if (!order) {
        return { ok: false as const, status: 404, error: "销售订单不存在" };
      }

      let revertedQty = 0;
      const productBackfill = new Map<string, number>();
      for (const ln of order.lines) {
        const batchQty = ln.shipLogs.reduce((s, x) => s + x.quantity, 0);
        const batchSpareQty = ln.shipLogs.reduce(
          (s, x) => s + Math.max(0, Math.trunc(Number(x.spareQty ?? 0))),
          0,
        );
        const batchOutboundQty = batchQty + batchSpareQty;
        if (batchOutboundQty <= 0) continue;
        const nextShipped = Math.max(0, ln.quantityShipped - batchQty);
        await tx.salesOrderLine.update({
          where: { id: ln.id },
          data: { quantityShipped: nextShipped },
        });
        await (
          tx as unknown as {
            salesOrderLineShipLog: {
              deleteMany: (args: { where: object }) => Promise<unknown>;
            };
          }
        ).salesOrderLineShipLog.deleteMany({
          where: {
            salesOrderLineId: ln.id,
            batchDeliveredAt: at,
            ...(deliveryNoteNo ? { deliveryNoteNo } : {}),
          },
        });
        productBackfill.set(
          ln.productId,
          (productBackfill.get(ln.productId) ?? 0) + batchOutboundQty,
        );
        revertedQty += batchOutboundQty;
      }

      if (revertedQty <= 0) {
        return { ok: false as const, status: 400, error: "未找到可作废的该批出货记录" };
      }

      const now = new Date();
      if (deliveryNoteNo) {
        await (
          tx as unknown as {
            deliveryNoteVoucher: {
              updateMany: (args: {
                where: object;
                data: object;
              }) => Promise<unknown>;
            };
          }
        ).deliveryNoteVoucher.updateMany({
          where: { documentNo: deliveryNoteNo, voidedAt: null },
          data: { voidedAt: now },
        });
      }

      for (const [productId, qty] of productBackfill.entries()) {
        await tx.productInbound.create({
          data: {
            productId,
            quantity: qty,
            receivedAt: now,
            purchaseOrderNo: order.customerOrderNo?.trim() || null,
            partDescription: "销售出货作废回退（单批）",
            remark: `作废批次 · ${dayjsLike(at)}${deliveryNoteNo ? ` · ${deliveryNoteNo}` : ""}`,
            operatorUserId: auth.user.id,
          },
        });
      }

      const fresh = await tx.salesOrder.findUnique({
        where: { id: order.id },
        include: { lines: true },
      });
      if (fresh) {
        const allClear = fresh.lines.every((l) => l.quantityShipped >= l.quantity);
        if (!allClear) {
          await tx.salesOrder.update({
            where: { id: fresh.id },
            data: { actualDeliveredAt: null },
          });
        }
      }

      return { ok: true as const, revertedQty };
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, revertedQty: result.revertedQty });
  } catch (e) {
    console.error("[POST /api/warehouse/sales-orders/[id]/void-batch]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "作废失败" },
      { status: 500 },
    );
  }
}

function dayjsLike(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

