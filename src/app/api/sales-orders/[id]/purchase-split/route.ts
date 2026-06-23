import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { OutsourceOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { sumActivePurchaseQtyByMaterial } from "@/lib/purchase-sales-ordered-qty";
import { listSkippedPurchaseMaterialIds } from "@/lib/purchase-sales-skip-material";
import {
  computeOutsourceLineStockSplit,
  perSetFromProductMaterials,
} from "@/lib/outsource-material-stock-balance";

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

type ProcessorOptionOut = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
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

function addOutsourceStockByProcessorMaterial(
  map: Map<string, number>,
  supplierId: string | null | undefined,
  materialId: string,
  quantity: number,
) {
  const sid = supplierId?.trim();
  if (!sid) return;
  if (!Number.isFinite(quantity) || quantity <= 0) return;
  const key = `${sid}::${materialId}`;
  map.set(key, (map.get(key) ?? 0) + quantity);
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
                processingMode: true,
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
      processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
      bomLines: {
        materialId: string;
        code: string;
        name: string;
        partDescription: string | null;
        unit: string;
        usageQty: string;
        needQty: number;
        supplierName: string;
        scope: "DEFAULT" | "OUTSOURCE" | "INHOUSE";
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
          scope: pm.scope,
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
        processingMode: p.processingMode,
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
    const outsourceStockByProcessorMaterial = new Map<string, number>();

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
      const [orderedByMaterial, skippedMaterialIds] = await Promise.all([
        sumActivePurchaseQtyByMaterial(prisma, order.id),
        listSkippedPurchaseMaterialIds(prisma, order.id),
      ]);
      for (const [mid, q] of orderedByMaterial) {
        orderedQtyByMaterial[mid] = q;
      }

      const supplierGroupsMap = new Map<string, SupplierGroupOut>();

      for (const { qty, material: m } of needMap.values()) {
        if (skippedMaterialIds.has(m.id)) continue;
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

    const relevantMaterialIds = [
      ...new Set(
        bomByProduct
          .flatMap((bp) => bp.bomLines.map((l) => l.materialId))
          .filter(Boolean),
      ),
    ];
    if (relevantMaterialIds.length > 0) {
      const rows = await prisma.outsourceOrderLine.findMany({
        where: {
          materialId: { in: relevantMaterialIds },
          outsourceOrder: {
            status: { in: [OutsourceOrderStatus.OPEN, OutsourceOrderStatus.CLOSED] },
          },
        },
        select: {
          materialId: true,
          quantity: true,
          issuedQuantity: true,
          outsourceOrder: {
            select: {
              id: true,
              orderNo: true,
              status: true,
              productQty: true,
              supplierId: true,
              product: {
                select: {
                  processingMode: true,
                  productMaterials: {
                    select: { materialId: true, usageQty: true, scope: true },
                  },
                },
              },
            },
          },
        },
      });
      const orderIds = [
        ...new Set(rows.map((r) => r.outsourceOrder.id).filter((x) => Boolean(x))),
      ];
      const orderNos = [
        ...new Set(
          rows
            .map((r) => r.outsourceOrder.orderNo?.trim())
            .filter((x): x is string => Boolean(x)),
        ),
      ];
      const [productSetsRows, recoverySetsRows, warehouseRows, closeReturnRows] =
        await Promise.all([
          prisma.productInbound.groupBy({
            by: ["purchaseOrderNo"],
            where: { purchaseOrderNo: { in: orderNos }, quantity: { gt: 0 } },
            _sum: { quantity: true },
          }),
          prisma.outsourceRecoveryInbound.groupBy({
            by: ["outsourceOrderId"],
            where: { outsourceOrderId: { in: orderIds }, quantity: { gt: 0 } },
            _sum: { quantity: true },
          }),
          prisma.materialInbound.groupBy({
            by: ["purchaseOrderNo", "materialId"],
            where: {
              purchaseOrderNo: { in: orderNos },
              quantity: { lt: 0 },
            },
            _sum: { quantity: true },
          }),
          prisma.materialInbound.groupBy({
            by: ["purchaseOrderNo", "materialId"],
            where: {
              purchaseOrderNo: { in: orderNos },
              quantity: { gt: 0 },
              partDescription: { startsWith: "外发结单退回" },
            },
            _sum: { quantity: true },
          }),
        ]);

      const productSetsByOrderNo = new Map<string, number>();
      for (const r of productSetsRows) {
        if (r.purchaseOrderNo) {
          productSetsByOrderNo.set(r.purchaseOrderNo, Number(r._sum.quantity ?? 0));
        }
      }
      const recoverySetsByOrderId = new Map<string, number>();
      for (const r of recoverySetsRows) {
        if (r.outsourceOrderId) {
          recoverySetsByOrderId.set(r.outsourceOrderId, Number(r._sum.quantity ?? 0));
        }
      }
      const warehouseByOrderMaterial = new Map<string, number>();
      for (const r of warehouseRows) {
        if (!r.purchaseOrderNo) continue;
        const key = `${r.purchaseOrderNo}::${r.materialId}`;
        warehouseByOrderMaterial.set(key, Math.abs(Number(r._sum.quantity ?? 0)));
      }
      const closeReturnByOrderMaterial = new Map<string, number>();
      for (const r of closeReturnRows) {
        if (!r.purchaseOrderNo) continue;
        const key = `${r.purchaseOrderNo}::${r.materialId}`;
        closeReturnByOrderMaterial.set(key, Number(r._sum.quantity ?? 0));
      }

      for (const row of rows) {
        const orderNo = row.outsourceOrder.orderNo?.trim() ?? "";
        const omKey = `${orderNo}::${row.materialId}`;
        const recoveredSets =
          row.outsourceOrder.product.processingMode === "OUTSOURCE_INHOUSE"
            ? recoverySetsByOrderId.get(row.outsourceOrder.id) ?? 0
            : productSetsByOrderNo.get(orderNo) ?? 0;
        const perSet = perSetFromProductMaterials(
          row.outsourceOrder.product.processingMode,
          row.outsourceOrder.product.productMaterials ?? [],
          row.materialId,
        );
        const split = computeOutsourceLineStockSplit({
          orderStatus: row.outsourceOrder.status,
          processingMode: row.outsourceOrder.product.processingMode,
          orderNo,
          materialId: row.materialId,
          productQty: row.outsourceOrder.productQty,
          issuedQuantity: row.issuedQuantity,
          storedQuantity: row.quantity,
          warehouseOutbound: warehouseByOrderMaterial.get(omKey) ?? 0,
          recoveredSets,
          closeReturnQty: closeReturnByOrderMaterial.get(omKey) ?? 0,
          perSet,
        });
        addOutsourceStockByProcessorMaterial(
          outsourceStockByProcessorMaterial,
          row.outsourceOrder.supplierId,
          row.materialId,
          split.poolRemaining,
        );
      }
    }

    const processorOptions = await prisma.supplier.findMany({
      where: { attrProcessing: true },
      select: { id: true, code: true, name: true, shortName: true },
      orderBy: [{ code: "asc" }, { name: "asc" }],
    });

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
      processorOptions: processorOptions.map(
        (s): ProcessorOptionOut => ({
          id: s.id,
          code: s.code,
          name: s.name,
          shortName: s.shortName,
        }),
      ),
      outsourceStockByProcessorMaterial: Object.fromEntries(
        [...outsourceStockByProcessorMaterial.entries()].map(([k, v]) => [
          k,
          Math.max(0, Math.trunc(v)),
        ]),
      ),
    });
  } catch (e) {
    console.error("[GET /api/sales-orders/[id]/purchase-split]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
