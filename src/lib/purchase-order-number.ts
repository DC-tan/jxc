import type { Prisma, PrismaClient } from "@prisma/client";
import type { PurchaseOrderNumberRule } from "@/lib/purchase-print-template";
import { mergePurchasePrintConfig } from "@/lib/purchase-print-template";

const SINGLETON_ID = "singleton";

/** 订单号中间段：避免非法文件名字符 */
export function sanitizeOrderNoSegment(raw: string): string {
  const s = raw
    .trim()
    .replace(/[\s\\/:*?"<>|]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (s || "NA").slice(0, 32);
}

export function supplierMiddleSegment(
  sup: { shortName: string | null; code: string; name: string },
  rule: PurchaseOrderNumberRule,
): string {
  const raw = rule.useShortName
    ? (sup.shortName?.trim() || sup.code.trim())
    : sup.code.trim();
  return sanitizeOrderNoSegment(raw || sup.name.trim() || "NA");
}

/** 本地日历年月紧凑串，如 202608 */
export function formatOrderNoYearMonth(when: Date): string {
  const y = when.getFullYear();
  const m = String(when.getMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

/**
 * 单号供应商段前缀（不含年月与流水）：`{prefix}-{供应商简称或编号}-`
 */
export function buildPurchaseOrderNoPrefix(
  rule: PurchaseOrderNumberRule,
  sup: { shortName: string | null; code: string; name: string },
): string {
  const mid = supplierMiddleSegment(sup, rule);
  return `${rule.prefix}-${mid}-`;
}

/**
 * 含当月年月的取号前缀（不含流水）：`{prefix}-{供应商}-{YYYYMM}`
 * 例：`GK-DC-202608`
 */
export function buildPurchaseOrderNoPeriodPrefix(
  rule: PurchaseOrderNumberRule,
  sup: { shortName: string | null; code: string; name: string },
  when: Date = new Date(),
): string {
  return `${buildPurchaseOrderNoPrefix(rule, sup)}${formatOrderNoYearMonth(when)}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 从当年同前缀单号中取最大流水 +1。
 * 匹配 `{stem}{YYYY}{MM}{流水}`（如 GK-DC-202608001 / GK-DC-202609002），
 * 跨月连续，跨年重置；旧版无年月单号不参与。
 */
export function computeNextSequenceFromMatchingOrderNos(
  orderNos: string[],
  stem: string,
  year: number,
  rule: PurchaseOrderNumberRule,
): number {
  const w = rule.sequenceDigits;
  const re = new RegExp(
    `^${escapeRegExp(stem)}${year}(\\d{2})(\\d{${w}})$`,
  );
  let max = 0;
  for (const no of orderNos) {
    const m = no.match(re);
    if (m) max = Math.max(max, parseInt(m[2], 10));
  }
  const n = max > 0 ? max + 1 : Math.max(1, rule.startSequence);
  const cap = 10 ** w - 1;
  if (n > cap) {
    throw new Error(
      `${w} 位流水号已用尽（每年每前缀上限 ${cap}），请联系管理员`,
    );
  }
  return n;
}

export function formatOrderNoWithSequence(
  periodPrefix: string,
  rule: PurchaseOrderNumberRule,
  sequence: number,
): string {
  return `${periodPrefix}${String(sequence).padStart(rule.sequenceDigits, "0")}`;
}

type PurchaseOrderDb = Pick<PrismaClient, "purchaseOrder">;

/**
 * 按模板规则生成下一采购单号（不写库）。
 * 格式：`{前缀}-{供应商}-{YYYYMM}{流水}`，如 GK-DC-202608001。
 * 流水按自然年、按前缀连续递增（跨月不重置）；跨年从 startSequence 起。
 * 单号中的年月始终为开单当月。
 */
export async function generateNextPurchaseOrderNumber(
  db: PurchaseOrderDb,
  rule: PurchaseOrderNumberRule,
  _supplierId: string,
  sup: { shortName: string | null; code: string; name: string },
  when: Date = new Date(),
): Promise<string> {
  const stem = buildPurchaseOrderNoPrefix(rule, sup);
  const year = when.getFullYear();
  const yearPrefix = `${stem}${year}`;
  const periodPrefix = buildPurchaseOrderNoPeriodPrefix(rule, sup, when);

  const rows = await db.purchaseOrder.findMany({
    where: { orderNo: { startsWith: yearPrefix } },
    select: { orderNo: true },
  });
  const seq = computeNextSequenceFromMatchingOrderNos(
    rows.map((r) => r.orderNo),
    stem,
    year,
    rule,
  );
  return formatOrderNoWithSequence(periodPrefix, rule, seq);
}

/**
 * 按全局模板规则生成新采购单号（格式 GK-DC-202608001）。
 */
export async function allocatePurchaseOrderNo(
  tx: Prisma.TransactionClient,
  supplierId: string,
): Promise<string> {
  const tpl = await tx.purchasePrintTemplate.findUnique({
    where: { id: SINGLETON_ID },
    select: { config: true },
  });
  const { orderNumberRule: rule } = mergePurchasePrintConfig(tpl?.config ?? {});

  const sup = await tx.supplier.findUnique({
    where: { id: supplierId },
    select: { shortName: true, code: true, name: true },
  });
  if (!sup) {
    throw new Error("供应商不存在");
  }

  return generateNextPurchaseOrderNumber(tx, rule, supplierId, sup, new Date());
}
