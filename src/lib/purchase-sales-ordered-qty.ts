import type { PrismaClient } from "@prisma/client";

/**
 * 本销售单下有效（未取消）采购单已覆盖的物料数量。
 * 收料确认后明细行可能已删，需叠加 purchaseOrderNo 对应的入库流水。
 */
export async function sumActivePurchaseQtyByMaterial(
  db: Pick<PrismaClient, "purchaseOrder" | "materialInbound">,
  salesOrderId: string,
): Promise<Map<string, number>> {
  const orders = await db.purchaseOrder.findMany({
    where: {
      salesOrderId,
      status: { not: "CANCELLED" },
    },
    select: {
      orderNo: true,
      lines: { select: { materialId: true, quantity: true } },
    },
  });

  const map = new Map<string, number>();
  if (orders.length === 0) return map;

  const orderNos = orders.map((o) => o.orderNo);
  const inboundByOrderNo = new Map<string, Map<string, number>>();

  if (orderNos.length > 0) {
    const inbounds = await db.materialInbound.findMany({
      where: { purchaseOrderNo: { in: orderNos } },
      select: { purchaseOrderNo: true, materialId: true, quantity: true },
    });
    for (const ib of inbounds) {
      const ono = ib.purchaseOrderNo?.trim();
      if (!ono) continue;
      const q = Math.trunc(Number(ib.quantity));
      if (!Number.isFinite(q) || q <= 0) continue;
      let perPo = inboundByOrderNo.get(ono);
      if (!perPo) {
        perPo = new Map();
        inboundByOrderNo.set(ono, perPo);
      }
      perPo.set(ib.materialId, (perPo.get(ib.materialId) ?? 0) + q);
    }
  }

  for (const po of orders) {
    const perPo = new Map<string, number>();
    for (const line of po.lines) {
      const q = Math.trunc(Number(line.quantity));
      if (!Number.isFinite(q) || q <= 0) continue;
      perPo.set(line.materialId, (perPo.get(line.materialId) ?? 0) + q);
    }
    const fromInbound = inboundByOrderNo.get(po.orderNo);
    if (fromInbound) {
      for (const [mid, q] of fromInbound) {
        perPo.set(mid, (perPo.get(mid) ?? 0) + q);
      }
    }
    for (const [mid, q] of perPo) {
      map.set(mid, (map.get(mid) ?? 0) + q);
    }
  }

  return map;
}
