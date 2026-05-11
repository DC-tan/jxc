import { ProductProcessingMode } from "@prisma/client";

const OUTSOURCE_MODES = new Set<ProductProcessingMode>([
  ProductProcessingMode.OUTSOURCE,
  ProductProcessingMode.OUTSOURCE_INHOUSE,
]);

/**
 * 同一商品在「可现货」数量上，优先满足**待交数量较少**的销售行，同数量则优先**建单较早**的订单。
 * 分配后仍缺口的 **外发/外发+自加工** 行，作为外发提醒目标（与商品成品库存汇总 `ProductInbound` 一致，含出货负数）。
 */
export function outsourceUnmetAfterStockAllocation<
  T extends {
    id: string;
    productId: string;
    quantity: number;
    quantityShipped: number;
    salesOrder: { createdAt: Date };
    product: { processingMode: ProductProcessingMode };
  },
>(lines: T[], stockByProduct: ReadonlyMap<string, number>): { line: T; unmet: number; onHand: number }[] {
  const byPid = new Map<string, T[]>();
  for (const l of lines) {
    if (l.quantity - l.quantityShipped <= 0) continue;
    const arr = byPid.get(l.productId) ?? [];
    arr.push(l);
    byPid.set(l.productId, arr);
  }

  const result: { line: T; unmet: number; onHand: number }[] = [];

  for (const [, group] of byPid) {
    const productId = group[0]!.productId;
    const onHand = Math.max(0, stockByProduct.get(productId) ?? 0);
    const sorted = [...group].sort((a, b) => {
      const ra = a.quantity - a.quantityShipped;
      const rb = b.quantity - b.quantityShipped;
      if (ra !== rb) return ra - rb;
      const ca = a.salesOrder.createdAt.getTime();
      const cb = b.salesOrder.createdAt.getTime();
      if (ca !== cb) return ca - cb;
      return a.id.localeCompare(b.id);
    });
    let pool = onHand;
    for (const line of sorted) {
      const need = line.quantity - line.quantityShipped;
      const take = Math.min(need, pool);
      pool -= take;
      const unmet = need - take;
      if (OUTSOURCE_MODES.has(line.product.processingMode) && unmet > 0) {
        result.push({ line, unmet, onHand });
      }
    }
  }

  return result;
}
