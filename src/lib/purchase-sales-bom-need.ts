import type { Prisma, PrismaClient } from "@prisma/client";

export function ceilPurchaseMaterialQty(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.ceil(raw - 1e-9));
}

type SalesOrderForBom = Prisma.SalesOrderGetPayload<{
  include: {
    lines: {
      include: {
        product: {
          include: {
            productMaterials: {
              include: {
                material: {
                  select: {
                    id: true;
                    isCustomerSupplied: true;
                    purchaseChannel: true;
                  };
                };
              };
            };
          };
        };
      };
    };
  };
}>;

/** 销售单 BOM 汇总：物料 id → 非客供需求数量 */
export function buildSalesOrderMaterialNeedMap(
  order: SalesOrderForBom,
): Map<string, number> {
  const needMap = new Map<string, number>();
  for (const line of order.lines) {
    for (const pm of line.product.productMaterials) {
      const mat = pm.material;
      if (mat.isCustomerSupplied) continue;
      if (mat.purchaseChannel !== "STANDARD_PURCHASE") continue;
      const raw = Number(pm.usageQty) * line.quantity;
      const q = ceilPurchaseMaterialQty(raw);
      needMap.set(mat.id, (needMap.get(mat.id) ?? 0) + q);
    }
  }
  return needMap;
}

const salesOrderBomInclude = {
  lines: {
    include: {
      product: {
        include: {
          productMaterials: {
            include: {
              material: {
                select: { id: true, isCustomerSupplied: true, purchaseChannel: true },
              },
            },
          },
        },
      },
    },
  },
} as const;

export async function loadSalesOrderMaterialNeedMap(
  db: Pick<PrismaClient, "salesOrder">,
  salesOrderId: string,
): Promise<Map<string, number> | null> {
  const order = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: salesOrderBomInclude,
  });
  if (!order) return null;
  return buildSalesOrderMaterialNeedMap(order);
}
