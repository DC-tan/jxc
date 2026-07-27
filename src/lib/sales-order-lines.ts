import type { Prisma } from "@prisma/client";
import { z } from "zod";

export const salesOrderLineInputSchema = z.object({
  lineKind: z.enum(["PRODUCT", "EXTRA"]).optional().default("PRODUCT"),
  productId: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  quantity: z.union([z.number(), z.string()]),
  unitPrice: z.union([z.number(), z.string()]).optional(),
  remark: z.string().optional().nullable(),
});

export type SalesOrderLineInput = z.infer<typeof salesOrderLineInputSchema>;

function toDecimal(v: unknown, fallback = "0"): string {
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return String(v);
}

function toPositiveInt(v: unknown, fallback = 1): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export type NormalizedSalesOrderLineCreate = {
  productId: string | null;
  lineKind: "PRODUCT" | "EXTRA";
  title: string | null;
  quantity: number;
  unitPrice: string;
  remark: string | null;
  sortOrder: number;
};

/**
 * 校验并规范化销售明细行：至少一行 PRODUCT；EXTRA 要求 title、无 productId。
 * 返回错误文案，或 { lines, totalAmount }。
 */
export function normalizeSalesOrderLines(
  rawLines: SalesOrderLineInput[],
):
  | { error: string }
  | { lines: NormalizedSalesOrderLineCreate[]; totalAmount: number } {
  const productCount = rawLines.filter(
    (l) => (l.lineKind ?? "PRODUCT") !== "EXTRA",
  ).length;
  if (productCount < 1) {
    return { error: "请至少添加一行商品" };
  }

  let totalAmount = 0;
  const lines: NormalizedSalesOrderLineCreate[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    const kind = l.lineKind ?? "PRODUCT";
    const qty = toPositiveInt(l.quantity, 1);
    const upStr = toDecimal(l.unitPrice ?? 0, "0");
    const up = Number(upStr);
    totalAmount += qty * up;
    const remark = l.remark?.trim() || null;

    if (kind === "EXTRA") {
      const title = (l.title ?? "").trim();
      if (!title) {
        return { error: "其它费用行请填写内容" };
      }
      if (l.productId) {
        return { error: "其它费用行不能关联商品" };
      }
      lines.push({
        productId: null,
        lineKind: "EXTRA",
        title,
        quantity: qty,
        unitPrice: upStr,
        remark,
        sortOrder: i,
      });
      continue;
    }

    const productId = (l.productId ?? "").trim();
    if (!productId) {
      return { error: "请为商品行选择商品" };
    }
    lines.push({
      productId,
      lineKind: "PRODUCT",
      title: null,
      quantity: qty,
      unitPrice: upStr,
      remark,
      sortOrder: i,
    });
  }

  return { lines, totalAmount };
}

export function salesOrderLineCreateData(
  lines: NormalizedSalesOrderLineCreate[],
): Prisma.SalesOrderLineCreateWithoutSalesOrderInput[] {
  return lines.map((l) =>
    ({
      productId: l.productId,
      lineKind: l.lineKind,
      title: l.title,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      remark: l.remark,
      sortOrder: l.sortOrder,
    }) as Prisma.SalesOrderLineCreateWithoutSalesOrderInput,
  );
}

/** 出货/交清只统计 PRODUCT 行 */
export function isProductSalesLine(line: {
  lineKind?: string | null;
  productId?: string | null;
}): boolean {
  if (line.lineKind === "EXTRA") return false;
  return Boolean(line.productId);
}
