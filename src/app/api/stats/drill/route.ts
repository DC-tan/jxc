import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { parseStatsRange, statsRangeQuerySchema } from "@/lib/stats-range";

const kindSchema = z.enum([
  "sales_in_range",
  "sales_delivered",
  "sales_open",
  "purchase_in_range",
  "ship_in_range",
  "outsource_in_range",
  "outsource_open",
]);

function poAmount(lines: { quantity: number; unitPrice: unknown }[]): number {
  return lines.reduce((s, l) => s + l.quantity * Number(l.unitPrice), 0);
}

const STATUS_TEXT: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_RECEIPT: "待收料",
  CONFIRMED: "已收料",
  CANCELLED: "已取消",
};

/**
 * 主指标卡片点击后明细（须 stats.view）。sales_open、outsource_open 不按时间区间。
 */
export async function GET(req: Request) {
  const auth = await requirePermission("stats.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const url = new URL(req.url);
  const kindRaw = url.searchParams.get("kind");
  const rangeParsed = statsRangeQuerySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  if (!rangeParsed.success) {
    return NextResponse.json({ error: "时间参数无效" }, { status: 400 });
  }
  const kind = kindSchema.safeParse(kindRaw);
  if (!kind.success) {
    return NextResponse.json({ error: "缺少或无效的 kind" }, { status: 400 });
  }

  const { from, to } = parseStatsRange(
    rangeParsed.data.from,
    rangeParsed.data.to,
  );
  const rangeNote = (() => {
    if (kind.data === "sales_open" || kind.data === "outsource_open")
      return "全库数据（不按上面统计区间）";
    return `${from.toISOString().slice(0, 10)} ～ ${to.toISOString().slice(0, 10)}`;
  })();

  try {
    if (kind.data === "sales_in_range") {
      const list = await prisma.salesOrder.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: "desc" },
        take: 2000,
        include: { customer: { select: { code: true, name: true } } },
      });
      return NextResponse.json({
        kind: kind.data,
        title: "销售单明细（本区间建单）",
        rangeNote,
        rows: list.map((o) => ({
          id: o.id,
          客户: o.customer.name || o.customer.code,
          客户订单编号: o.customerOrderNo?.trim() || "—",
          订单额: Number(o.totalAmount),
          建单时间: o.createdAt.toISOString(),
          实际交货: o.actualDeliveredAt?.toISOString() ?? "—",
        })),
      });
    }

    if (kind.data === "sales_delivered") {
      const list = await prisma.salesOrder.findMany({
        where: {
          actualDeliveredAt: { gte: from, lte: to, not: null },
        },
        orderBy: { actualDeliveredAt: "desc" },
        take: 2000,
        include: { customer: { select: { code: true, name: true } } },
      });
      return NextResponse.json({
        kind: kind.data,
        title: "整单已交清（实际交货时间落在本区间）",
        rangeNote,
        rows: list.map((o) => ({
          id: o.id,
          客户: o.customer.name || o.customer.code,
          客户订单编号: o.customerOrderNo?.trim() || "—",
          订单额: Number(o.totalAmount),
          实际交货: o.actualDeliveredAt?.toISOString() ?? "—",
        })),
      });
    }

    if (kind.data === "sales_open") {
      const list = await prisma.salesOrder.findMany({
        where: { actualDeliveredAt: null },
        orderBy: { createdAt: "desc" },
        take: 2000,
        include: { customer: { select: { code: true, name: true } } },
      });
      return NextResponse.json({
        kind: kind.data,
        title: "未结清销售单（全库未写实际交货）",
        rangeNote,
        rows: list.map((o) => ({
          id: o.id,
          客户: o.customer.name || o.customer.code,
          客户订单编号: o.customerOrderNo?.trim() || "—",
          订单额: Number(o.totalAmount),
          建单时间: o.createdAt.toISOString(),
        })),
      });
    }

    if (kind.data === "purchase_in_range") {
      const list = await prisma.purchaseOrder.findMany({
        where: {
          createdAt: { gte: from, lte: to },
          status: { not: "CANCELLED" },
        },
        orderBy: { createdAt: "desc" },
        take: 2000,
        include: {
          supplier: { select: { code: true, name: true } },
          lines: { select: { quantity: true, unitPrice: true } },
        },
      });
      return NextResponse.json({
        kind: kind.data,
        title: "采购单（本区间建单、非取消）",
        rangeNote,
        rows: list.map((o) => ({
          id: o.id,
          采购单号: o.orderNo,
          供应商: o.supplier?.name || o.supplier?.code || "—",
          采购额: poAmount(o.lines),
          状态: STATUS_TEXT[o.status] ?? o.status,
          建单时间: o.createdAt.toISOString(),
          实际收料: o.actualDeliveredAt?.toISOString() ?? "—",
        })),
      });
    }

    if (kind.data === "ship_in_range") {
      const logs = await prisma.salesOrderLineShipLog.findMany({
        where: { batchDeliveredAt: { gte: from, lte: to } },
        orderBy: { batchDeliveredAt: "desc" },
        take: 3000,
        include: {
          salesOrderLine: {
            include: {
              salesOrder: {
                include: { customer: { select: { code: true, name: true } } },
              },
            },
          },
        },
      });
      return NextResponse.json({
        kind: kind.data,
        title: "出货批次（本区间分批时间）",
        rangeNote,
        rows: logs.map((log) => {
          const o = log.salesOrderLine.salesOrder;
          return {
            id: log.id,
            批次时间: log.batchDeliveredAt.toISOString(),
            客户: o.customer.name || o.customer.code,
            客户订单编号: o.customerOrderNo?.trim() || "—",
            本批件数: log.quantity,
            备品: log.spareQty,
            送货单号: log.deliveryNoteNo?.trim() || "—",
          };
        }),
      });
    }

    if (kind.data === "outsource_in_range") {
      const list = await prisma.outsourceOrder.findMany({
        where: {
          createdAt: { gte: from, lte: to },
          status: { not: "CANCELLED" },
        },
        orderBy: { createdAt: "desc" },
        take: 2000,
        include: {
          product: { select: { model: true, customerMaterialCode: true } },
          supplier: { select: { name: true, code: true } },
        },
      });
      return NextResponse.json({
        kind: kind.data,
        title: "外发单（本区间建单、非取消）",
        rangeNote,
        rows: list.map((o) => ({
          id: o.id,
          外发单号: o.orderNo,
          商品: o.product.model?.trim() || o.product.customerMaterialCode || "—",
          外发套数: o.productQty,
          加工方: o.supplier?.name || o.supplier?.code || "—",
          状态: o.status === "OPEN" ? "未回收" : o.status === "CLOSED" ? "已回收" : "已取消",
          建单时间: o.createdAt.toISOString(),
        })),
      });
    }

    if (kind.data === "outsource_open") {
      const list = await prisma.outsourceOrder.findMany({
        where: { status: "OPEN" },
        orderBy: { createdAt: "desc" },
        take: 2000,
        include: {
          product: { select: { model: true, customerMaterialCode: true } },
          supplier: { select: { name: true, code: true } },
        },
      });
      return NextResponse.json({
        kind: kind.data,
        title: "未回收外发单（全库）",
        rangeNote,
        rows: list.map((o) => ({
          id: o.id,
          外发单号: o.orderNo,
          商品: o.product.model?.trim() || o.product.customerMaterialCode || "—",
          外发套数: o.productQty,
          加工方: o.supplier?.name || o.supplier?.code || "—",
          建单时间: o.createdAt.toISOString(),
        })),
      });
    }

    return NextResponse.json({ error: "unknown" }, { status: 500 });
  } catch (e) {
    console.error("[GET /api/stats/drill]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "查询失败" },
      { status: 500 },
    );
  }
}
