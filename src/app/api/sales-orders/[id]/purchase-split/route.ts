import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

type MatWithSup = Prisma.MaterialGetPayload<{
  include: {
    supplier: true;
    customer: { select: { id: true; name: true } };
  };
}>;

function ceilQty(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.ceil(raw - 1e-9));
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

    /** materialId -> 需求数量、物料 */
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

    for (const line of order.lines) {
      const p = line.product;
      const bomLines: (typeof bomByProduct)[0]["bomLines"] = [];
      for (const pm of p.productMaterials) {
        const raw = Number(pm.usageQty) * line.quantity;
        const q = ceilQty(raw);
        const mat = pm.material as MatWithSup;
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
        productStockAgg.map((x) => [x.productId, Math.trunc(Number(x._sum.quantity ?? 0))]),
      );
      for (const item of bomByProduct) {
        item.productStockQty = stockByProductId.get(item.productId) ?? 0;
      }
    }

    /** 按供应商分组 */
    const supplierGroups = new Map<
      string,
      {
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
          /** 与生成采购单时计算要求交货日一致 */
          deliveryLeadDays: number | null;
        };
        lines: {
          materialId: string;
          code: string;
          model: string;
          spec: string;
          unit: string;
          suggestedQty: number;
          unitPrice: string;
        }[];
      }
    >();

    for (const { qty, material: m } of needMap.values()) {
      const sid = m.supplierId;
      if (!supplierGroups.has(sid)) {
        const s = m.supplier;
        supplierGroups.set(sid, {
          supplier: {
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
          },
          lines: [],
        });
      }
      supplierGroups.get(sid)!.lines.push({
        materialId: m.id,
        code: m.code,
        model: m.name,
        spec: m.partDescription ?? "",
        unit: m.unit,
        suggestedQty: qty,
        unitPrice: m.unitPrice.toString(),
      });
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
      bomByProduct,
      supplierGroups: Array.from(supplierGroups.values()),
    });
  } catch (e) {
    console.error("[GET /api/sales-orders/[id]/purchase-split]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
