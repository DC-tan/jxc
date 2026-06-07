/** 与采购拆单一致：用量 × 套数 向上取整，至少 1 */
export function ceilOutsourceMaterialQty(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.ceil(raw - 1e-9));
}

export function computeOutsourceLinesFromBom(
  bom: { materialId: string; usageQty: number | string }[],
  productQty: number,
): { materialId: string; quantity: number; sortOrder: number }[] {
  return bom.map((row, i) => ({
    materialId: row.materialId,
    quantity: ceilOutsourceMaterialQty(Number(row.usageQty) * productQty),
    sortOrder: i,
  }));
}

/** 本套外发可从外发物料库存抵扣的数量 */
export function outsourcePoolUseForNeed(
  bomNeed: number,
  outsourcePool: number,
): number {
  const need = Math.max(0, Math.trunc(bomNeed) || 0);
  const pool = Math.max(0, Math.trunc(outsourcePool) || 0);
  return Math.min(need, pool);
}

/** 新建外发单默认实发数 = 本套需求 − 外发库存可抵扣（库存充足时为 0） */
export function defaultOutsourceWarehouseSend(
  bomNeed: number,
  outsourcePool: number,
): number {
  const need = Math.max(0, Math.trunc(bomNeed) || 0);
  const poolUse = outsourcePoolUseForNeed(need, outsourcePool);
  return Math.max(0, need - poolUse);
}

export function allocateOutsourceMaterialSend(
  warehouseSend: number,
  bomNeed: number,
  outsourcePool: number,
): { poolUse: number; warehouseSend: number; totalAtProcessor: number } {
  const poolUse = outsourcePoolUseForNeed(bomNeed, outsourcePool);
  const send = Math.max(0, Math.trunc(warehouseSend) || 0);
  return { poolUse, warehouseSend: send, totalAtProcessor: poolUse + send };
}
