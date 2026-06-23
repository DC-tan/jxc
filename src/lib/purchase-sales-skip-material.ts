import type { PrismaClient } from "@prisma/client";

type Db = Pick<
  PrismaClient,
  "salesOrderPurchaseSkipMaterial" | "material" | "salesOrder"
>;

export async function listSkippedPurchaseMaterialIds(
  db: Db,
  salesOrderId: string,
): Promise<Set<string>> {
  const rows = await db.salesOrderPurchaseSkipMaterial.findMany({
    where: { salesOrderId },
    select: { materialId: true },
  });
  return new Set(rows.map((r) => r.materialId));
}

export async function ackPurchaseSkipMaterials(
  db: Db,
  salesOrderId: string,
  materialIds: string[],
): Promise<number> {
  const ids = [...new Set(materialIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return 0;

  const so = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { id: true },
  });
  if (!so) {
    throw new Error("销售订单不存在");
  }

  const mats = await db.material.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (mats.length !== ids.length) {
    throw new Error("存在无效物料");
  }

  await db.salesOrderPurchaseSkipMaterial.createMany({
    data: ids.map((materialId) => ({ salesOrderId, materialId })),
    skipDuplicates: true,
  });
  return ids.length;
}

export async function revokePurchaseSkipMaterials(
  db: Db,
  salesOrderId: string,
  materialIds: string[],
): Promise<number> {
  const ids = [...new Set(materialIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return 0;
  const result = await db.salesOrderPurchaseSkipMaterial.deleteMany({
    where: { salesOrderId, materialId: { in: ids } },
  });
  return result.count;
}
