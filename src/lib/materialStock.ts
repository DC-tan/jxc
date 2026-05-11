import type { PrismaClient } from "@prisma/client";

/**
 * 各物料当前库存（`MaterialInbound.quantity` 汇总），与「物料库存」列表一致。
 * 外发保存会写入负数量流水；取消外发单会删除对应流水。
 */
export async function getMaterialInboundTotalsByIds(
  db: Pick<PrismaClient, "materialInbound">,
  materialIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const uniq = [...new Set(materialIds)].filter(Boolean);
  for (const id of uniq) {
    map.set(id, 0);
  }
  if (uniq.length === 0) return map;

  const grouped = await db.materialInbound.groupBy({
    by: ["materialId"],
    where: { materialId: { in: uniq } },
    _sum: { quantity: true },
  });
  for (const g of grouped) {
    map.set(g.materialId, g._sum.quantity ?? 0);
  }
  return map;
}
