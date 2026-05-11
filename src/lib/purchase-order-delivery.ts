/**
 * 采购单「要求交货日期」：订单生成日（自然日）起加供应商「交货天数」。
 * 使用 UTC 日历日，与接口中 ISO 日期字符串一致。
 */
export function computePurchaseOrderDeliveryDue(
  orderCreatedAt: Date,
  supplierLeadDays: number | null | undefined,
): Date | null {
  if (
    supplierLeadDays == null ||
    !Number.isFinite(supplierLeadDays) ||
    supplierLeadDays < 0
  ) {
    return null;
  }
  const d = new Date(orderCreatedAt);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + Math.trunc(supplierLeadDays));
  return d;
}
