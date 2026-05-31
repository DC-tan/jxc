import type { PrismaClient } from "@prisma/client";
import { loadSalesOrderMaterialNeedMap } from "@/lib/purchase-sales-bom-need";
import { sumActivePurchaseQtyByMaterial } from "@/lib/purchase-sales-ordered-qty";

/**
 * BOM 需求是否尚未被有效（未取消）采购单数量覆盖。
 * 用于：删除了其中一张采购单后，该单物料不再计入已下数量，销售单应重新可选。
 */
export async function salesOrderHasUncoveredPurchaseNeed(
  db: Pick<PrismaClient, "salesOrder" | "purchaseOrder" | "materialInbound">,
  salesOrderId: string,
): Promise<boolean> {
  const needMap = await loadSalesOrderMaterialNeedMap(db, salesOrderId);
  if (!needMap || needMap.size === 0) return false;
  const ordered = await sumActivePurchaseQtyByMaterial(db, salesOrderId);
  for (const [materialId, needQty] of needMap) {
    if (needQty > (ordered.get(materialId) ?? 0)) {
      return true;
    }
  }
  return false;
}

/**
 * 是否出现在「从销售订单新建采购」下拉中。
 */
export async function salesOrderEligibleForNewPurchase(
  db: Pick<PrismaClient, "salesOrder" | "purchaseOrder" | "materialInbound">,
  salesOrderId: string,
  purchaseStatuses: { status: string }[],
): Promise<boolean> {
  if (purchaseStatuses.length === 0) return true;
  if (purchaseStatuses.some((p) => p.status === "CANCELLED")) return true;
  const hasActive = purchaseStatuses.some((p) => p.status !== "CANCELLED");
  if (!hasActive) return true;
  return salesOrderHasUncoveredPurchaseNeed(db, salesOrderId);
}
