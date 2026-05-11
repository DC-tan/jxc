/**
 * 读取行上已保存的已交数量。字段已在 schema 中；若本机 `prisma generate` 失败（如 Windows EPERM），
 * 生成的 Prisma 类型可能暂不含此属性，故用窄化读取避免 TS 报错。
 */
export function storedQuantityShipped(line: { quantity: number }): number {
  const v = (line as { quantityShipped?: unknown }).quantityShipped;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * 兼容升级前「仅写 actualDeliveredAt、未记 quantityShipped」的历史数据
 */
export function effectiveQuantityShipped(
  lineQuantity: number,
  storedShipped: number,
  orderActualDeliveredAt: Date | null,
): number {
  if (orderActualDeliveredAt && storedShipped < lineQuantity) {
    return lineQuantity;
  }
  return storedShipped;
}

export function remainingToShip(
  lineQuantity: number,
  storedShipped: number,
  orderActualDeliveredAt: Date | null,
): number {
  const eff = effectiveQuantityShipped(
    lineQuantity,
    storedShipped,
    orderActualDeliveredAt,
  );
  return Math.max(0, lineQuantity - eff);
}
