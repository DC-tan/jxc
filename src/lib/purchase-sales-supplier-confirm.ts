import type { PrismaClient } from "@prisma/client";
import { loadSalesOrderMaterialNeedMap } from "@/lib/purchase-sales-bom-need";
import { listSkippedPurchaseMaterialIds } from "@/lib/purchase-sales-skip-material";

type Db = Pick<
  PrismaClient,
  | "salesOrder"
  | "material"
  | "purchaseOrder"
  | "salesOrderPurchaseSkipMaterial"
  | "salesOrderPurchaseSupplierConfirm"
>;

/** BOM 中仍需采购的物料对应供应商（排除已跳过物料） */
export async function listRequiredPurchaseSupplierIds(
  db: Db,
  salesOrderId: string,
): Promise<Set<string>> {
  const needMap = await loadSalesOrderMaterialNeedMap(db, salesOrderId);
  if (!needMap || needMap.size === 0) return new Set();

  const skipped = await listSkippedPurchaseMaterialIds(db, salesOrderId);
  const materialIds = [...needMap.keys()].filter((id) => !skipped.has(id));
  if (materialIds.length === 0) return new Set();

  const mats = await db.material.findMany({
    where: { id: { in: materialIds } },
    select: { supplierId: true },
  });
  return new Set(mats.map((m) => m.supplierId));
}

/** 已有有效采购单、尚无确认记录时补写（兼容升级前已下单的数据） */
export async function syncSupplierConfirmFromActivePurchaseOrders(
  db: Db,
  salesOrderId: string,
): Promise<void> {
  const required = await listRequiredPurchaseSupplierIds(db, salesOrderId);
  if (required.size === 0) return;

  const activePos = await db.purchaseOrder.findMany({
    where: {
      salesOrderId,
      status: { not: "CANCELLED" },
      supplierId: { in: [...required] },
    },
    select: { id: true, supplierId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const latestPoBySupplier = new Map<
    string,
    { id: string; createdAt: Date }
  >();
  for (const po of activePos) {
    if (!latestPoBySupplier.has(po.supplierId)) {
      latestPoBySupplier.set(po.supplierId, {
        id: po.id,
        createdAt: po.createdAt,
      });
    }
  }

  for (const supplierId of required) {
    const po = latestPoBySupplier.get(supplierId);
    if (!po) continue;

    const existing = await db.salesOrderPurchaseSupplierConfirm.findUnique({
      where: {
        salesOrderId_supplierId: { salesOrderId, supplierId },
      },
      select: { confirmedAt: true },
    });
    if (existing) continue;

    await db.salesOrderPurchaseSupplierConfirm.create({
      data: {
        salesOrderId,
        supplierId,
        confirmedAt: po.createdAt,
        purchaseOrderId: po.id,
      },
    });
  }
}

export async function ackPurchaseSupplierConfirm(
  db: Db,
  salesOrderId: string,
  supplierId: string,
): Promise<void> {
  const activePo = await db.purchaseOrder.findFirst({
    where: {
      salesOrderId,
      supplierId,
      status: { not: "CANCELLED" },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  await db.salesOrderPurchaseSupplierConfirm.upsert({
    where: {
      salesOrderId_supplierId: { salesOrderId, supplierId },
    },
    create: {
      salesOrderId,
      supplierId,
      confirmedAt: new Date(),
      purchaseOrderId: activePo?.id ?? null,
    },
    update: {
      confirmedAt: new Date(),
      ...(activePo ? { purchaseOrderId: activePo.id } : {}),
    },
  });
}

export async function revokePurchaseSupplierConfirm(
  db: Db,
  salesOrderId: string,
  supplierId: string,
): Promise<void> {
  await db.salesOrderPurchaseSupplierConfirm.updateMany({
    where: { salesOrderId, supplierId },
    data: { confirmedAt: null },
  });
}

export async function markSupplierPurchaseOrderGenerated(
  db: Db,
  salesOrderId: string,
  supplierId: string,
  purchaseOrderId: string,
): Promise<void> {
  const now = new Date();
  await db.salesOrderPurchaseSupplierConfirm.upsert({
    where: {
      salesOrderId_supplierId: { salesOrderId, supplierId },
    },
    create: {
      salesOrderId,
      supplierId,
      confirmedAt: now,
      purchaseOrderId,
    },
    update: {
      purchaseOrderId,
      confirmedAt: now,
    },
  });
}

export type SupplierConfirmState = {
  confirmed: boolean;
  confirmedAt: string | null;
  purchaseOrderId: string | null;
};

export async function loadSupplierConfirmStates(
  db: Db,
  salesOrderId: string,
): Promise<Record<string, SupplierConfirmState>> {
  const rows = await db.salesOrderPurchaseSupplierConfirm.findMany({
    where: { salesOrderId },
    select: {
      supplierId: true,
      confirmedAt: true,
      purchaseOrderId: true,
    },
  });
  const out: Record<string, SupplierConfirmState> = {};
  for (const row of rows) {
    out[row.supplierId] = {
      confirmed: row.confirmedAt != null,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      purchaseOrderId: row.purchaseOrderId,
    };
  }
  return out;
}

async function supplierHasActivePurchaseOrder(
  db: Db,
  salesOrderId: string,
  supplierId: string,
  purchaseOrderId: string | null,
): Promise<boolean> {
  if (purchaseOrderId) {
    const po = await db.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: { status: true },
    });
    return po != null && po.status !== "CANCELLED";
  }
  const po = await db.purchaseOrder.findFirst({
    where: {
      salesOrderId,
      supplierId,
      status: { not: "CANCELLED" },
    },
    select: { id: true },
  });
  return po != null;
}

/** 已点「确认」且已生成有效采购单的供应商（拆分页不再展示） */
export async function listCompletedPurchaseSupplierIds(
  db: Db,
  salesOrderId: string,
): Promise<Set<string>> {
  await syncSupplierConfirmFromActivePurchaseOrders(db, salesOrderId);

  const confirms = await db.salesOrderPurchaseSupplierConfirm.findMany({
    where: { salesOrderId, confirmedAt: { not: null } },
    select: {
      supplierId: true,
      purchaseOrderId: true,
    },
  });

  const completed = new Set<string>();
  for (const rec of confirms) {
    const ok = await supplierHasActivePurchaseOrder(
      db,
      salesOrderId,
      rec.supplierId,
      rec.purchaseOrderId,
    );
    if (ok) completed.add(rec.supplierId);
  }
  return completed;
}

/**
 * 全部需采供应商均已点「确认」且各自有有效采购单 → 拆分完成，不再出现在新建采购列表。
 */
export async function salesOrderPurchaseSplitComplete(
  db: Db,
  salesOrderId: string,
): Promise<boolean> {
  const required = await listRequiredPurchaseSupplierIds(db, salesOrderId);
  if (required.size === 0) return true;

  const completed = await listCompletedPurchaseSupplierIds(db, salesOrderId);
  for (const supplierId of required) {
    if (!completed.has(supplierId)) return false;
  }
  return true;
}
