import type { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function getOutsourceRecoveryQtyByProductId(
  db: DbClient,
  productId: string,
) {
  const agg = await db.outsourceRecoveryInbound.aggregate({
    where: { productId },
    _sum: { quantity: true },
  });
  return Number(agg._sum.quantity ?? 0);
}

export async function getOutsourceRecoveryQtyMapByProductIds(
  db: DbClient,
  productIds: string[],
) {
  if (productIds.length === 0) return new Map<string, number>();
  const rows = await db.outsourceRecoveryInbound.groupBy({
    by: ["productId"],
    where: { productId: { in: Array.from(new Set(productIds)) } },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.productId, Number(r._sum.quantity ?? 0)]));
}
