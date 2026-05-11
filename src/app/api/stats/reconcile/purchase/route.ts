import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { parseStatsRange, statsRangeQuerySchema } from "@/lib/stats-range";

const bodySchema = z.object({
  mode: z.enum(["whole", "split"]),
  supplierId: z.string().optional().nullable(),
  ...statsRangeQuerySchema.shape,
});

export type PurchaseReconcileRow = {
  交货日期: string;
  采购订单号: string;
  订单数量: number;
  物料名称: string;
  部件描述: string;
  交货数量: number;
  单价: number;
  金额: number;
};

/**
 * 采购对帐：以物料入库 `receivedAt` 为实收时间。
 * - split：区间内每笔收料各一行
 * - whole：仅整单已收料且 `actualDeliveredAt` 落在区间内的订单明细分行
 */
export async function POST(req: Request) {
  const auth = await requirePermission("stats.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请提交 JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  const { from, to } = parseStatsRange(parsed.data.from, parsed.data.to);
  const mode = parsed.data.mode;
  const supplierId = parsed.data.supplierId?.trim() || undefined;

  try {
    const rows: PurchaseReconcileRow[] = [];

    if (mode === "split") {
      const inbounds = await prisma.materialInbound.findMany({
        where: {
          receivedAt: { gte: from, lte: to },
          quantity: { gt: 0 },
          purchaseOrderNo: { not: null },
        },
        orderBy: { receivedAt: "asc" },
        take: 10000,
      });

      const orderNos = [
        ...new Set(inbounds.map((i) => i.purchaseOrderNo).filter(Boolean) as string[]),
      ];
      if (orderNos.length === 0) {
        return NextResponse.json({
          rows: [],
          totalAmount: 0,
          range: { from: from.toISOString(), to: to.toISOString() },
          mode,
        });
      }

      const pos = await prisma.purchaseOrder.findMany({
        where: {
          orderNo: { in: orderNos },
          status: { not: "CANCELLED" },
          ...(supplierId ? { supplierId } : {}),
        },
        include: {
          lines: {
            include: { material: { select: { name: true, partDescription: true } } },
          },
        },
      });
      const byOrderNo = new Map(pos.map((p) => [p.orderNo, p]));

      for (const m of inbounds) {
        const on = m.purchaseOrderNo;
        if (!on) continue;
        const po = byOrderNo.get(on);
        if (!po) continue;
        const line = po.lines.find((l) => l.materialId === m.materialId);
        if (!line) continue;
        const u = Number(line.unitPrice);
        const amt = m.quantity * u;
        rows.push({
          交货日期: m.receivedAt.toISOString(),
          采购订单号: on,
          订单数量: line.quantity,
          物料名称: line.material.name?.trim() || "—",
          部件描述: line.material.partDescription?.trim() || "—",
          交货数量: m.quantity,
          单价: u,
          金额: amt,
        });
      }
    } else {
      const orders = await prisma.purchaseOrder.findMany({
        where: {
          status: "CONFIRMED",
          actualDeliveredAt: { gte: from, lte: to, not: null },
          ...(supplierId ? { supplierId } : {}),
        },
        orderBy: { actualDeliveredAt: "asc" },
        take: 2000,
        include: {
          lines: {
            orderBy: { sortOrder: "asc" },
            include: { material: { select: { name: true, partDescription: true } } },
          },
        },
      });

      for (const po of orders) {
        const delAt = po.actualDeliveredAt!.toISOString();
        for (const line of po.lines) {
          const u = Number(line.unitPrice);
          const amt = line.quantity * u;
          rows.push({
            交货日期: delAt,
            采购订单号: po.orderNo,
            订单数量: line.quantity,
            物料名称: line.material.name?.trim() || "—",
            部件描述: line.material.partDescription?.trim() || "—",
            交货数量: line.quantity,
            单价: u,
            金额: amt,
          });
        }
      }
    }

    const totalAmount = rows.reduce((s, r) => s + r.金额, 0);
    return NextResponse.json({
      rows,
      totalAmount,
      range: { from: from.toISOString(), to: to.toISOString() },
      mode,
    });
  } catch (e) {
    console.error("[POST /api/stats/reconcile/purchase]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "查询失败" },
      { status: 500 },
    );
  }
}
