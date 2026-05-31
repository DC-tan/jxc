import type { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

function normalizeUsageQty(v: unknown): string {
  const raw = String(v ?? "").trim();
  if (!raw) return "0";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const fixed = n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  return fixed || "0";
}

export function outsourceBomSignatureOfProduct(
  p: {
    processingMode: string;
    productMaterials: { scope: string; materialId: string; usageQty: unknown }[];
  },
): string | null {
  if (p.processingMode !== "OUTSOURCE_INHOUSE") return null;
  const parts = p.productMaterials
    .filter((m) => m.scope === "OUTSOURCE")
    .map((m) => `${m.materialId}:${normalizeUsageQty(m.usageQty)}`)
    .sort();
  if (parts.length === 0) return null;
  return parts.join("|");
}

export async function getOutsourceRecoveryPoolByProductId(
  db: DbClient,
  productId: string,
): Promise<{ quantity: number; productIds: string[]; signature: string | null }> {
  const base = await db.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      processingMode: true,
      productMaterials: {
        select: { scope: true, materialId: true, usageQty: true },
      },
    },
  });
  if (!base) return { quantity: 0, productIds: [], signature: null };

  const signature = outsourceBomSignatureOfProduct(base);
  if (!signature) {
    const agg = await db.outsourceRecoveryInbound.aggregate({
      where: { productId },
      _sum: { quantity: true },
    });
    return {
      quantity: Number(agg._sum.quantity ?? 0),
      productIds: [productId],
      signature: null,
    };
  }

  const candidates = await db.product.findMany({
    where: { processingMode: "OUTSOURCE_INHOUSE" },
    select: {
      id: true,
      processingMode: true,
      productMaterials: {
        select: { scope: true, materialId: true, usageQty: true },
      },
    },
  });
  const poolProductIds = candidates
    .filter((p) => outsourceBomSignatureOfProduct(p) === signature)
    .map((p) => p.id);
  if (poolProductIds.length === 0) {
    return { quantity: 0, productIds: [], signature };
  }

  const agg = await db.outsourceRecoveryInbound.aggregate({
    where: { productId: { in: poolProductIds } },
    _sum: { quantity: true },
  });
  return {
    quantity: Number(agg._sum.quantity ?? 0),
    productIds: poolProductIds,
    signature,
  };
}

export async function getOutsourceRecoveryQtyByProductId(
  db: DbClient,
  productId: string,
) {
  const pool = await getOutsourceRecoveryPoolByProductId(db, productId);
  return pool.quantity;
}

export async function getOutsourceRecoveryQtyMapByProductIds(
  db: DbClient,
  productIds: string[],
) {
  const out = new Map<string, number>();
  for (const pid of Array.from(new Set(productIds))) {
    out.set(pid, await getOutsourceRecoveryQtyByProductId(db, pid));
  }
  return out;
}
