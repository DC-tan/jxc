import dayjs from "dayjs";
import type { PrismaClient } from "@prisma/client";
import type { DeliveryNoteLiveSlip } from "@/lib/delivery-note-voucher";
import { buildDeliveryLineRemarkText } from "@/lib/warehouse-delivery-remark";
import type { WarehouseDeliveryLineDraft } from "@/lib/warehouse-delivery-draft";
import {
  buildNoOrderShipOutInboundWhere,
  parseNoOrderDeliveryNoteNo,
} from "@/lib/warehouse-no-order-ship-out-query";
import { resolveCustomerShortLabel } from "@/lib/delivery-note-sequence";

export type DeliveryNoteVoucherFallbackResult = {
  liveSlip: DeliveryNoteLiveSlip;
  customerId: string;
  deliveredAt: Date;
  mergedShip: boolean;
  orderIds: string[];
  source: "ship_logs" | "no_order";
};

/** 无存档凭证时，从销售出货记录或无单出货流水还原送货单（只读预览） */
export async function buildLiveSlipFromDeliveryNoteNo(
  db: PrismaClient,
  documentNo: string,
): Promise<DeliveryNoteVoucherFallbackResult | null> {
  const doc = documentNo.trim();
  if (!doc) return null;

  const fromShipLogs = await buildFromSalesShipLogs(db, doc);
  if (fromShipLogs) return fromShipLogs;

  return buildFromNoOrderShipOut(db, doc);
}

async function buildFromSalesShipLogs(
  db: PrismaClient,
  documentNo: string,
): Promise<DeliveryNoteVoucherFallbackResult | null> {
  const logs = await db.salesOrderLineShipLog.findMany({
    where: { deliveryNoteNo: documentNo },
    include: {
      salesOrderLine: {
        include: {
          salesOrder: {
            select: {
              id: true,
              customerOrderNo: true,
              customer: { select: { id: true, code: true, name: true, shortName: true } },
            },
          },
          product: {
            select: {
              model: true,
              spec: true,
              customerMaterialCode: true,
              unit: true,
              productRemark: true,
            },
          },
        },
      },
    },
    orderBy: [
      { batchDeliveredAt: "asc" },
      { salesOrderLine: { salesOrderId: "asc" } },
      { salesOrderLineId: "asc" },
    ],
  });
  if (logs.length === 0) return null;

  const batchAt = logs[0]!.batchDeliveredAt;
  const lineIds = [...new Set(logs.map((l) => l.salesOrderLineId))];
  const priorLogs = await db.salesOrderLineShipLog.findMany({
    where: {
      salesOrderLineId: { in: lineIds },
      batchDeliveredAt: { lt: batchAt },
    },
    select: { salesOrderLineId: true, quantity: true },
  });
  const priorByLine = new Map<string, number>();
  for (const p of priorLogs) {
    priorByLine.set(
      p.salesOrderLineId,
      (priorByLine.get(p.salesOrderLineId) ?? 0) + Math.max(0, p.quantity),
    );
  }

  const orderIds = [...new Set(logs.map((l) => l.salesOrderLine.salesOrder.id))];
  const customer = logs[0]!.salesOrderLine.salesOrder.customer;
  const slipLines: DeliveryNoteLiveSlip["lines"] = [];

  for (const log of logs) {
    const ln = log.salesOrderLine;
    const prod = ln.product;
    const row: WarehouseDeliveryLineDraft = {
      lineId: ln.id,
      shipQty: log.quantity,
      ...(log.spareQty > 0 ? { spareQty: log.spareQty } : {}),
    };
    const remark = buildDeliveryLineRemarkText({
      line: row,
      orderLine: {
        quantity: ln.quantity,
        remark: ln.remark,
        product: prod,
      },
      effShippedBefore: priorByLine.get(ln.id) ?? 0,
    });
    const nameSpec = [prod.model?.trim(), prod.spec?.trim()].filter(Boolean).join(" ");
    slipLines.push({
      orderNo: ln.salesOrder.customerOrderNo?.trim() || "—",
      materialCode: prod.customerMaterialCode?.trim() || "—",
      nameSpec: nameSpec || "—",
      unit: prod.unit || "—",
      quantity: String(Math.max(0, log.quantity)),
      remark,
    });
  }

  if (slipLines.length === 0) return null;

  return {
    liveSlip: {
      customerName: customer.name || customer.code,
      dateStr: dayjs(batchAt).format("YYYY-MM-DD"),
      documentNo,
      issuerName: "—",
      lines: slipLines,
    },
    customerId: customer.id,
    deliveredAt: batchAt,
    mergedShip: orderIds.length > 1,
    orderIds,
    source: "ship_logs",
  };
}

async function buildFromNoOrderShipOut(
  db: PrismaClient,
  documentNo: string,
): Promise<DeliveryNoteVoucherFallbackResult | null> {
  const candidates = await db.productInbound.findMany({
    where: {
      AND: [
        buildNoOrderShipOutInboundWhere({}),
        { remark: { contains: documentNo } },
      ],
    },
    select: {
      id: true,
      quantity: true,
      receivedAt: true,
      purchaseOrderNo: true,
      remark: true,
      product: {
        select: {
          id: true,
          model: true,
          spec: true,
          customerMaterialCode: true,
          unit: true,
          customerId: true,
          customer: { select: { id: true, code: true, name: true, shortName: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const anchor = candidates.find(
    (r) => parseNoOrderDeliveryNoteNo(r.remark)?.trim() === documentNo,
  );
  if (!anchor) return null;

  const batch = await db.productInbound.findMany({
    where: {
      AND: [
        buildNoOrderShipOutInboundWhere({ customerId: anchor.product.customerId }),
        { receivedAt: anchor.receivedAt },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: {
      quantity: true,
      purchaseOrderNo: true,
      remark: true,
      product: {
        select: {
          model: true,
          spec: true,
          customerMaterialCode: true,
          unit: true,
        },
      },
    },
  });

  const lines: DeliveryNoteLiveSlip["lines"] = [];
  for (const r of batch) {
    const doc = parseNoOrderDeliveryNoteNo(r.remark)?.trim();
    if (doc !== documentNo) continue;
    const shipQty = Math.abs(Number(r.quantity) || 0);
    if (shipQty <= 0) continue;
    const prod = r.product;
    const nameSpec = [prod.model?.trim(), prod.spec?.trim()].filter(Boolean).join(" ");
    lines.push({
      orderNo: r.purchaseOrderNo?.trim() || "—",
      materialCode: prod.customerMaterialCode?.trim() || "—",
      nameSpec: nameSpec || "—",
      unit: prod.unit || "—",
      quantity: String(shipQty),
      remark: r.remark?.trim() || "",
    });
  }
  if (lines.length === 0) return null;

  const customer = anchor.product.customer;
  return {
    liveSlip: {
      customerName: customer.name || customer.code,
      dateStr: dayjs(anchor.receivedAt).format("YYYY-MM-DD"),
      documentNo,
      issuerName: "—",
      lines,
    },
    customerId: customer.id,
    deliveredAt: anchor.receivedAt,
    mergedShip: false,
    orderIds: [],
    source: "no_order",
  };
}

/** 解析送货单号中的客户简称（用于诊断提示） */
export function guessCustomerLabelFromDocumentNo(documentNo: string): string | null {
  const t = documentNo.trim();
  if (t.length < 12) return null;
  const tail = t.slice(-11);
  if (!/^\d{11}$/.test(tail)) return null;
  const label = t.slice(0, -11).trim();
  return label || null;
}

export { resolveCustomerShortLabel };
