import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireLogin } from "@/lib/api-auth";
import {
  daysUntilCalendarDue,
  salesOrderStillNeedsPurchase,
  urgencyBucket,
} from "@/lib/dashboard-urgency";
import { outsourceUnmetAfterStockAllocation } from "@/lib/dashboard-outsource-reminder";
import {
  effectiveReconcileStartDay,
  isOnOrAfterReconcileStartDay,
  yearMonthOf,
} from "@/lib/reconcile-calendar";
import { getWorkbenchSettingsForUser } from "@/lib/workbench-for-user";

const take = 80;

/**
 * 首页看板：按权限分块返回；无权限的块为 `null`。
 */
export async function GET() {
  const auth = await requireLogin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { user } = auth;
  const p = (code: string) => user.isAdmin || user.permissionCodes.has(code);
  const r = (code: string) => user.isAdmin || user.rawPermissionCodes.has(code);
  const showHomeSales = () => r("tab.home.sales") || p("sales.view");
  const showHomePurchase = () => r("tab.home.purchase") || r("purchase.view");
  const showHomeReceiving = () => r("tab.home.receiving") || r("purchase.view");
  const showHomeOutsource = () => r("tab.home.outsource") || p("outsource.view");
  const showHomeOutsourceNeed = () =>
    r("tab.home.outsourceNeed") || p("outsource.view") || p("sales.view");
  const showHomeSamples = () => r("tab.home.samples") || p("sample.view");
  /** 首页顶部对帐横幅：供应商侧 / 客户侧，与权限矩阵「首页」子项一致；旧版凭 purchase.view / warehouse.view 仍可见 */
  const showHomeReconcileSupplier = () =>
    r("tab.home.reconcileSupplier") || r("purchase.view");
  const showHomeReconcileCustomer = () =>
    r("tab.home.reconcileCustomer") || r("warehouse.view");
  const loadPurchaseHome = () => showHomePurchase() || showHomeReceiving();
  const now = new Date();

  try {
    const wb = await getWorkbenchSettingsForUser(user.id);
    const urgencyT = {
      urgentRedMaxDays: wb.urgentRedMaxDays,
      lightRedMaxDays: wb.lightRedMaxDays,
      yellowMaxDays: wb.yellowMaxDays,
    };
    const payload: {
      salesDeliveries: {
        rows: {
          id: string;
          customerOrderNo: string;
          customerModel: string;
          customerName: string;
          deliveryDueAt: string;
          daysUntil: number;
          urgency: "deepRed" | "lightRed" | "yellow" | "blue";
        }[];
      } | null;
      needPurchase: {
        rows: {
          id: string;
          customerOrderNo: string;
          customerModel: string;
          customerName: string;
          deliveryDueAt: string | null;
          lineCount: number;
          createdAt: string;
          /** 尚未从本单建立任何未取消的采购单（新建销售单默认属此类，直至下推采购或标为无需采购） */
          unlinkedFromPurchase: boolean;
        }[];
        count: number;
        /** 无非取消采购单关联本单的数量（与 unlinkedFromPurchase 为 true 的行数一致） */
        unlinkedCount: number;
      } | null;
      /** 采购提醒文案：在办=草稿+待收；未收满=待收料单中按入库累计仍短于订单行的明细行数 */
      purchaseSummary: {
        openOrderCount: number;
        partialLineNotFullCount: number;
        waitSalesPurchaseOrderCount: number;
        /** 尚无任何关联采购单的销售单数，含新建后待下推采购的订单 */
        waitSalesUnlinkedFromPurchaseCount: number;
      } | null;
      purchasePendingReceive: {
        rows: {
          id: string;
          orderNo: string;
          supplierName: string;
          deliveryDueAt: string | null;
          daysUntil: number | null;
          urgency: "deepRed" | "lightRed" | "yellow" | "blue" | "gray";
        }[];
        count: number;
      } | null;
      outsourceUnrecovered: {
        rows: {
          id: string;
          orderNo: string;
          productModel: string;
          supplierName: string;
          productQty: number;
          createdAt: string;
        }[];
        count: number;
      } | null;
      needOutsourceRows: {
        count: number;
        sampleRows: {
          id: string;
          salesOrderId: string;
          customerOrderNo: string;
          customerName: string;
          productModel: string;
          quantity: number;
          quantityShipped: number;
          processingMode: "OUTSOURCE" | "OUTSOURCE_INHOUSE";
          unmetByStock: number;
          productOnHand: number;
        }[];
      } | null;
      sampleReminders: {
        rows: {
          id: string;
          customerName: string;
          model: string;
          quantity: number;
          sampleDueAt: string;
          daysUntil: number;
          urgency: "deepRed" | "lightRed" | "yellow" | "blue";
        }[];
        count: number;
      } | null;
      reconcileReminders: {
        supplier: { show: true; message: string; link: string } | null;
        customer: { show: true; message: string; link: string } | null;
        /** 仅具备 stats.view 且无采购/仓权限时 */
        other: { show: true; message: string; link: string } | null;
      };
    } = {
      salesDeliveries: null,
      needPurchase: null,
      purchaseSummary: null,
      purchasePendingReceive: null,
      outsourceUnrecovered: null,
      needOutsourceRows: null,
      sampleReminders: null,
      reconcileReminders: { supplier: null, customer: null, other: null },
    };

    if (showHomeSales()) {
      const orders = await prisma.salesOrder.findMany({
        where: {
          actualDeliveredAt: null,
          deliveryDueAt: { not: null },
        },
        orderBy: { deliveryDueAt: "asc" },
        take,
        include: { customer: { select: { name: true } } },
      });
      const rows = orders.map((o) => {
        const d = o.deliveryDueAt!;
        const daysUntil = daysUntilCalendarDue(d, now);
        return {
          id: o.id,
          customerOrderNo: o.customerOrderNo?.trim() || "—",
          customerModel: o.customerModel?.trim() || "—",
          customerName: o.customer.name?.trim() || "—",
          deliveryDueAt: d.toISOString(),
          daysUntil,
          urgency: urgencyBucket(daysUntil, urgencyT),
        };
      });
      payload.salesDeliveries = { rows };
    }

    if (loadPurchaseHome()) {
      const [list, pos] = await Promise.all([
        prisma.salesOrder.findMany({
          where: { actualDeliveredAt: null, noPurchaseRequiredAt: null },
          orderBy: { createdAt: "desc" },
          take: 500,
          include: {
            customer: { select: { name: true } },
            _count: { select: { lines: true } },
            purchaseOrders: { select: { status: true } },
          },
        }),
        prisma.purchaseOrder.findMany({
          where: { status: "PENDING_RECEIPT" as const },
          orderBy: { deliveryDueAt: "asc" },
          take: 120,
          include: { supplier: { select: { name: true } } },
        }),
      ]);
      const filtered = list.filter((r) =>
        salesOrderStillNeedsPurchase(r.purchaseOrders),
      );
      type SoRow = (typeof list)[number];
      const withUnlinked = filtered.map((r: SoRow) => {
        const active = r.purchaseOrders.filter((p) => p.status !== "CANCELLED");
        const unlinked = active.length === 0;
        return {
          r,
          unlinked,
          t: r.createdAt.getTime(),
        };
      });
      withUnlinked.sort((a, b) => {
        if (a.unlinked !== b.unlinked) {
          return a.unlinked ? -1 : 1;
        }
        return b.t - a.t;
      });
      const needCount = withUnlinked.length;
      const unlinkedCount = withUnlinked.filter((x) => x.unlinked).length;
      const needRows = withUnlinked.slice(0, 40).map(({ r, unlinked }) => ({
        id: r.id,
        customerOrderNo: r.customerOrderNo?.trim() || "—",
        customerModel: r.customerModel?.trim() || "—",
        customerName: r.customer.name?.trim() || "—",
        deliveryDueAt: r.deliveryDueAt?.toISOString() ?? null,
        lineCount: r._count.lines,
        createdAt: r.createdAt.toISOString(),
        unlinkedFromPurchase: unlinked,
      }));
      if (showHomePurchase()) {
        payload.needPurchase = { rows: needRows, count: needCount, unlinkedCount };
      }
      const sorted = [...pos].sort((a, b) => {
        if (!a.deliveryDueAt) return 1;
        if (!b.deliveryDueAt) return -1;
        return a.deliveryDueAt.getTime() - b.deliveryDueAt.getTime();
      });
      const prCount = pos.length;
      const prRows = sorted.slice(0, 50).map((po) => {
        if (!po.deliveryDueAt) {
          return {
            id: po.id,
            orderNo: po.orderNo,
            supplierName: po.supplier.name?.trim() || "—",
            deliveryDueAt: null,
            daysUntil: null,
            urgency: "gray" as const,
          };
        }
        const d = daysUntilCalendarDue(po.deliveryDueAt, now);
        return {
          id: po.id,
          orderNo: po.orderNo,
          supplierName: po.supplier.name?.trim() || "—",
          deliveryDueAt: po.deliveryDueAt.toISOString(),
          daysUntil: d,
          urgency: urgencyBucket(d, urgencyT),
        };
      });
      if (showHomeReceiving()) {
        payload.purchasePendingReceive = { rows: prRows, count: prCount };
      }

      const openOrderCount = await prisma.purchaseOrder.count({
        where: { status: { in: ["DRAFT", "PENDING_RECEIPT"] } },
      });
      const pendingWithLines = await prisma.purchaseOrder.findMany({
        where: { status: "PENDING_RECEIPT" as const },
        include: { lines: true },
      });
      const orderNos = pendingWithLines.map((p) => p.orderNo);
      let partialLineNotFullCount = 0;
      if (orderNos.length > 0) {
        const inb = await prisma.materialInbound.findMany({
          where: { purchaseOrderNo: { in: orderNos } },
        });
        const sumMap = new Map<string, number>();
        for (const x of inb) {
          if (!x.purchaseOrderNo) continue;
          const k = `${x.purchaseOrderNo}\t${x.materialId}`;
          sumMap.set(k, (sumMap.get(k) ?? 0) + x.quantity);
        }
        for (const po of pendingWithLines) {
          for (const line of po.lines) {
            const k = `${po.orderNo}\t${line.materialId}`;
            const got = sumMap.get(k) ?? 0;
            if (got < line.quantity) partialLineNotFullCount++;
          }
        }
      }
      if (showHomePurchase()) {
        payload.purchaseSummary = {
          openOrderCount,
          partialLineNotFullCount,
          waitSalesPurchaseOrderCount: needCount,
          waitSalesUnlinkedFromPurchaseCount: unlinkedCount,
        };
      }
    }

    if (showHomeOutsource()) {
      const open = await prisma.outsourceOrder.findMany({
        where: { status: "OPEN" as const },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          product: { select: { model: true } },
          supplier: { select: { name: true } },
        },
      });
      const count = await prisma.outsourceOrder.count({
        where: { status: "OPEN" },
      });
      const rows = open.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        productModel: o.product.model?.trim() || "—",
        supplierName: o.supplier?.name?.trim() || "（未指定外协方）",
        productQty: o.productQty,
        createdAt: o.createdAt.toISOString(),
      }));
      payload.outsourceUnrecovered = { rows, count };
    }

    /**
     * 外发/外发+自加工行：在「同商品、成品库存（ProductInbound 汇总，含出货扣减）」下，
     * 先满足待交**数量较少**的订单行，同量则**建单较早**优先；若库存仍无法覆盖，则对缺口行外发提醒。
     * 同商品含自加工行时，自加工行参与抢库存，不进入外发提醒。
     */
    if (showHomeOutsourceNeed()) {
      const seedLines = await prisma.salesOrderLine.findMany({
        where: {
          salesOrder: { actualDeliveredAt: null },
          product: { processingMode: { in: ["OUTSOURCE", "OUTSOURCE_INHOUSE"] } },
        },
        select: {
          id: true,
          productId: true,
          quantity: true,
          quantityShipped: true,
        },
      });
      const hotProductIds = [
        ...new Set(
          seedLines
            .filter((l) => l.quantity - l.quantityShipped > 0)
            .map((l) => l.productId),
        ),
      ];
      if (hotProductIds.length === 0) {
        payload.needOutsourceRows = { count: 0, sampleRows: [] };
      } else {
        const competing = await prisma.salesOrderLine.findMany({
          where: {
            productId: { in: hotProductIds },
            salesOrder: { actualDeliveredAt: null },
          },
          include: {
            salesOrder: {
              select: {
                id: true,
                createdAt: true,
                customerOrderNo: true,
                customer: { select: { name: true } },
              },
            },
            product: { select: { id: true, model: true, processingMode: true } },
          },
        });
        const activeCompeting = competing.filter(
          (l) => l.quantity - l.quantityShipped > 0,
        );
        const stockGroups = await prisma.productInbound.groupBy({
          by: ["productId"],
          where: { productId: { in: hotProductIds } },
          _sum: { quantity: true },
        });
        const stockByProduct = new Map(
          stockGroups.map((g) => [
            g.productId,
            Math.trunc(Number(g._sum.quantity ?? 0)),
          ]),
        );
        const unmet = outsourceUnmetAfterStockAllocation(
          activeCompeting,
          stockByProduct,
        );
        unmet.sort((a, b) => b.unmet - a.unmet || b.line.id.localeCompare(a.line.id));
        const needCount = unmet.length;
        const top = unmet.slice(0, 40);
        const sampleRows = top.map((u) => ({
          id: u.line.id,
          salesOrderId: u.line.salesOrderId,
          customerOrderNo: u.line.salesOrder.customerOrderNo?.trim() || "—",
          customerName: u.line.salesOrder.customer.name?.trim() || "—",
          productModel: u.line.product.model?.trim() || "—",
          quantity: u.line.quantity,
          quantityShipped: u.line.quantityShipped,
          processingMode: u.line.product.processingMode as
            | "OUTSOURCE"
            | "OUTSOURCE_INHOUSE",
          unmetByStock: u.unmet,
          productOnHand: u.onHand,
        }));
        payload.needOutsourceRows = { count: needCount, sampleRows };
      }
    }

    if (showHomeSamples()) {
      const samples = await prisma.sampleOrder.findMany({
        where: { status: "PENDING" },
        orderBy: { sampleDueAt: "asc" },
        take: 80,
        include: { customer: { select: { name: true } } },
      });
      payload.sampleReminders = {
        count: samples.length,
        rows: samples.slice(0, 50).map((s) => {
          const daysUntil = daysUntilCalendarDue(s.sampleDueAt, now);
          return {
            id: s.id,
            customerName: s.customer.name?.trim() || "—",
            model: s.model?.trim() || "—",
            quantity: s.quantity,
            sampleDueAt: s.sampleDueAt.toISOString(),
            daysUntil,
            urgency: urgencyBucket(daysUntil, urgencyT),
          };
        }),
      };
    }

    const link = "/dashboard/stats?tab=reconcile";
    const ym = yearMonthOf(now);
    if (showHomeReconcileSupplier()) {
      if (
        isOnOrAfterReconcileStartDay(wb.supplierReconcileStartDay, now) &&
        wb.reconcileAck?.supplier !== ym
      ) {
        const d = effectiveReconcileStartDay(wb.supplierReconcileStartDay, now);
        payload.reconcileReminders.supplier = {
          show: true,
          message: `请安排与供应商的采购对帐工作（统计与对帐 → 对帐）。自本月 ${d} 号起显示本提示，完成后请点击「完成」以在本月内隐藏。`,
          link,
        };
      }
    }
    if (showHomeReconcileCustomer()) {
      if (
        isOnOrAfterReconcileStartDay(wb.customerReconcileStartDay, now) &&
        wb.reconcileAck?.customer !== ym
      ) {
        const d = effectiveReconcileStartDay(wb.customerReconcileStartDay, now);
        payload.reconcileReminders.customer = {
          show: true,
          message: `请安排客户与仓库出货对帐工作（统计与对帐 → 对帐）。自本月 ${d} 号起显示本提示，完成后请点击「完成」以在本月内隐藏。`,
          link,
        };
      }
    }
    if (
      p("stats.view") &&
      !p("purchase.view") &&
      !p("warehouse.view")
    ) {
      if (
        isOnOrAfterReconcileStartDay(wb.otherReconcileStartDay, now) &&
        wb.reconcileAck?.other !== ym
      ) {
        const d = effectiveReconcileStartDay(wb.otherReconcileStartDay, now);
        payload.reconcileReminders.other = {
          show: true,
          message: `请按权限安排采购/出货对帐工作（统计与对帐 → 对帐）。自本月 ${d} 号起显示本提示，完成后请点击「完成」以在本月内隐藏。`,
          link,
        };
      }
    }

    return NextResponse.json({
      ...payload,
      workbench: {
        urgentRedMaxDays: wb.urgentRedMaxDays,
        lightRedMaxDays: wb.lightRedMaxDays,
        yellowMaxDays: wb.yellowMaxDays,
        supplierReconcileStartDay: wb.supplierReconcileStartDay,
        customerReconcileStartDay: wb.customerReconcileStartDay,
        otherReconcileStartDay: wb.otherReconcileStartDay,
      },
    });
  } catch (e) {
    console.error("[GET /api/dashboard/home]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载首页数据失败" },
      { status: 500 },
    );
  }
}
