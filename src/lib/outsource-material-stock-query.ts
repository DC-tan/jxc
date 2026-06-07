import type { OutsourceOrderStatus, PrismaClient, ProcessingMode } from "@prisma/client";
import {
  computeOutsourceLinePoolRemaining,
  computeOutsourceLineRemaining,
  computeOutsourceLineStockSplit,
  perSetFromProductMaterials,
} from "@/lib/outsource-material-stock-balance";

type QueryDb = Pick<
  PrismaClient,
  | "outsourceOrderLine"
  | "productInbound"
  | "outsourceRecoveryInbound"
  | "materialInbound"
>;

export type OutsourceStockLineRow = {
  id: string;
  materialId: string;
  quantity: number;
  issuedQuantity: number;
  outsourceOrderId: string;
  outsourceOrder: {
    id: string;
    orderNo: string;
    status: OutsourceOrderStatus;
    productQty: number;
    supplierId: string | null;
    product: {
      processingMode: ProcessingMode;
      productMaterials: {
        materialId: string;
        usageQty: unknown;
        scope: unknown;
      }[];
    };
  };
};

export type OutsourceStockContextMaps = {
  productSetsByOrderNo: Map<string, number>;
  recoverySetsByOrderId: Map<string, number>;
  warehouseByOrderMaterial: Map<string, number>;
  closeReturnByOrderMaterial: Map<string, number>;
};

export async function loadOutsourceStockContextMaps(
  db: QueryDb,
  orderIds: string[],
  orderNos: string[],
): Promise<OutsourceStockContextMaps> {
  const [productSetsRows, recoverySetsRows, warehouseRows, closeReturnRows] =
    await Promise.all([
      db.productInbound.groupBy({
        by: ["purchaseOrderNo"],
        where: { purchaseOrderNo: { in: orderNos }, quantity: { gt: 0 } },
        _sum: { quantity: true },
      }),
      db.outsourceRecoveryInbound.groupBy({
        by: ["outsourceOrderId"],
        where: { outsourceOrderId: { in: orderIds }, quantity: { gt: 0 } },
        _sum: { quantity: true },
      }),
      db.materialInbound.groupBy({
        by: ["purchaseOrderNo", "materialId"],
        where: {
          purchaseOrderNo: { in: orderNos },
          quantity: { lt: 0 },
        },
        _sum: { quantity: true },
      }),
      db.materialInbound.groupBy({
        by: ["purchaseOrderNo", "materialId"],
        where: {
          purchaseOrderNo: { in: orderNos },
          quantity: { gt: 0 },
          partDescription: { startsWith: "外发结单退回" },
        },
        _sum: { quantity: true },
      }),
    ]);

  const productSetsByOrderNo = new Map<string, number>();
  for (const r of productSetsRows) {
    if (r.purchaseOrderNo) {
      productSetsByOrderNo.set(r.purchaseOrderNo, Number(r._sum.quantity ?? 0));
    }
  }
  const recoverySetsByOrderId = new Map<string, number>();
  for (const r of recoverySetsRows) {
    recoverySetsByOrderId.set(r.outsourceOrderId, Number(r._sum.quantity ?? 0));
  }
  const warehouseByOrderMaterial = new Map<string, number>();
  for (const r of warehouseRows) {
    if (!r.purchaseOrderNo) continue;
    warehouseByOrderMaterial.set(
      `${r.purchaseOrderNo}::${r.materialId}`,
      Math.abs(Number(r._sum.quantity ?? 0)),
    );
  }
  const closeReturnByOrderMaterial = new Map<string, number>();
  for (const r of closeReturnRows) {
    if (!r.purchaseOrderNo) continue;
    closeReturnByOrderMaterial.set(
      `${r.purchaseOrderNo}::${r.materialId}`,
      Number(r._sum.quantity ?? 0),
    );
  }

  return {
    productSetsByOrderNo,
    recoverySetsByOrderId,
    warehouseByOrderMaterial,
    closeReturnByOrderMaterial,
  };
}

export function buildOutsourceLineStockContext(
  row: OutsourceStockLineRow,
  maps: OutsourceStockContextMaps,
) {
  const order = row.outsourceOrder;
  const orderNo = order.orderNo?.trim() ?? "";
  const omKey = `${orderNo}::${row.materialId}`;
  const recoveredSets =
    order.product.processingMode === "OUTSOURCE_INHOUSE"
      ? maps.recoverySetsByOrderId.get(order.id) ?? 0
      : maps.productSetsByOrderNo.get(orderNo) ?? 0;
  const perSet = perSetFromProductMaterials(
    order.product.processingMode,
    order.product.productMaterials ?? [],
    row.materialId,
  );
  return {
    orderStatus: order.status,
    processingMode: order.product.processingMode,
    orderNo,
    materialId: row.materialId,
    productQty: order.productQty,
    issuedQuantity: row.issuedQuantity,
    storedQuantity: row.quantity,
    warehouseOutbound: maps.warehouseByOrderMaterial.get(omKey) ?? 0,
    recoveredSets,
    closeReturnQty: maps.closeReturnByOrderMaterial.get(omKey) ?? 0,
    perSet,
  };
}

export function computeLineRemainingFromRow(
  row: OutsourceStockLineRow,
  maps: OutsourceStockContextMaps,
): number {
  return computeOutsourceLineRemaining(buildOutsourceLineStockContext(row, maps));
}

export function computeLineStockSplitFromRow(
  row: OutsourceStockLineRow,
  maps: OutsourceStockContextMaps,
) {
  return computeOutsourceLineStockSplit(buildOutsourceLineStockContext(row, maps));
}

export function computeLinePoolRemainingFromRow(
  row: OutsourceStockLineRow,
  maps: OutsourceStockContextMaps,
): number {
  return computeOutsourceLinePoolRemaining(buildOutsourceLineStockContext(row, maps));
}

const lineSelect = {
  id: true,
  materialId: true,
  quantity: true,
  issuedQuantity: true,
  outsourceOrderId: true,
  outsourceOrder: {
    select: {
      id: true,
      orderNo: true,
      status: true,
      productQty: true,
      supplierId: true,
      product: {
        select: {
          processingMode: true,
          productMaterials: {
            select: { materialId: true, usageQty: true, scope: true },
          },
        },
      },
    },
  },
} as const;

/** 按加工方 + 物料汇总外发物料库存（可复用余量，含未结单多发部分 + 已结单余料） */
export async function sumOutsourceStockByMaterialIds(
  db: QueryDb,
  materialIds: string[],
  supplierId: string | null | undefined,
): Promise<Map<string, number>> {
  const uniq = [...new Set(materialIds)].filter(Boolean);
  if (uniq.length === 0) return new Map();

  const rows = (await db.outsourceOrderLine.findMany({
    where: {
      materialId: { in: uniq },
      outsourceOrder: {
        status: { in: ["OPEN", "CLOSED"] },
        ...(supplierId === undefined ? {} : { supplierId }),
      },
    },
    select: lineSelect,
    orderBy: [{ outsourceOrder: { createdAt: "asc" } }, { sortOrder: "asc" }],
    take: 4000,
  })) as OutsourceStockLineRow[];

  const orderIds = [...new Set(rows.map((r) => r.outsourceOrderId))];
  const orderNos = [
    ...new Set(
      rows.map((r) => r.outsourceOrder.orderNo?.trim()).filter(Boolean),
    ),
  ] as string[];
  const maps = await loadOutsourceStockContextMaps(db, orderIds, orderNos);

  const totals = new Map<string, number>();
  for (const row of rows) {
    const pool = computeLinePoolRemainingFromRow(row, maps);
    if (pool <= 0) continue;
    totals.set(row.materialId, (totals.get(row.materialId) ?? 0) + pool);
  }
  return totals;
}

/** 可复用库存池明细（OPEN 多发余量 + CLOSED 结单余料，FIFO 用） */
export async function loadOutsourcePoolLinesWithBalance(
  db: QueryDb,
  supplierId: string | null | undefined,
  materialIds: string[],
): Promise<{ id: string; materialId: string; quantity: number }[]> {
  const uniq = [...new Set(materialIds)].filter(Boolean);
  if (uniq.length === 0) return [];

  const rows = (await db.outsourceOrderLine.findMany({
    where: {
      materialId: { in: uniq },
      outsourceOrder: {
        status: { in: ["OPEN", "CLOSED"] },
        ...(supplierId === undefined ? {} : { supplierId }),
      },
    },
    select: lineSelect,
    orderBy: [{ outsourceOrder: { createdAt: "asc" } }, { sortOrder: "asc" }],
    take: 4000,
  })) as OutsourceStockLineRow[];

  const orderIds = [...new Set(rows.map((r) => r.outsourceOrderId))];
  const orderNos = [
    ...new Set(
      rows.map((r) => r.outsourceOrder.orderNo?.trim()).filter(Boolean),
    ),
  ] as string[];
  const maps = await loadOutsourceStockContextMaps(db, orderIds, orderNos);

  return rows
    .map((row) => ({
      id: row.id,
      materialId: row.materialId,
      quantity: computeLinePoolRemainingFromRow(row, maps),
    }))
    .filter((r) => r.quantity > 0);
}

/** 同步总在外余量后，返回该行可复用库存（外发物料库存） */
export async function getPoolAvailableForLineId(
  db: QueryDb,
  lineId: string,
): Promise<number> {
  await syncStoredQuantityToBalance(db, lineId);
  const row = (await db.outsourceOrderLine.findUnique({
    where: { id: lineId },
    select: lineSelect,
  })) as OutsourceStockLineRow | null;
  if (!row) return 0;
  const orderIds = [row.outsourceOrderId];
  const orderNos = [row.outsourceOrder.orderNo?.trim()].filter(Boolean) as string[];
  const maps = await loadOutsourceStockContextMaps(db, orderIds, orderNos);
  return computeLinePoolRemainingFromRow(row, maps);
}

/** 将明细行 quantity 同步为公式折算的外发余量，返回同步后的值 */
export async function syncStoredQuantityToBalance(
  db: QueryDb,
  lineId: string,
): Promise<number> {
  const row = (await db.outsourceOrderLine.findUnique({
    where: { id: lineId },
    select: lineSelect,
  })) as OutsourceStockLineRow | null;
  if (!row) return 0;

  const orderIds = [row.outsourceOrderId];
  const orderNos = [row.outsourceOrder.orderNo?.trim()].filter(Boolean) as string[];
  const maps = await loadOutsourceStockContextMaps(db, orderIds, orderNos);
  const remaining = computeLineRemainingFromRow(row, maps);
  if (remaining !== row.quantity) {
    await db.outsourceOrderLine.update({
      where: { id: lineId },
      data: { quantity: remaining },
    });
  }
  return remaining;
}

/** 按公式回写外发单各行的在外余量（结单/回收后调用） */
export async function reconcileOutsourceOrderLineQuantities(
  db: QueryDb,
  orderId: string,
): Promise<void> {
  const rows = (await db.outsourceOrderLine.findMany({
    where: { outsourceOrderId: orderId },
    select: lineSelect,
  })) as OutsourceStockLineRow[];
  if (rows.length === 0) return;

  const orderNos = [
    ...new Set(
      rows.map((r) => r.outsourceOrder.orderNo?.trim()).filter(Boolean),
    ),
  ] as string[];
  const maps = await loadOutsourceStockContextMaps(db, [orderId], orderNos);

  for (const row of rows) {
    const remaining = computeLineRemainingFromRow(row, maps);
    if (remaining !== row.quantity) {
      await db.outsourceOrderLine.update({
        where: { id: row.id },
        data: { quantity: remaining },
      });
    }
  }
}
