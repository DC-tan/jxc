import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { parseStatsRange, statsRangeQuerySchema } from "@/lib/stats-range";
import {
  listNoOrderShipOutRows,
  noOrderShipOutToReconcileRow,
} from "@/lib/warehouse-no-order-ship-out-query";

const bodySchema = z.object({
  mode: z.enum(["whole", "split"]),
  customerId: z.string().optional().nullable(),
  ...statsRangeQuerySchema.shape,
});

export type WarehouseReconcileRow = {
  送货日期: string;
  送货单号: string;
  项目型号: string;
  订单数量: number;
  订单编号: string;
  商品型号: string;
  物料料号: string;
  单位: string;
  送货数量: number;
  单价: number;
  金额: number;
  备品数量: number;
};

const shipLogInclude = {
  salesOrderLine: {
    include: {
      product: {
        select: {
          model: true,
          customerMaterialCode: true,
          unit: true,
        },
      },
      salesOrder: {
        select: {
          customerOrderNo: true,
          customerModel: true,
          actualDeliveredAt: true,
        },
      },
    },
  },
} as const;

type ShipLogWithRelations = Prisma.SalesOrderLineShipLogGetPayload<{
  include: typeof shipLogInclude;
}>;

function shipLogToReconcileRow(log: ShipLogWithRelations): WarehouseReconcileRow {
  const line = log.salesOrderLine;
  const o = line.salesOrder;
  const u = Number(line.unitPrice);
  return {
    送货日期: log.batchDeliveredAt.toISOString(),
    送货单号: log.deliveryNoteNo?.trim() || "—",
    项目型号: o.customerModel?.trim() || "—",
    订单数量: line.quantity,
    订单编号: o.customerOrderNo?.trim() || "—",
    商品型号: line.product.model?.trim() || "—",
    物料料号: line.product.customerMaterialCode?.trim() || "—",
    单位: line.product.unit?.trim() || "—",
    送货数量: log.quantity,
    单价: u,
    金额: log.quantity * u,
    备品数量: log.spareQty,
  };
}

/**
 * 仓库出货对帐：以 `SalesOrderLineShipLog.batchDeliveredAt` 为实际出货时间；
 * 无单出货以 `ProductInbound` 负流水（备注/说明含「无单出货」）为准。
 * - split：区间内每条出货记录一行
 * - whole：销售整单 `actualDeliveredAt` 落在区间内时，列出该单全部出货批次（含区间外批次）
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
  const customerId = parsed.data.customerId?.trim() || undefined;

  try {
    const rows: WarehouseReconcileRow[] = [];

    if (mode === "whole") {
      const completedOrders = await prisma.salesOrder.findMany({
        where: {
          actualDeliveredAt: { gte: from, lte: to, not: null },
          ...(customerId ? { customerId } : {}),
        },
        select: { id: true },
        take: 5000,
      });
      const orderIds = completedOrders.map((o) => o.id);
      if (orderIds.length > 0) {
        const logs = await prisma.salesOrderLineShipLog.findMany({
          where: {
            salesOrderLine: { salesOrderId: { in: orderIds } },
          },
          orderBy: { batchDeliveredAt: "asc" },
          take: 15000,
          include: shipLogInclude,
        });
        for (const log of logs) {
          rows.push(shipLogToReconcileRow(log));
        }
      }
    } else {
      const logs = await prisma.salesOrderLineShipLog.findMany({
        where: {
          batchDeliveredAt: { gte: from, lte: to },
          ...(customerId
            ? {
                salesOrderLine: {
                  salesOrder: { customerId },
                },
              }
            : {}),
        },
        orderBy: { batchDeliveredAt: "asc" },
        take: 15000,
        include: shipLogInclude,
      });
      for (const log of logs) {
        rows.push(shipLogToReconcileRow(log));
      }
    }

    const noOrderRows = await listNoOrderShipOutRows(prisma, {
      from,
      to,
      customerId,
    });
    for (const r of noOrderRows) {
      rows.push(noOrderShipOutToReconcileRow(r));
    }

    rows.sort(
      (a, b) =>
        new Date(a.送货日期).getTime() - new Date(b.送货日期).getTime(),
    );

    const totalAmount = rows.reduce((s, r) => s + r.金额, 0);
    return NextResponse.json({
      rows,
      totalAmount,
      range: { from: from.toISOString(), to: to.toISOString() },
      mode,
    });
  } catch (e) {
    console.error("[POST /api/stats/reconcile/warehouse]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "查询失败" },
      { status: 500 },
    );
  }
}
