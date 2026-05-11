import type { WarehouseDeliveryLineDraft } from "@/lib/warehouse-delivery-draft";

const SHIP_MAX = 10_000_000;

/**
 * 送货单「数量」列展示值：仅确认出货时的 shipQty，**不含**备品（备品另行记备注并参与扣库）
 */
export function slipQuantityDisplay(line: WarehouseDeliveryLineDraft): number {
  return Math.max(0, Math.trunc(line.shipQty));
}

/**
 * 点「完成」时从商品库存扣减的件数 = 实际出货(shipQty) + 备品(spareQty)
 * 兼容旧草稿：若曾存 lineTotal 则优先用
 */
export function lineOutboundTotal(line: WarehouseDeliveryLineDraft): number {
  if (line.lineTotal != null && line.lineTotal >= 0) {
    return Math.trunc(line.lineTotal);
  }
  const q = Math.max(0, Math.trunc(line.shipQty));
  const spare = Math.max(0, Math.trunc(line.spareQty ?? 0));
  return Math.min(SHIP_MAX, q + spare);
}

type BuildInput = {
  line: WarehouseDeliveryLineDraft;
  orderLine: {
    quantity: number;
    remark: string | null;
    product: { unit: string; productRemark?: string | null };
  };
  effShippedBefore: number;
};

/**
 * 送货单表身「备注」列：订单行原备注、商品档案备注、超量、备品、用户补充（各行自动换行）
 */
export function buildDeliveryLineRemarkText(input: BuildInput): string {
  const { line, orderLine, effShippedBefore } = input;
  const unit = (orderLine.product?.unit || "件").trim() || "件";
  const base = (orderLine.remark ?? "").trim();
  const productNote = (orderLine.product?.productRemark ?? "").trim();
  const spare = Math.max(0, Math.trunc(line.spareQty ?? 0));
  const actualShip = slipQuantityDisplay(line);
  const orderQty = Math.max(0, Math.trunc(orderLine.quantity));
  const over = Math.max(0, effShippedBefore + actualShip - orderQty);
  const lines: string[] = [];
  if (base) lines.push(base);
  if (productNote) lines.push(productNote);
  if (over > 0) {
    lines.push(`超出订单数量${over} ${unit}`);
  }
  if (spare > 0) {
    lines.push(`备品 ${spare} ${unit}`);
  }
  const u = (line.userRemark ?? "").trim();
  if (u) lines.push(u);
  return lines.join("\n");
}
