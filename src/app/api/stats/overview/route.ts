import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { parseStatsRange, statsRangeQuerySchema } from "@/lib/stats-range";
import { sumPurchaseExtraFeesByCustomerInRange } from "@/lib/purchase-extra-fees";
import { unitPriceToExclusive } from "@/lib/price-tax";

const OPERATION_COST_RATE = 0.08;

/** 销售行物料成本：商品 BOM 各行 用量×物料单价（含税供应商则 ÷1.1），再×本行销售数量 */
function materialCostForSalesLine(
  lineQty: number,
  productMaterials: {
    usageQty: unknown;
    material: {
      unitPrice: unknown;
      supplier: { priceIncludesTax: boolean };
    };
  }[],
): number {
  let s = 0;
  for (const pm of productMaterials) {
    const u = Number(pm.usageQty);
    let unit = Number(pm.material.unitPrice);
    if (!Number.isFinite(u) || !Number.isFinite(unit) || u < 0) continue;
    unit = unitPriceToExclusive(
      unit,
      pm.material.supplier.priceIncludesTax,
      "supplier",
    );
    s += lineQty * u * unit;
  }
  return s;
}


/**
 * 经营统计：销售、采购、财务（利润 = 销售未税 − 物料/加工成本 − 关联采购单附加费）、外发、出货、趋势、客户 TOP（须 stats.view）
 */
export async function GET(req: Request) {
  const auth = await requirePermission("stats.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const url = new URL(req.url);
  const parsed = statsRangeQuerySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  const { from, to } = parseStatsRange(parsed.data.from, parsed.data.to);

  try {
    const purchaseWhere = {
      createdAt: { gte: from, lte: to },
      status: { not: "CANCELLED" as const },
    };
    const salesWhere = { createdAt: { gte: from, lte: to } };
    const deliveredOrderWhere = {
      actualDeliveredAt: { gte: from, lte: to, not: null },
    };
    const shipLogWhere = {
      batchDeliveredAt: { gte: from, lte: to },
    };

    const [
      salesInRange,
      salesDeliveredInRange,
      openSales,
      poCount,
      poLines,
      shipAgg,
      outsourceOpen,
      outsourceCreated,
      salesLinesForFinance,
    ] = await Promise.all([
      prisma.salesOrder.aggregate({
        where: salesWhere,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      prisma.salesOrder.aggregate({
        where: deliveredOrderWhere,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      prisma.salesOrder.count({ where: { actualDeliveredAt: null } }),
      prisma.purchaseOrder.count({ where: purchaseWhere }),
      prisma.purchaseOrderLine.findMany({
        where: { purchaseOrder: purchaseWhere },
        select: { quantity: true, unitPrice: true },
      }),
      prisma.salesOrderLineShipLog.aggregate({
        where: shipLogWhere,
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      prisma.outsourceOrder.count({ where: { status: "OPEN" } }),
      prisma.outsourceOrder.count({
        where: {
          status: { not: "CANCELLED" },
          createdAt: { gte: from, lte: to },
        },
      }),
      prisma.salesOrderLine.findMany({
        where: { salesOrder: salesWhere },
        select: {
          quantity: true,
          unitPrice: true,
          product: {
            select: {
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
          salesOrder: {
            select: {
              customerId: true,
              customer: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  priceIncludesTax: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const purchaseAmount = poLines.reduce(
      (s, l) => s + l.quantity * Number(l.unitPrice),
      0,
    );
    const extraFeesAgg = await sumPurchaseExtraFeesByCustomerInRange(from, to);

    const financeByCustomer = new Map<
      string,
      {
        customerId: string;
        code: string;
        name: string;
        revenue: number;
        cost: number;
        profit: number;
        pureProfit: number;
      }
    >();
    for (const line of salesLinesForFinance) {
      const k = line.salesOrder.customerId;
      const c = line.salesOrder.customer;
      const q = line.quantity;
      const saleUnit = unitPriceToExclusive(
        Number(line.unitPrice),
        line.salesOrder.customer.priceIncludesTax,
        "customer",
      );
      const rev = q * saleUnit;
      const matCost = materialCostForSalesLine(q, line.product.productMaterials);
      const procCost = q * Number(line.product.processingCost);
      const cst = matCost + procCost;
      const prof = rev - cst;
      const pureProf = prof - rev * OPERATION_COST_RATE;
      const prev = financeByCustomer.get(k);
      if (prev) {
        prev.revenue += rev;
        prev.cost += cst;
        prev.profit += prof;
        prev.pureProfit += pureProf;
      } else {
        financeByCustomer.set(k, {
          customerId: k,
          code: c.code,
          name: c.name,
          revenue: rev,
          cost: cst,
          profit: prof,
          pureProfit: pureProf,
        });
      }
    }
    const extraCustomerIdsMissing = [...extraFeesAgg.byCustomerId.keys()].filter(
      (id) => !financeByCustomer.has(id),
    );
    if (extraCustomerIdsMissing.length > 0) {
      const extraCustomers = await prisma.customer.findMany({
        where: { id: { in: extraCustomerIdsMissing } },
        select: { id: true, code: true, name: true },
      });
      for (const c of extraCustomers) {
        const extra = extraFeesAgg.byCustomerId.get(c.id) ?? 0;
        if (extra <= 0) continue;
        financeByCustomer.set(c.id, {
          customerId: c.id,
          code: c.code,
          name: c.name,
          revenue: 0,
          cost: extra,
          profit: -extra,
          pureProfit: -extra,
        });
      }
    }
    for (const row of financeByCustomer.values()) {
      const extra = extraFeesAgg.byCustomerId.get(row.customerId) ?? 0;
      if (extra <= 0) continue;
      row.cost += extra;
      row.profit -= extra;
      row.pureProfit -= extra;
    }

    const financeByCustomerList = Array.from(financeByCustomer.values()).sort(
      (a, b) => b.revenue - a.revenue,
    );
    const totalFinanceRevenue = financeByCustomerList.reduce((s, x) => s + x.revenue, 0);
    let totalFinanceCost =
      financeByCustomerList.reduce((s, x) => s + x.cost, 0) + extraFeesAgg.unlinked;
    let totalFinanceProfit =
      financeByCustomerList.reduce((s, x) => s + x.profit, 0) - extraFeesAgg.unlinked;
    let totalFinancePureProfit =
      financeByCustomerList.reduce((s, x) => s + x.pureProfit, 0) -
      extraFeesAgg.unlinked;

    const salesOrdersInRange = await prisma.salesOrder.findMany({
      where: salesWhere,
      select: { totalAmount: true, customerId: true },
    });
    const byCustomer = new Map<string, number>();
    for (const o of salesOrdersInRange) {
      byCustomer.set(
        o.customerId,
        (byCustomer.get(o.customerId) ?? 0) + Number(o.totalAmount),
      );
    }
    const topIds = Array.from(byCustomer.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const customers = topIds.length
      ? await prisma.customer.findMany({
          where: { id: { in: topIds.map(([id]) => id) } },
          select: { id: true, code: true, name: true },
        })
      : [];
    const cMap = new Map(customers.map((c) => [c.id, c]));
    const topCustomers = topIds.map(([id, amount]) => {
      const c = cMap.get(id);
      return {
        customerId: id,
        code: c?.code ?? "—",
        name: c?.name ?? "—",
        orderAmount: amount,
      };
    });

    const trendMonths: {
      month: string;
      label: string;
      salesAmount: number;
      purchaseAmount: number;
      shipQuantity: number;
    }[] = [];
    for (let i = 5; i >= 0; i--) {
      const end = new Date(to);
      const monthEnd = new Date(
        end.getFullYear(),
        end.getMonth() - i,
        1,
        0,
        0,
        0,
        0,
      );
      const mStart = new Date(
        monthEnd.getFullYear(),
        monthEnd.getMonth(),
        1,
        0,
        0,
        0,
        0,
      );
      const mEnd = new Date(
        monthEnd.getFullYear(),
        monthEnd.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
      const [sAgg, pLines, sh] = await Promise.all([
        prisma.salesOrder.aggregate({
          where: { createdAt: { gte: mStart, lte: mEnd } },
          _sum: { totalAmount: true },
        }),
        prisma.purchaseOrderLine.findMany({
          where: {
            purchaseOrder: {
              createdAt: { gte: mStart, lte: mEnd },
              status: { not: "CANCELLED" },
            },
          },
          select: { quantity: true, unitPrice: true },
        }),
        prisma.salesOrderLineShipLog.aggregate({
          where: { batchDeliveredAt: { gte: mStart, lte: mEnd } },
          _sum: { quantity: true },
        }),
      ]);
      const pAmt = pLines.reduce(
        (a, l) => a + l.quantity * Number(l.unitPrice),
        0,
      );
      trendMonths.push({
        month: `${mStart.getFullYear()}-${String(mStart.getMonth() + 1).padStart(2, "0")}`,
        label: `${mStart.getFullYear()}-${String(mStart.getMonth() + 1).padStart(2, "0")}`,
        salesAmount: Number(sAgg._sum.totalAmount ?? 0),
        purchaseAmount: pAmt,
        shipQuantity: sh._sum.quantity ?? 0,
      });
    }

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      sales: {
        orderCount: salesInRange._count._all,
        orderAmount: Number(salesInRange._sum.totalAmount ?? 0),
        fullDeliveredOrderCount: salesDeliveredInRange._count._all,
        fullDeliveredAmount: Number(salesDeliveredInRange._sum.totalAmount ?? 0),
        openOrderCount: openSales,
      },
      purchase: {
        orderCount: poCount,
        orderAmount: purchaseAmount,
      },
      ship: {
        batchCount: shipAgg._count._all,
        quantity: shipAgg._sum.quantity ?? 0,
      },
      outsource: { openCount: outsourceOpen, createdInRange: outsourceCreated },
      finance: {
        totalRevenue: totalFinanceRevenue,
        totalCost: totalFinanceCost,
        totalProfit: totalFinanceProfit,
        totalPureProfit: totalFinancePureProfit,
        purchaseExtraFeeTotal: extraFeesAgg.total,
        purchaseExtraFeeUnlinked: extraFeesAgg.unlinked,
        operationCostRate: OPERATION_COST_RATE,
        byCustomer: financeByCustomerList,
      },
      trend: trendMonths,
      topCustomers,
    });
  } catch (e) {
    console.error("[GET /api/stats/overview]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "统计失败" },
      { status: 500 },
    );
  }
}
