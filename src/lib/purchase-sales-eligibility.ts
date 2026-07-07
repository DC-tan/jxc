import type { PrismaClient } from "@prisma/client";
import { salesOrderPurchaseSplitComplete } from "@/lib/purchase-sales-supplier-confirm";

/**
 * 是否出现在「从销售订单新建采购」下拉中。
 *
 * 有有效采购单时：不再按全量 BOM 与已下数量比较；改为方案 1——
 * 全部需采供应商均已点「确认」且各自已生成有效采购单后才不再显示。
 */
export async function salesOrderEligibleForNewPurchase(
  db: Pick<
    PrismaClient,
    | "salesOrder"
    | "purchaseOrder"
    | "materialInbound"
    | "salesOrderPurchaseSkipMaterial"
    | "salesOrderPurchaseSupplierConfirm"
    | "material"
  >,
  salesOrderId: string,
  purchaseStatuses: { status: string }[],
): Promise<boolean> {
  if (purchaseStatuses.length === 0) return true;
  if (purchaseStatuses.some((p) => p.status === "CANCELLED")) return true;
  const hasActive = purchaseStatuses.some((p) => p.status !== "CANCELLED");
  if (!hasActive) return true;

  const complete = await salesOrderPurchaseSplitComplete(db, salesOrderId);
  return !complete;
}
