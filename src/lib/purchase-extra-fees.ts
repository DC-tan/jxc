import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const PURCHASE_EXTRA_FEES_LOCKED_MSG =
  "附加费用须在生成采购单前的「确认生成预览」中维护，生成后不可修改";

export type PurchaseExtraFeeInput = {
  amount: number;
  purpose: string;
};

export type PurchaseExtraFeeRow = PurchaseExtraFeeInput & {
  id?: string;
};

/** 对账等：合并为一列，如 5000（开模）；1200（测试架） */
export function formatPurchaseExtraFeesColumn(
  fees: PurchaseExtraFeeInput[],
): string {
  if (!fees.length) return "";
  return fees
    .map((f) => {
      const amt = Number(f.amount);
      const p = f.purpose?.trim() || "—";
      if (!Number.isFinite(amt)) return p;
      return `${amt.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}（${p}）`;
    })
    .join("；");
}

export async function syncPurchaseOrderExtraFees(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
  fees: PurchaseExtraFeeInput[],
) {
  await tx.purchaseOrderExtraFee.deleteMany({ where: { purchaseOrderId } });
  if (fees.length === 0) return;
  await tx.purchaseOrderExtraFee.createMany({
    data: fees.map((f, i) => ({
      purchaseOrderId,
      amount: String(f.amount),
      purpose: f.purpose,
      sortOrder: i,
    })),
  });
}

export function parseExtraFeesPayload(
  raw: unknown,
): { ok: true; fees: PurchaseExtraFeeInput[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, fees: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "extraFees 格式无效" };
  const fees: PurchaseExtraFeeInput[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, error: "extraFees 格式无效" };
    }
    const o = item as Record<string, unknown>;
    const amount = Number(o.amount);
    const purpose = typeof o.purpose === "string" ? o.purpose.trim() : "";
    if (!Number.isFinite(amount) || amount < 0) {
      return { ok: false, error: "附加费用金额须为非负数" };
    }
    if (!purpose) return { ok: false, error: "请填写费用用途" };
    fees.push({ amount, purpose });
  }
  return { ok: true, fees };
}

export type PurchaseExtraFeesByCustomer = {
  byCustomerId: Map<string, number>;
  /** 采购单未关联销售订单的附加费合计 */
  unlinked: number;
  total: number;
};

/** 统计区间内已创建采购单的附加费用，按销售单客户归集 */
export async function sumPurchaseExtraFeesByCustomerInRange(
  from: Date,
  to: Date,
): Promise<PurchaseExtraFeesByCustomer> {
  const rows = await prisma.purchaseOrderExtraFee.findMany({
    where: {
      purchaseOrder: {
        createdAt: { gte: from, lte: to },
        status: { not: "CANCELLED" },
      },
    },
    select: {
      amount: true,
      purchaseOrder: {
        select: {
          salesOrderId: true,
          salesOrder: { select: { customerId: true } },
        },
      },
    },
  });
  const byCustomerId = new Map<string, number>();
  let unlinked = 0;
  let total = 0;
  for (const row of rows) {
    const amt = Number(row.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    total += amt;
    const customerId = row.purchaseOrder.salesOrder?.customerId;
    if (customerId) {
      byCustomerId.set(customerId, (byCustomerId.get(customerId) ?? 0) + amt);
    } else {
      unlinked += amt;
    }
  }
  return { byCustomerId, unlinked, total };
}

/** 关联到指定销售订单的采购单附加费合计（订单利润查询用） */
export async function sumPurchaseExtraFeesForSalesOrderIds(
  salesOrderIds: string[],
): Promise<number> {
  if (salesOrderIds.length === 0) return 0;
  const rows = await prisma.purchaseOrderExtraFee.findMany({
    where: {
      purchaseOrder: {
        salesOrderId: { in: salesOrderIds },
        status: { not: "CANCELLED" },
      },
    },
    select: { amount: true },
  });
  return rows.reduce((s, r) => {
    const n = Number(r.amount);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);
}
