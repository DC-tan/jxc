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
