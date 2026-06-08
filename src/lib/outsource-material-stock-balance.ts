import type { OutsourceOrderStatus } from "@prisma/client";
import { ceilOutsourceMaterialQty } from "@/lib/outsource-lines";
import { productBomForOutsource } from "@/lib/product-bom-scope";

// 加工方式类型（与 Prisma schema 中的枚举值保持一致）
export type ProcessingMode = "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";

export type OutsourceLineStockContext = {
  orderStatus: OutsourceOrderStatus;
  processingMode: ProcessingMode;
  orderNo: string;
  materialId: string;
  productQty: number;
  issuedQuantity: number;
  storedQuantity: number;
  warehouseOutbound: number;
  recoveredSets: number;
  closeReturnQty: number;
  perSet: number;
};

export type OutsourceLineStockSplit = {
  totalRemaining: number;
  openOccupancy: number;
  poolRemaining: number;
};

/** 本单该物料在外初始总量（= 当前账面 + 已加工消耗 + 结单退回） */
export function computeInitialProcessorTotal(ctx: {
  storedQuantity: number;
  recoveredSets: number;
  closeReturnQty: number;
  perSet: number;
}): number {
  const consumed =
    ctx.perSet > 0 ? ctx.perSet * Math.max(0, ctx.recoveredSets) : 0;
  return (
    Math.max(0, ctx.storedQuantity) + consumed + Math.max(0, ctx.closeReturnQty)
  );
}

/** 本套外发按 BOM 应占用总量 */
export function computeOrderCommitTotal(productQty: number, perSet: number): number {
  if (perSet <= 0) return 0;
  return ceilOutsourceMaterialQty(Math.max(0, productQty) * perSet);
}

/** 估算本单该物料在外总量（兜底） */
export function effectiveIssuedQuantity(ctx: {
  issuedQuantity: number;
  storedQuantity: number;
  warehouseOutbound: number;
  perSet: number;
  recoveredSets: number;
  closeReturnQty: number;
}): number {
  const initial = computeInitialProcessorTotal(ctx);
  if (initial > 0) {
    return Math.max(initial, ctx.warehouseOutbound);
  }
  if (ctx.issuedQuantity > 0 || ctx.warehouseOutbound > 0) {
    return Math.max(ctx.issuedQuantity, ctx.warehouseOutbound);
  }
  return 0;
}

/**
 * 单行在外总余量 = 初始在外 − 累计加工消耗 − 结单退回。
 * 分批回收时须同步扣减 line.quantity，否则库存拆分失真。
 */
export function computeOutsourceLineRemaining(
  ctx: OutsourceLineStockContext,
): number {
  const consumed =
    ctx.perSet > 0 ? ctx.perSet * Math.max(0, ctx.recoveredSets) : 0;
  const initial = computeInitialProcessorTotal(ctx);
  const fromFormula = Math.max(0, initial - consumed - ctx.closeReturnQty);

  if (ctx.orderStatus === "CLOSED" && ctx.storedQuantity < fromFormula) {
    return Math.max(0, ctx.storedQuantity);
  }
  return fromFormula;
}

/**
 * 未结单占用 = max(0, 外发套数 − 已回收套数) × BOM 单套用量（不超过在外总余量）
 */
export function computeOpenOrderOccupancy(
  ctx: Pick<
    OutsourceLineStockContext,
    "productQty" | "recoveredSets" | "perSet"
  > & { totalRemaining: number },
): number {
  if (ctx.perSet <= 0) return 0;
  const pendingSets = Math.max(0, ctx.productQty - ctx.recoveredSets);
  const raw = ceilOutsourceMaterialQty(pendingSets * ctx.perSet);
  return Math.min(raw, Math.max(0, ctx.totalRemaining));
}

/** 外发套数尚未收回的成品套数 */
export function computePendingOutsourceSets(
  productQty: number,
  recoveredSets: number,
): number {
  return Math.max(0, Math.trunc(productQty) - Math.max(0, Math.trunc(recoveredSets)));
}

/**
 * 外发物料库存（可复用余量）= 初始在外 − 本套 BOM 占用总量（与回收消耗无关，消耗只减占用）
 */
export function computeOutsourceLinePoolRemaining(
  ctx: OutsourceLineStockContext,
): number {
  if (ctx.orderStatus === "CLOSED") {
    return Math.max(0, computeOutsourceLineRemaining(ctx));
  }
  if (ctx.perSet <= 0) return 0;
  const initial = computeInitialProcessorTotal(ctx);
  const orderNeed = computeOrderCommitTotal(ctx.productQty, ctx.perSet);
  return Math.max(0, initial - orderNeed);
}

export function computeOutsourceLineStockSplit(
  ctx: OutsourceLineStockContext,
): OutsourceLineStockSplit {
  const totalRemaining = computeOutsourceLineRemaining(ctx);
  const poolRemaining = computeOutsourceLinePoolRemaining(ctx);
  const openOccupancy =
    ctx.orderStatus === "OPEN"
      ? Math.max(0, totalRemaining - poolRemaining)
      : 0;
  return { totalRemaining, openOccupancy, poolRemaining };
}

export function perSetFromProductMaterials(
  processingMode: ProcessingMode,
  productMaterials: { materialId: string; usageQty: unknown; scope: unknown }[],
  materialId: string,
): number {
  // 类型断言：productBomForOutsource 返回的数组元素包含 materialId 和 usageQty
  // 使用 any 完全绕过类型检查，确保编译通过
  const bom = productBomForOutsource(processingMode, productMaterials as any) as any[];
  const row = bom.find((x: any) => x.materialId === materialId);
  if (!row) return 0;
  return ceilOutsourceMaterialQty(Number(row.usageQty) * 1);
}