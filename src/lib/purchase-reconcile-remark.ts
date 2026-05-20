/** 分单对帐：按入库流水；整单对帐：按采购单号 + 物料 */
export function purchaseReconcileLineKeySplit(materialInboundId: string): string {
  return `split:${materialInboundId}`;
}

export function purchaseReconcileLineKeyWhole(
  purchaseOrderNo: string,
  materialId: string,
): string {
  return `whole:${purchaseOrderNo}:${materialId}`;
}

import { prisma } from "@/lib/prisma";

export async function loadPurchaseReconcileRemarks(
  lineKeys: string[],
): Promise<Map<string, string>> {
  if (lineKeys.length === 0) return new Map();
  const rows = await prisma.purchaseReconcileRemark.findMany({
    where: { lineKey: { in: lineKeys } },
    select: { lineKey: true, remark: true },
  });
  return new Map(rows.map((r) => [r.lineKey, r.remark]));
}

export function attachRemarksToPurchaseReconcileRows<
  T extends { lineKey: string; 备注?: string },
>(rows: T[], remarkByKey: Map<string, string>): T[] {
  return rows.map((r) => ({
    ...r,
    备注: remarkByKey.get(r.lineKey)?.trim() ?? "",
  }));
}
