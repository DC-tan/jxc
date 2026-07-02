import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildNoOrderShipOutInboundWhere,
  parseNoOrderDeliveryNoteNo,
} from "@/lib/warehouse-no-order-ship-out-query";

/** 送货单号：{简称}{YYYYMMDD}{三位流水} */
export function parseDeliveryNoteNo(
  documentNo: string,
): { year: number; seq: number } | null {
  const t = documentNo.trim();
  if (t.length < 12) return null;
  const tail = t.slice(-11);
  if (!/^\d{11}$/.test(tail)) return null;
  const year = Number(tail.slice(0, 4));
  const seq = Number(tail.slice(-3));
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  if (!Number.isFinite(seq) || seq < 1 || seq > 999) return null;
  return { year, seq };
}

export function resolveCustomerShortLabel(c: {
  shortName?: string | null;
  name?: string | null;
  code?: string | null;
}): string {
  const rawLabel =
    c.shortName?.trim() ||
    c.name?.trim().replace(/\s+/g, "").slice(0, 4) ||
    c.code?.trim() ||
    "K";
  return rawLabel.replace(/[-\s_/\\]+/g, "") || "K";
}

type DbClient = PrismaClient | Prisma.TransactionClient;

/** 从销售订单出货、无单出货备注中解析该客户指定年份的最大流水 */
export async function getMaxDeliveryNoteSeqForCustomerYear(
  db: DbClient,
  customerId: string,
  year: number,
): Promise<number> {
  let max = 0;

  const shipLogs = await db.salesOrderLineShipLog.findMany({
    where: {
      deliveryNoteNo: { not: null },
      salesOrderLine: { salesOrder: { customerId } },
    },
    select: { deliveryNoteNo: true },
  });
  for (const row of shipLogs) {
    const parsed = parseDeliveryNoteNo(row.deliveryNoteNo ?? "");
    if (parsed?.year === year) max = Math.max(max, parsed.seq);
  }

  const noOrderRows = await db.productInbound.findMany({
    where: buildNoOrderShipOutInboundWhere({ customerId }),
    select: { remark: true },
  });
  for (const row of noOrderRows) {
    const doc = parseNoOrderDeliveryNoteNo(row.remark);
    if (!doc) continue;
    const parsed = parseDeliveryNoteNo(doc);
    if (parsed?.year === year) max = Math.max(max, parsed.seq);
  }

  return max;
}

/**
 * 分配下一流水号（按客户 + 自然年）。
 * 若库内已有出货单号，从其最大流水继续递增；新年份从 001 起。
 */
export async function allocateDeliveryNoteSerial(
  db: PrismaClient,
  customerId: string,
  year: number,
): Promise<number> {
  return db.$transaction(async (tx) => {
    const seedMax = await getMaxDeliveryNoteSeqForCustomerYear(
      tx,
      customerId,
      year,
    );
    const existing = await tx.deliveryNoteSerial.findUnique({
      where: { customerId_year: { customerId, year } },
    });
    if (!existing) {
      const created = await tx.deliveryNoteSerial.create({
        data: { customerId, year, lastSeq: seedMax + 1 },
      });
      return created.lastSeq;
    }
    const next = Math.max(existing.lastSeq, seedMax) + 1;
    const updated = await tx.deliveryNoteSerial.update({
      where: { customerId_year: { customerId, year } },
      data: { lastSeq: next },
    });
    return updated.lastSeq;
  });
}
