import type { PrismaClient } from "@prisma/client";

/** 不应计入「物料库存」总量的描述前缀（仅外发库存口径） */
export const MATERIAL_STOCK_EXCLUDED_PART_DESC_PREFIXES = [
  "外发结单退回（",
] as const;

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
    where: {
      materialId: { in: uniq },
      OR: [
        { partDescription: null },
        {
          NOT: {
            OR: MATERIAL_STOCK_EXCLUDED_PART_DESC_PREFIXES.map((prefix) => ({
              partDescription: { startsWith: prefix },
            })),
          },
        },
      ],
    },
    _sum: { quantity: true },
  });
  for (const g of grouped) {
    map.set(g.materialId, g._sum.quantity ?? 0);
  }
  return map;
}
