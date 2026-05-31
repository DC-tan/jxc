import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { sumPurchaseExtraFeesForSalesOrderIds } from "@/lib/purchase-extra-fees";
import { unitPriceToExclusive, unitPriceToInclusive } from "@/lib/price-tax";

const OPERATION_COST_RATE = 0.08;

type ProductLineAgg = {
  productId: string;
  customerMaterialCode: string;
  model: string;
  quantity: number;
  salesAmount: number;
  /** 按录入价折合的含税销售额（未税客户 ×1.13，含税客户为录入价） */
  salesAmountInclusive: number;
  materialCostPerUnit: number;
  processingCostPerUnit: number;
  baseCostAmount: number;
  operationCostAmount: number;
  profitAmount: number;
  profitRate: number;
  hasCostGap: boolean;
};

type QueryKind = "order" | "product";

function round2(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function appendAggLine(
  byProduct: Map<string, ProductLineAgg>,
  line: {
    quantity: number;
    unitPrice: number;
    customerPriceIncludesTax: boolean;
    product: {
      id: string;
      customerMaterialCode: string;
      model: string;
      processingCost: number;
      productMaterials: {
        usageQty: number;
        materialUnitPrice: number;
        supplierPriceIncludesTax: boolean;
      }[];
    };
  },
) {
  const qty = Number(line.quantity ?? 0);
  const rawUnitPrice = Number(line.unitPrice ?? 0);
  const saleUnitPrice = unitPriceToExclusive(
    rawUnitPrice,
    line.customerPriceIncludesTax,
    "customer",
  );
  const saleUnitInclusive = unitPriceToInclusive(
    rawUnitPrice,
    line.customerPriceIncludesTax,
    "customer",
  );
  const salesAmount = qty * saleUnitPrice;
  const salesAmountInclusive = qty * saleUnitInclusive;

  let materialCostPerUnit = 0;
  for (const pm of line.product.productMaterials) {
    const usageQty = Number(pm.usageQty ?? 0);
    let materialUnitPrice = Number(pm.materialUnitPrice ?? 0);
    if (!Number.isFinite(usageQty) || !Number.isFinite(materialUnitPrice)) continue;
    if (usageQty < 0 || materialUnitPrice < 0) continue;
    materialUnitPrice = unitPriceToExclusive(
      materialUnitPrice,
      pm.supplierPriceIncludesTax,
      "supplier",
    );
    materialCostPerUnit += usageQty * materialUnitPrice;
  }
  const processingCostPerUnit = Number(line.product.processingCost ?? 0);
  const baseCostPerUnit = materialCostPerUnit + processingCostPerUnit;
  const baseCostAmount = baseCostPerUnit * qty;
  const operationCostAmount = salesAmount * OPERATION_COST_RATE;
  const profitAmount = salesAmount - baseCostAmount - operationCostAmount;
  const hasCostGap =
    line.product.productMaterials.length === 0 ||
    !Number.isFinite(processingCostPerUnit);

  const prev = byProduct.get(line.product.id);
  if (prev) {
    prev.quantity += qty;
    prev.salesAmount += salesAmount;
    prev.salesAmountInclusive += salesAmountInclusive;
    prev.baseCostAmount += baseCostAmount;
    prev.operationCostAmount += operationCostAmount;
    prev.profitAmount += profitAmount;
    prev.hasCostGap = prev.hasCostGap || hasCostGap;
    return;
  }
  byProduct.set(line.product.id, {
    productId: line.product.id,
    customerMaterialCode: line.product.customerMaterialCode || "—",
    model: line.product.model || "—",
    quantity: qty,
    salesAmount,
    salesAmountInclusive,
    materialCostPerUnit,
    processingCostPerUnit: Number.isFinite(processingCostPerUnit)
      ? processingCostPerUnit
      : 0,
    baseCostAmount,
    operationCostAmount,
    profitAmount,
    profitRate: 0,
    hasCostGap,
  });
}

export async function GET(req: Request) {
  const auth = await requirePermission("stats.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const orderNo = searchParams.get("orderNo")?.trim() || "";
  const productId = searchParams.get("productId")?.trim() || "";
  if (!orderNo && !productId) {
    return NextResponse.json({ error: "请先输入销售订单号或选择商品" }, { status: 400 });
  }

  try {
    const queryKind: QueryKind = productId ? "product" : "order";
    const byProduct = new Map<string, ProductLineAgg>();
    let targetProduct:
      | { id: string; model: string; customerMaterialCode: string }
      | null = null;
    let orderCount = 0;
    let customers: { id: string; code: string; name: string }[] = [];
    let purchaseExtraFeeAmount = 0;

    if (queryKind === "product") {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          model: true,
          customerMaterialCode: true,
          price: true,
          processingCost: true,
          customer: {
            select: { id: true, code: true, name: true, priceIncludesTax: true },
          },
          productMaterials: {
            select: {
              usageQty: true,
              material: {
                select: {
                  unitPrice: true,
                  supplier: { select: { priceIncludesTax: true } },
                },
              },
            },
          },
        },
      });
      if (!product) {
        return NextResponse.json({ error: "商品不存在或已删除" }, { status: 404 });
      }
      targetProduct = {
        id: product.id,
        model: product.model,
        customerMaterialCode: product.customerMaterialCode,
      };
      customers = [
        { id: product.customer.id, code: product.customer.code, name: product.customer.name },
      ];
      appendAggLine(byProduct, {
        quantity: 1,
        unitPrice: Number(product.price ?? 0),
        customerPriceIncludesTax: product.customer.priceIncludesTax,
        product: {
          id: product.id,
          customerMaterialCode: product.customerMaterialCode,
          model: product.model,
          processingCost: Number(product.processingCost ?? 0),
          productMaterials: product.productMaterials.map((pm) => ({
            usageQty: Number(pm.usageQty ?? 0),
            materialUnitPrice: Number(pm.material.unitPrice ?? 0),
            supplierPriceIncludesTax: pm.material.supplier.priceIncludesTax,
          })),
        },
      });
    } else {
      const orders = await prisma.salesOrder.findMany({
        where: { customerOrderNo: orderNo },
        orderBy: { createdAt: "desc" },
        include: {
          customer: {
            select: { id: true, code: true, name: true, priceIncludesTax: true },
          },
          lines: {
            select: {
              quantity: true,
              unitPrice: true,
              product: {
                select: {
                  id: true,
                  customerMaterialCode: true,
                  model: true,
                  processingCost: true,
                  productMaterials: {
                    select: {
                      usageQty: true,
                      material: {
                        select: {
                          unitPrice: true,
                          supplier: { select: { priceIncludesTax: true } },
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

      if (orders.length === 0) {
        return NextResponse.json({ error: "未找到该销售订单号" }, { status: 404 });
      }
      orderCount = orders.length;
      customers = Array.from(
        new Map(
          orders.map((o) => [
            o.customer.id,
            {
              id: o.customer.id,
              code: o.customer.code,
              name: o.customer.name,
            },
          ]),
        ).values(),
      );
      purchaseExtraFeeAmount = await sumPurchaseExtraFeesForSalesOrderIds(
        orders.map((o) => o.id),
      );

      for (const order of orders) {
        for (const line of order.lines) {
          appendAggLine(byProduct, {
            quantity: Number(line.quantity ?? 0),
            unitPrice: Number(line.unitPrice ?? 0),
            customerPriceIncludesTax: order.customer.priceIncludesTax,
            product: {
              id: line.product.id,
              customerMaterialCode: line.product.customerMaterialCode,
              model: line.product.model,
              processingCost: Number(line.product.processingCost ?? 0),
              productMaterials: line.product.productMaterials.map((pm) => ({
                usageQty: Number(pm.usageQty ?? 0),
                materialUnitPrice: Number(pm.material.unitPrice ?? 0),
                supplierPriceIncludesTax: pm.material.supplier.priceIncludesTax,
              })),
            },
          });
        }
      }
    }

    const rows = Array.from(byProduct.values())
      .map((r) => {
        const profitRate = r.salesAmount > 0 ? r.profitAmount / r.salesAmount : 0;
        return {
          ...r,
          quantity: round2(r.quantity),
          salesAmount: round2(r.salesAmount),
          salesAmountInclusive: round2(r.salesAmountInclusive),
          materialCostPerUnit: round2(r.materialCostPerUnit),
          processingCostPerUnit: round2(r.processingCostPerUnit),
          baseCostAmount: round2(r.baseCostAmount),
          operationCostAmount: round2(r.operationCostAmount),
          profitAmount: round2(r.profitAmount),
          profitRate: round2(profitRate * 100),
        };
      })
      .sort((a, b) => b.profitAmount - a.profitAmount);

    const summary = rows.reduce(
      (acc, r) => {
        acc.quantity += r.quantity;
        acc.salesAmount += r.salesAmount;
        acc.salesAmountInclusive += r.salesAmountInclusive;
        acc.baseCostAmount += r.baseCostAmount;
        acc.operationCostAmount += r.operationCostAmount;
        acc.profitAmount += r.profitAmount;
        return acc;
      },
      {
        quantity: 0,
        salesAmount: 0,
        salesAmountInclusive: 0,
        baseCostAmount: 0,
        operationCostAmount: 0,
        profitAmount: 0,
      },
    );
    if (queryKind === "order") {
      summary.baseCostAmount += purchaseExtraFeeAmount;
      summary.profitAmount -= purchaseExtraFeeAmount;
    }
    const summaryProfitRate =
      summary.salesAmount > 0
        ? (summary.profitAmount / summary.salesAmount) * 100
        : 0;

    return NextResponse.json({
      queryKind,
      orderNo,
      product: targetProduct,
      operationCostRate: OPERATION_COST_RATE,
      orderCount,
      customers,
      rows,
      summary: {
        quantity: round2(summary.quantity),
        salesAmount: round2(summary.salesAmount),
        salesAmountInclusive: round2(summary.salesAmountInclusive),
        baseCostAmount: round2(summary.baseCostAmount),
        operationCostAmount: round2(summary.operationCostAmount),
        purchaseExtraFeeAmount: round2(purchaseExtraFeeAmount),
        profitAmount: round2(summary.profitAmount),
        profitRate: round2(summaryProfitRate),
      },
    });
  } catch (e) {
    console.error("[GET /api/stats/order-profit]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "查询利润失败" },
      { status: 500 },
    );
  }
}
