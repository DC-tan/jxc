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

/**
 * 单号固定前缀（不含流水）：`{prefix}-{供应商简称或编号}-`
 * 流水为年度流水：同一供应商、同一自然年（UTC）内从 001 递增。
 */
export function buildPurchaseOrderNoPrefix(
  rule: PurchaseOrderNumberRule,
  sup: { shortName: string | null; code: string; name: string },
): string {
  const mid = supplierMiddleSegment(sup, rule);
  return `${rule.prefix}-${mid}-`;
}

function utcYearBounds(when: Date): { gte: Date; lt: Date } {
  const y = when.getUTCFullYear();
  return {
    gte: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0)),
    lt: new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0, 0)),
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 从已存在的单号中解析「完全符合 `{prefix}{digits}`」的最大流水，返回下一流水。
 * 忽略旧版含日期的单号（无法匹配整单正则）。
 */
export function computeNextSequenceFromMatchingOrderNos(
  orderNos: string[],
  prefix: string,
  rule: PurchaseOrderNumberRule,
): number {
  const w = rule.sequenceDigits;
  const re = new RegExp(`^${escapeRegExp(prefix)}(\\d{${w}})$`);
  let max = 0;
  for (const no of orderNos) {
    const m = no.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const n = max > 0 ? max + 1 : Math.max(1, rule.startSequence);
  const cap = 10 ** w - 1;
  if (n > cap) {
    throw new Error(
      `${w} 位流水号已用尽（每年每供应商上限 ${cap}），请联系管理员`,
    );
  }
  return n;
}

export function formatOrderNoWithSequence(
  prefix: string,
  rule: PurchaseOrderNumberRule,
  sequence: number,
): string {
  return `${prefix}${String(sequence).padStart(rule.sequenceDigits, "0")}`;
}

type PurchaseOrderDb = Pick<PrismaClient, "purchaseOrder">;

/**
 * 按模板规则生成下一采购单号（不写库）。同一供应商、UTC 自然年内流水递增，每年重置。
 */
export async function generateNextPurchaseOrderNumber(
  db: PurchaseOrderDb,
  rule: PurchaseOrderNumberRule,
  supplierId: string,
  sup: { shortName: string | null; code: string; name: string },
  when: Date = new Date(),
): Promise<string> {
  const prefix = buildPurchaseOrderNoPrefix(rule, sup);
  const { gte, lt } = utcYearBounds(when);
  const rows = await db.purchaseOrder.findMany({
    where: {
      supplierId,
      createdAt: { gte, lt },
      orderNo: { startsWith: prefix },
    },
    select: { orderNo: true },
  });
  const seq = computeNextSequenceFromMatchingOrderNos(
    rows.map((r) => r.orderNo),
    prefix,
    rule,
  );
  return formatOrderNoWithSequence(prefix, rule, seq);
}

/**
 * 按全局模板中的规则生成新采购单号（每年每供应商独立流水，格式 GK-简称-001）。
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
