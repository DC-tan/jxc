/** 每套商品用量 × 投产/缺口套数，物料扣减为整数，向上取整以免少扣 */
export function bomNeedForShort(usageQty: unknown, short: number): number {
  const u = Number(usageQty);
  if (!Number.isFinite(u) || u <= 0 || short <= 0) return 0;
  return Math.max(0, Math.ceil(u * short - 1e-9));
}
