export const PURCHASE_SPARE_PART_DESC_PREFIX = "采购收料备品（";

export function buildPurchaseSparePartDescription(orderNo: string): string {
  return `${PURCHASE_SPARE_PART_DESC_PREFIX}${orderNo}）`;
}
