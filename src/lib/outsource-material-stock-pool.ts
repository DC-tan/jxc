import type { PrismaClient } from "@prisma/client";
import {
  loadOutsourcePoolLinesWithBalance,
  syncStoredQuantityToBalance,
  getPoolAvailableForLineId,
} from "@/lib/outsource-material-stock-query";

type PoolDb = Pick<PrismaClient, "outsourceOrderLine" | "productInbound" | "outsourceRecoveryInbound" | "materialInbound">;

export type ClosedPoolLine = {
  id: string;
  materialId: string;
  quantity: number;
};

/**
 * 按加工方 + 物料，读取可复用的外发库存池（未结单多发余量 + 已结单余料）。
 */
export async function loadClosedOutsourcePoolLines(
  db: PoolDb,
  supplierId: string | null | undefined,
  materialIds: string[],
): Promise<ClosedPoolLine[]> {
  return loadOutsourcePoolLinesWithBalance(db, supplierId, materialIds);
}

export function closedPoolQtyMap(lines: ClosedPoolLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const ln of lines) {
    map.set(ln.materialId, (map.get(ln.materialId) ?? 0) + Math.max(0, ln.quantity));
  }
  return map;
}

/**
 * 从外发库存池扣减（先进先出）。
 */
export async function consumeClosedPool(
  db: PoolDb,
  poolLines: ClosedPoolLine[],
  consumeByMaterial: Map<string, number>,
): Promise<void> {
  for (const [materialId, rawNeed] of consumeByMaterial) {
    let need = Math.max(0, Math.trunc(Number(rawNeed) || 0));
    if (need <= 0) continue;
    for (const ln of poolLines) {
      if (ln.materialId !== materialId || ln.quantity <= 0) continue;
      if (need <= 0) break;
      const available = await getPoolAvailableForLineId(db, ln.id);
      if (available <= 0) {
        ln.quantity = 0;
        continue;
      }
      const take = Math.min(need, available);
      const lineRow = await db.outsourceOrderLine.findUnique({
        where: { id: ln.id },
        select: { quantity: true },
      });
      if (!lineRow) continue;
      const next = Math.max(0, lineRow.quantity - take);
      await db.outsourceOrderLine.update({
        where: { id: ln.id },
        data: { quantity: next },
      });
      ln.quantity = Math.max(0, available - take);
      need -= take;
    }
  }
}

/**
 * 归还到外发库存池（回冲到该加工方该物料最早一条可复用在外行）。
 */
export async function restoreClosedPool(
  db: PoolDb,
  poolLines: ClosedPoolLine[],
  restoreByMaterial: Map<string, number>,
): Promise<void> {
  for (const [materialId, rawQty] of restoreByMaterial) {
    const qty = Math.max(0, Math.trunc(Number(rawQty) || 0));
    if (qty <= 0) continue;
    const target = poolLines.find((ln) => ln.materialId === materialId);
    if (!target) continue;
    const lineRow = await db.outsourceOrderLine.findUnique({
      where: { id: target.id },
      select: { quantity: true },
    });
    if (!lineRow) continue;
    const next = lineRow.quantity + qty;
    await db.outsourceOrderLine.update({
      where: { id: target.id },
      data: { quantity: next },
    });
    target.quantity += qty;
  }
}
