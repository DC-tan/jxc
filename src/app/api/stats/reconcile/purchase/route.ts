import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { parseStatsRange, statsRangeQuerySchema } from "@/lib/stats-range";
import { formatPurchaseExtraFeesColumn } from "@/lib/purchase-extra-fees";
import { buildPurchaseReconcileLineMap } from "@/lib/purchase-reconcile-lines";
import {
  attachRemarksToPurchaseReconcileRows,
  loadPurchaseReconcileRemarks,
  purchaseReconcileLineKeySplit,
  purchaseReconcileLineKeyWhole,
} from "@/lib/purchase-reconcile-remark";

const bodySchema = z.object({
  mode: z.enum(["whole", "split"]),
  supplierId: z.string().optional().nullable(),
  /** 物料主数据「关联客户」（自定义种类） */
  customerId: z.string().optional().nullable(),
  /** 该行是否展示附加费用：all / yes / no */
  extraFees: z.enum(["all", "yes", "no"]).optional(),
  materialName: z.string().optional().nullable(),
  partDescription: z.string().optional().nullable(),
  ...statsRangeQuerySchema.shape,
});

function passesExtraFeesFilter(
  extraFeesColumn: string,
  filter: "all" | "yes" | "no",
): boolean {
  const has = extraFeesColumn.trim().length > 0;
  if (filter === "yes") return has;
  if (filter === "no") return !has;
  return true;
}

function matchesPurchaseReconcileFilters(
  row: PurchaseReconcileRow,
  materialName?: string,
  partDescription?: string,
): boolean {
  const mn = materialName?.trim();
  if (mn && !row.物料名称.includes(mn)) return false;
  const pd = partDescription?.trim();
  if (pd) {
    const desc = row.部件描述 === "—" ? "" : row.部件描述;
    if (!desc.includes(pd)) return false;
  }
  return true;
}

function materialShowsExtraFees(m: {
  customerId: string | null;
  isCustomerSupplied: boolean;
  presetKind: { namingMode: string } | null;
}): boolean {
  return (
    Boolean(m.customerId) &&
    !m.isCustomerSupplied &&
    m.presetKind?.namingMode === "CUSTOM"
  );
}

export type PurchaseReconcileRow = {
  lineKey: string;
  交货日期: string;
  采购订单号: string;
  订单数量: number;
  物料名称: string;
  部件描述: string;
  交货数量: number;
  单价: number;
  金额: number;
  附加费用: string;
  /** 本采购单附加费合计（同一单号多行展示时金额相同，合计按单号去重） */
  extraFeeAmount: number;
  备注: string;
};

function poExtraFeeSum(
  fees: { amount: unknown }[],
): number {
  return fees.reduce((s, f) => {
    const n = Number(f.amount);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function totalUniqueExtraFeeAmount(rows: PurchaseReconcileRow[]): number {
  const byOrderNo = new Map<string, number>();
  for (const r of rows) {
    if (r.extraFeeAmount > 0) byOrderNo.set(r.采购订单号, r.extraFeeAmount);
  }
  return [...byOrderNo.values()].reduce((s, n) => s + n, 0);
}

/**
 * 采购对帐：以物料入库 `receivedAt` 为实收时间。
 * - split：区间内每笔收料各一行
 * - whole：仅整单已收料且 `actualDeliveredAt` 落在区间内的订单明细分行
 */
export async function POST(req: Request) {
  const auth = await requirePermission("stats.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请提交 JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  const { from, to } = parseStatsRange(parsed.data.from, parsed.data.to);
  const mode = parsed.data.mode;
  const supplierId = parsed.data.supplierId?.trim() || undefined;
  const customerId = parsed.data.customerId?.trim() || undefined;
  const extraFeesFilter = parsed.data.extraFees ?? "all";
  const materialName = parsed.data.materialName?.trim() || undefined;
  const partDescription = parsed.data.partDescription?.trim() || undefined;

  try {
    const rows: PurchaseReconcileRow[] = [];

    if (mode === "split") {
      const inbounds = await prisma.materialInbound.findMany({
        where: {
          receivedAt: { gte: from, lte: to },
          quantity: { gt: 0 },
          purchaseOrderNo: { not: null },
        },
        orderBy: { receivedAt: "asc" },
        take: 10000,
      });

      const orderNos = [
        ...new Set(inbounds.map((i) => i.purchaseOrderNo).filter(Boolean) as string[]),
      ];
      if (orderNos.length === 0) {
        return NextResponse.json({
          rows: [],
          totalAmount: 0,
          range: { from: from.toISOString(), to: to.toISOString() },
          mode,
        });
      }

      const pos = await prisma.purchaseOrder.findMany({
        where: {
          orderNo: { in: orderNos },
          status: { not: "CANCELLED" },
          ...(supplierId ? { supplierId } : {}),
        },
        include: {
          lines: {
            include: {
              material: {
                select: {
                  name: true,
                  partDescription: true,
                  customerId: true,
                  isCustomerSupplied: true,
                  presetKind: { select: { namingMode: true } },
                },
              },
            },
          },
          extraFees: { orderBy: { sortOrder: "asc" } },
        },
      });
      const byOrderNo = new Map(pos.map((p) => [p.orderNo, p]));
      const lineMapByOrderNo = new Map<
        string,
        Awaited<ReturnType<typeof buildPurchaseReconcileLineMap>>
      >();
      for (const po of pos) {
        lineMapByOrderNo.set(
          po.orderNo,
          await buildPurchaseReconcileLineMap(po.lines, po.orderNo),
        );
      }

      for (const m of inbounds) {
        const on = m.purchaseOrderNo;
        if (!on) continue;
        const po = byOrderNo.get(on);
        if (!po) continue;
        const lineSrc = lineMapByOrderNo.get(on)?.get(m.materialId);
        if (!lineSrc) continue;
        if (customerId && lineSrc.material.customerId !== customerId) continue;
        const u = lineSrc.unitPrice;
        const amt = m.quantity * u;
        const showsExtra = materialShowsExtraFees(lineSrc.material);
        const feeSum = showsExtra ? poExtraFeeSum(po.extraFees) : 0;
        const extraCol = showsExtra
          ? formatPurchaseExtraFeesColumn(
              po.extraFees.map((f) => ({
                amount: Number(f.amount),
                purpose: f.purpose,
              })),
            )
          : "";
        if (!passesExtraFeesFilter(extraCol, extraFeesFilter)) continue;
        rows.push({
          lineKey: purchaseReconcileLineKeySplit(m.id),
          交货日期: m.receivedAt.toISOString(),
          采购订单号: on,
          订单数量: lineSrc.orderQty,
          物料名称: lineSrc.material.name?.trim() || "—",
          部件描述: lineSrc.material.partDescription?.trim() || "—",
          交货数量: m.quantity,
          单价: u,
          金额: amt,
          附加费用: extraCol,
          extraFeeAmount: feeSum,
          备注: "",
        });
      }
    } else {
      const orders = await prisma.purchaseOrder.findMany({
        where: {
          status: "CONFIRMED",
          actualDeliveredAt: { gte: from, lte: to, not: null },
          ...(supplierId ? { supplierId } : {}),
        },
        orderBy: { actualDeliveredAt: "asc" },
        take: 2000,
        include: {
          lines: {
            orderBy: { sortOrder: "asc" },
            include: {
              material: {
                select: {
                  name: true,
                  partDescription: true,
                  customerId: true,
                  isCustomerSupplied: true,
                  presetKind: { select: { namingMode: true } },
                },
              },
            },
          },
          extraFees: { orderBy: { sortOrder: "asc" } },
        },
      });

      for (const po of orders) {
        const delAt = po.actualDeliveredAt!.toISOString();
        const poFeeSum = poExtraFeeSum(po.extraFees);
        const poExtraFeesFormatted =
          poFeeSum > 0
            ? formatPurchaseExtraFeesColumn(
                po.extraFees.map((f) => ({
                  amount: Number(f.amount),
                  purpose: f.purpose,
                })),
              )
            : "";
        const lineMap = await buildPurchaseReconcileLineMap(po.lines, po.orderNo);
        for (const lineSrc of lineMap.values()) {
          if (customerId && lineSrc.material.customerId !== customerId) continue;
          const u = lineSrc.unitPrice;
          const qty = lineSrc.orderQty;
          const showsExtra = materialShowsExtraFees(lineSrc.material);
          const extraCol = showsExtra ? poExtraFeesFormatted : "";
          if (!passesExtraFeesFilter(extraCol, extraFeesFilter)) continue;
          rows.push({
            lineKey: purchaseReconcileLineKeyWhole(po.orderNo, lineSrc.materialId),
            交货日期: delAt,
            采购订单号: po.orderNo,
            订单数量: qty,
            物料名称: lineSrc.material.name?.trim() || "—",
            部件描述: lineSrc.material.partDescription?.trim() || "—",
            交货数量: qty,
            单价: u,
            金额: qty * u,
            附加费用: extraCol,
            extraFeeAmount: showsExtra ? poFeeSum : 0,
            备注: "",
          });
        }
      }
    }

    const filtered = rows.filter((r) =>
      matchesPurchaseReconcileFilters(r, materialName, partDescription),
    );
    const remarkByKey = await loadPurchaseReconcileRemarks(
      filtered.map((r) => r.lineKey),
    );
    const withRemarks = attachRemarksToPurchaseReconcileRows(filtered, remarkByKey);
    const totalAmount = withRemarks.reduce((s, r) => s + r.金额, 0);
    const totalExtraFeeAmount = totalUniqueExtraFeeAmount(withRemarks);
    return NextResponse.json({
      rows: withRemarks,
      totalAmount,
      totalExtraFeeAmount,
      range: { from: from.toISOString(), to: to.toISOString() },
      mode,
    });
  } catch (e) {
    console.error("[POST /api/stats/reconcile/purchase]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "查询失败" },
      { status: 500 },
    );
  }
}
