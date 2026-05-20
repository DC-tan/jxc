import type { ProductProcessingMode } from "@prisma/client";

/** 自加工 / 外发+自加工：本批默认完工数 = max(0, 本批出货 − 商品库存) */
export function defaultInhouseProduceQty(
  shipQty: number,
  productStock: number,
): number {
  const ship = Math.max(0, Math.trunc(shipQty));
  const stock = Math.max(0, Math.trunc(productStock));
  if (stock >= ship) return 0;
  return ship - stock;
}

export type ShipmentInhouseStepLine = {
  lineId: string;
  processingMode?: ProductProcessingMode;
  /** 商品库存（成品库存） */
  productStock?: number;
};

/** 手动完工数大于默认数时，需经「自加工补产入库存」页 */
export function shipmentNeedsInhouseStep(
  lines: ShipmentInhouseStepLine[],
  shipByLine: Record<string, number>,
  produceByLine: Record<string, number>,
): boolean {
  for (const l of lines) {
    const shipQty = shipByLine[l.lineId] ?? 0;
    if (shipQty <= 0) continue;
    if (
      l.processingMode === "INHOUSE" ||
      l.processingMode === "OUTSOURCE_INHOUSE"
    ) {
      const stock = l.productStock ?? 0;
      const def = defaultInhouseProduceQty(shipQty, stock);
      const produce = produceByLine[l.lineId] ?? def;
      if (produce > def) return true;
    }
  }
  return false;
}

/** 本批自加工完工数小于默认数（出货 − 商品库存）时的提示 */
export function inhouseProduceTooLowToShipMessage(productLabel: string): string {
  const name = productLabel?.trim() || "—";
  return `「${name}」不够数出货`;
}
