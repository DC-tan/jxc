import type { Prisma } from "@prisma/client";
import { supplierMiddleSegment } from "@/lib/purchase-order-number";
import { mergeOutsourcePrintConfig } from "@/lib/outsource-print-template";

const SINGLETON_ID = "singleton";

function dayCompact(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function utcYearBounds(when: Date): { gte: Date; lt: Date } {
  const y = when.getUTCFullYear();
  return {
    gte: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0)),
    lt: new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0, 0)),
  };
}

/** 未指定加工方供应商时：WF-YYYYMMDD-四位流水（按日），兼容旧数据 */
async function allocateOutsourceOrderNoLegacy(
  tx: Prisma.TransactionClient,
  when: Date,
): Promise<string> {
  const dateStr = dayCompact(when);
  const prefix = `WF-${dateStr}-`;
  const last = await tx.outsourceOrder.findFirst({
    where: { orderNo: { startsWith: prefix } },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  });
  let n = 1;
  const tailRe = /-(\d{4})$/;
  if (last?.orderNo.startsWith(prefix)) {
    const m = last.orderNo.match(tailRe);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  if (n > 9999) {
    throw new Error("当日外发单号流水已超过上限，请联系管理员");
  }
  return `${prefix}${String(n).padStart(4, "0")}`;
}

/**
 * 外发单号：
 * - 已选加工方（供应商）时：`{prefix}-{简称或编号}-{YYYYMMDD}-{年度流水}`，流水按 UTC 自然年、按该供应商递增；
 * - 未选加工方：`WF-YYYYMMDD-四位流水`（按日，兼容旧版）。
 */
export async function allocateOutsourceOrderNo(
  tx: Prisma.TransactionClient,
  when: Date = new Date(),
  supplierId?: string | null,
): Promise<string> {
  const sid = supplierId?.trim();
  if (!sid) {
    return allocateOutsourceOrderNoLegacy(tx, when);
  }

  const tpl = await tx.outsourcePrintTemplate.findUnique({
    where: { id: SINGLETON_ID },
    select: { config: true },
  });
  const rule = mergeOutsourcePrintConfig(tpl?.config ?? {}).orderNumberRule;

  const sup = await tx.supplier.findUnique({
    where: { id: sid },
    select: { shortName: true, code: true, name: true },
  });
  if (!sup) {
    throw new Error("供应商不存在");
  }

  const mid = supplierMiddleSegment(sup, rule);
  const stem = `${rule.prefix}-${mid}-`;
  const dateStr = dayCompact(when);
  const { gte, lt } = utcYearBounds(when);
  const w = rule.sequenceDigits;
  const re = new RegExp(`^${escapeRegExp(stem)}\\d{8}-(\\d{${w}})$`);

  const rows = await tx.outsourceOrder.findMany({
    where: {
      supplierId: sid,
      createdAt: { gte, lt },
    },
    select: { orderNo: true },
  });

  let max = 0;
  for (const r of rows) {
    const m = r.orderNo.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const n = max > 0 ? max + 1 : Math.max(1, rule.startSequence);
  const cap = 10 ** w - 1;
  if (n > cap) {
    throw new Error(
      `${w} 位流水号已用尽（每年每供应商上限 ${cap}），请联系管理员`,
    );
  }
  return `${stem}${dateStr}-${String(n).padStart(w, "0")}`;
}
