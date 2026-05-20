import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  effectiveQuantityShipped,
  remainingToShip,
  storedQuantityShipped,
} from "@/lib/sales-order-shipping";
import { getMaterialInboundTotalsByIds } from "@/lib/materialStock";
import { getOutsourceRecoveryQtyByProductId } from "@/lib/outsource-recovery-stock";
import { productBomForInhouseProduction } from "@/lib/product-bom-scope";

function parseImageUrls(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** 仓库出货：销售订单明细（权限 warehouse.view） */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("warehouse.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;

  try {
    const row = await prisma.salesOrder.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        lines: {
          orderBy: { sortOrder: "asc" },
          include: {
            shipLogs: { orderBy: { batchDeliveredAt: "desc" } },
            product: {
              select: {
                id: true,
                customerMaterialCode: true,
                model: true,
                spec: true,
                unit: true,
                price: true,
                inspectionNotes: true,
                productRemark: true,
                imageUrls: true,
                processingMode: true,
                productMaterials: {
                  orderBy: { sortOrder: "asc" },
                  select: {
                    materialId: true,
                    scope: true,
                    usageQty: true,
                    material: {
                      select: {
                        code: true,
                        name: true,
                        unit: true,
                        partDescription: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!row) {
      return NextResponse.json({ error: "销售订单不存在" }, { status: 404 });
    }

    const productIds = [...new Set(row.lines.map((l) => l.productId))];
    const stockGroups =
      productIds.length > 0
        ? await prisma.productInbound.groupBy({
            by: ["productId"],
            where: { productId: { in: productIds } },
            _sum: { quantity: true },
          })
        : [];
    const stockByProduct = new Map(
      stockGroups.map((g) => [
        g.productId,
        Math.trunc(Number(g._sum.quantity ?? 0)),
      ]),
    );

    const inhouseMaterialIds = row.lines.flatMap((l) => {
      const mode = l.product.processingMode;
      if (mode !== "INHOUSE" && mode !== "OUTSOURCE_INHOUSE") return [];
      return productBomForInhouseProduction(
        mode,
        l.product.productMaterials ?? [],
      ).map((pm) => pm.materialId);
    });
    const materialStockById = await getMaterialInboundTotalsByIds(
      prisma,
      inhouseMaterialIds,
    );

    const hybridProductIds = [
      ...new Set(
        row.lines
          .filter((l) => l.product.processingMode === "OUTSOURCE_INHOUSE")
          .map((l) => l.productId),
      ),
    ];
    const recoveryByProduct = new Map<string, number>();
    await Promise.all(
      hybridProductIds.map(async (productId) => {
        recoveryByProduct.set(
          productId,
          await getOutsourceRecoveryQtyByProductId(prisma, productId),
        );
      }),
    );

    return NextResponse.json({
      id: row.id,
      customerOrderNo: row.customerOrderNo,
      customerModel: row.customerModel,
      deliveryDueAt: row.deliveryDueAt?.toISOString() ?? null,
      actualDeliveredAt: row.actualDeliveredAt?.toISOString() ?? null,
      totalAmount: row.totalAmount.toString(),
      remark: row.remark,
      customer: row.customer,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lines: row.lines.map((l) => {
        const stored = storedQuantityShipped(l);
        const shipped = effectiveQuantityShipped(
          l.quantity,
          stored,
          row.actualDeliveredAt,
        );
        const remaining = remainingToShip(
          l.quantity,
          stored,
          row.actualDeliveredAt,
        );
        const logs =
          (
            l as unknown as {
              shipLogs?: {
                batchDeliveredAt: Date;
                quantity: number;
                spareQty: number;
                deliveryNoteNo: string | null;
              }[];
            }
          ).shipLogs ?? [];
        return {
          id: l.id,
          quantity: l.quantity,
          quantityShipped: shipped,
          remaining,
          shipHistory: logs.map((s) => ({
            at: s.batchDeliveredAt.toISOString(),
            qty: s.quantity,
            spareQty: Math.max(0, Math.trunc(Number(s.spareQty ?? 0))),
            deliveryNoteNo: s.deliveryNoteNo?.trim() || null,
          })),
          unitPrice: l.unitPrice.toString(),
          remark: l.remark,
          product: {
            id: l.product.id,
            customerMaterialCode: l.product.customerMaterialCode,
            model: l.product.model,
            spec: l.product.spec,
            unit: l.product.unit,
            price: l.product.price.toString(),
            inspectionNotes: l.product.inspectionNotes,
            productRemark: l.product.productRemark,
            imageUrls: parseImageUrls(l.product.imageUrls),
            processingMode: l.product.processingMode,
            inhouseBom:
              l.product.processingMode === "INHOUSE" ||
              l.product.processingMode === "OUTSOURCE_INHOUSE"
                ? productBomForInhouseProduction(
                    l.product.processingMode,
                    l.product.productMaterials ?? [],
                  ).map((pm) => ({
                    materialId: pm.materialId,
                    usageQty: Number(pm.usageQty),
                    materialStock:
                      materialStockById.get(pm.materialId) ?? 0,
                    material: pm.material,
                  }))
                : [],
            /** 成品入库累计（与出货预检、扣库逻辑一致） */
            stockQuantity: stockByProduct.get(l.productId) ?? 0,
            recoveryStockQuantity:
              l.product.processingMode === "OUTSOURCE_INHOUSE"
                ? recoveryByProduct.get(l.productId) ?? 0
                : undefined,
          },
        };
      }),
    });
  } catch (e) {
    console.error("[GET /api/warehouse/sales-orders/[id]]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
