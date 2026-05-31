import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { sumActivePurchaseQtyByMaterial } from "@/lib/purchase-sales-ordered-qty";

type MatWithSup = Prisma.MaterialGetPayload<{
  include: {
    supplier: true;
    customer: { select: { id: true; name: true } };
  };
}>;

type SplitLineOut = {
  materialId: string;
  code: string;
  model: string;
  spec: string;
  unit: string;
  bomNeedQty: number;
  orderedQty: number;
  suggestedQty: number;
  unitPrice: string;
};

type SupplierGroupOut = {
  supplier: {
    id: string;
    code: string;
    name: string;
    shortName: string | null;
    contactPerson: string | null;
    phone: string | null;
    address: string | null;
    bankName: string | null;
    bankAccount: string | null;
    taxRegistrationNo: string | null;
    deliveryLeadDays: number | null;
    priceIncludesTax: boolean;
  };
  lines: SplitLineOut[];
  /** 补开时对应已取消的采购单号 */
  redoCancelledOrderNos?: string[];
};

function ceilQty(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.ceil(raw - 1e-9));
}

function isStandardPurchase(material: { purchaseChannel?: string | null }): boolean {
  return (material.purchaseChannel ?? "STANDARD_PURCHASE") === "STANDARD_PURCHASE";
}

function supplierSnapshot(
  s: Prisma.SupplierGetPayload<object>,
): SupplierGroupOut["supplier"] {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    shortName: s.shortName,
    contactPerson: s.contactPerson,
    phone: s.phone,
    address: s.address,
    bankName: s.bankName,
    bankAccount: s.bankAccount,
    taxRegistrationNo: s.taxRegistrationNo,
    deliveryLeadDays: s.deliveryLeadDays ?? null,
    priceIncludesTax: s.priceIncludesTax,
  };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("purchase.create");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;

  try {
    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        lines: {
          orderBy: { sortOrder: "asc" },
          include: {
            product: {
              select: {
                id: true,
                customerMaterialCode: true,
                model: true,
                spec: true,
                unit: true,
                productMaterials: {
                  orderBy: { sortOrder: "asc" },
                  include: {
                    material: {
                      include: {
                        supplier: true,
                        customer: { select: { id: true, name: true } },
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

    if (!order) {
      return NextResponse.json({ error: "销售订单不存在" }, { status: 404 });
    }

    const cancelledOrders = await prisma.purchaseOrder.findMany({
      where: { salesOrderId: order.id, status: "CANCELLED" },
      orderBy: { createdAt: "asc" },
      include: {
        supplier: true,
        lines: {
          orderBy: { sortOrder: "asc" },
          include: {
            material: {
              include: {
                supplier: true,
                customer: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    let splitMode: "full_bom" | "redo_cancelled" | "partial_redo" =
      cancelledOrders.length > 0 ? "redo_cancelled" : "full_bom";

    /** materialId -> 需求数量、物料（整单 BOM 模式） */
    const needMap = new Map<string, { qty: number; material: MatWithSup }>();

    const bomByProduct: {
      productId: string;
      customerMaterialCode: string;
      model: string;
      spec: string;
      unit: string;
      salesQty: number;
      productStockQty: number;
      bomLines: {
        materialId: string;
        code: string;
        name: string;
        partDescription: string | null;
        unit: string;
        usageQty: string;
        needQty: number;
        supplierName: string;
      }[];
    }[] = [];

    const redoMaterialIds = new Set<string>();

    for (const line of order.lines) {
      const p = line.product;
      const bomLines: (typeof bomByProduct)[0]["bomLines"] = [];
      for (const pm of p.productMaterials) {
        const raw = Number(pm.usageQty) * line.quantity;
        const q = ceilQty(raw);
        const mat = pm.material as MatWithSup;
        const purchaseByStandard = isStandardPurchase(mat as { purchaseChannel?: string | null });
        if (!purchaseByStandard) continue;
        if (!mat.isCustomerSupplied) {
          const prev = needMap.get(mat.id);
          if (prev) {
            prev.qty += q;
          } else {
            needMap.set(mat.id, { qty: q, material: mat });
          }
        }
        bomLines.push({
          materialId: mat.id,
          code: mat.code,
          name: mat.name,
          partDescription: mat.partDescription,
          unit: mat.unit,
          usageQty: String(pm.usageQty),
          needQty: q,
          supplierName: mat.isCustomerSupplied
            ? `客供：${mat.customer?.name ?? "未设置客户"}`
            : mat.supplier.name,
        });
      }
      bomByProduct.push({
        productId: p.id,
        customerMaterialCode: p.customerMaterialCode,
        model: p.model,
        spec: p.spec,
        unit: p.unit,
        salesQty: line.quantity,
        productStockQty: 0,
        bomLines,
      });
    }

    const productIds = [...new Set(order.lines.map((l) => l.product.id))];
    if (productIds.length > 0) {
      const productStockAgg = await prisma.productInbound.groupBy({
        by: ["productId"],
        where: { productId: { in: productIds } },
        _sum: { quantity: true },
      });
      const stockByProductId = new Map(
        productStockAgg.map((x) => [
          x.productId,
          Math.trunc(Number(x._sum.quantity ?? 0)),
        ]),
      );
      for (const item of bomByProduct) {
        item.productStockQty = stockByProductId.get(item.productId) ?? 0;
      }
    }

    let supplierGroups: SupplierGroupOut[] = [];
    const orderedQtyByMaterial: Record<string, number> = {};

    if (splitMode === "redo_cancelled") {
      const groupMap = new Map<string, SupplierGroupOut>();

      for (const po of cancelledOrders) {
        const sid = po.supplierId;
        if (!groupMap.has(sid)) {
          groupMap.set(sid, {
            supplier: supplierSnapshot(po.supplier),
            lines: [],
            redoCancelledOrderNos: [],
          });
        }
        const g = groupMap.get(sid)!;
        if (!g.redoCancelledOrderNos!.includes(po.orderNo)) {
          g.redoCancelledOrderNos!.push(po.orderNo);
        }

        const lineByMat = new Map(
          g.lines.map((l) => [l.materialId, l] as const),
        );

        for (const pl of po.lines) {
          const m = pl.material;
          if (!isStandardPurchase(m as { purchaseChannel?: string | null })) continue;
          if (m.isCustomerSupplied) continue;
          redoMaterialIds.add(m.id);
          const qty = Math.max(0, Math.trunc(Number(pl.quantity)));
          const unitPrice = pl.unitPrice.toString();
          const existing = lineByMat.get(m.id);
          if (existing) {
            existing.bomNeedQty += qty;
            existing.suggestedQty += qty;
          } else {
            const row: SplitLineOut = {
              materialId: m.id,
              code: m.code,
              model: m.name,
              spec: m.partDescription ?? "",
              unit: m.unit,
              bomNeedQty: qty,
              orderedQty: 0,
              suggestedQty: qty,
              unitPrice,
            };
            g.lines.push(row);
            lineByMat.set(m.id, row);
          }
        }
      }

      supplierGroups = Array.from(groupMap.values()).filter(
        (g) => g.lines.length > 0,
      );

      for (const item of bomByProduct) {
        item.bomLines = item.bomLines.filter((bl) =>
          redoMaterialIds.has(bl.materialId),
        );
      }
    } else {
      const orderedByMaterial = await sumActivePurchaseQtyByMaterial(
        prisma,
        order.id,
      );
      for (const [mid, q] of orderedByMaterial) {
        orderedQtyByMaterial[mid] = q;
      }

      const supplierGroupsMap = new Map<string, SupplierGroupOut>();

      for (const { qty, material: m } of needMap.values()) {
        const orderedQty = orderedByMaterial.get(m.id) ?? 0;
        const remaining = Math.max(0, qty - orderedQty);
        if (remaining <= 0) continue;

        const sid = m.supplierId;
        if (!supplierGroupsMap.has(sid)) {
          supplierGroupsMap.set(sid, {
            supplier: supplierSnapshot(m.supplier),
            lines: [],
          });
        }
        supplierGroupsMap.get(sid)!.lines.push({
          materialId: m.id,
          code: m.code,
          model: m.name,
          spec: m.partDescription ?? "",
          unit: m.unit,
          bomNeedQty: qty,
          orderedQty,
          suggestedQty: remaining,
          unitPrice: m.unitPrice.toString(),
        });
      }

      supplierGroups = Array.from(supplierGroupsMap.values()).filter(
        (g) => g.lines.length > 0,
      );
      const hasActiveCoverage = orderedByMaterial.size > 0;
      splitMode =
        hasActiveCoverage && supplierGroups.length > 0
          ? "partial_redo"
          : "full_bom";
    }

    return NextResponse.json({
      salesOrder: {
        id: order.id,
        customerOrderNo: order.customerOrderNo,
        customerModel: order.customerModel,
        customer: order.customer,
        createdAt: order.createdAt.toISOString(),
        deliveryDueAt: order.deliveryDueAt
          ? order.deliveryDueAt.toISOString()
          : null,
      },
      splitMode,
      bomByProduct: bomByProduct.filter((bp) => bp.bomLines.length > 0),
      orderedQtyByMaterial,
      supplierGroups,
    });
  } catch (e) {
    console.error("[GET /api/sales-orders/[id]/purchase-split]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
