import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { OutsourceOrderStatus } from '@prisma/client';
import {
  computeOutsourceLineStockSplit,
  perSetFromProductMaterials,
} from "@/lib/outsource-material-stock-balance";

type StockAgg = {
  supplierId: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  materialId: string;
  materialCode: string;
  materialName: string;
  partDescription: string | null;
  unit: string;
  quantity: number;
  openQty: number;
  closedCarryQty: number;
  orderCount: number;
};

export async function GET(req: Request) {
  const auth = await requirePermission("outsource.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get("keyword")?.trim() ?? "";
  const supplierFilter = searchParams.get("supplierId")?.trim();
  const materialFilter = searchParams.get("materialId")?.trim();

  try {
    const outsourceOrderFilter =
      supplierFilter == null || supplierFilter.length === 0
        ? { status: { in: [OutsourceOrderStatus.OPEN, OutsourceOrderStatus.CLOSED] } }
        : supplierFilter === "NONE"
          ? { status: { in: [OutsourceOrderStatus.OPEN, OutsourceOrderStatus.CLOSED] }, supplierId: null }
          : { status: { in: [OutsourceOrderStatus.OPEN, OutsourceOrderStatus.CLOSED] }, supplierId: supplierFilter };

    const rows = await prisma.outsourceOrderLine.findMany({
      where: {
        ...(materialFilter ? { materialId: materialFilter } : {}),
        outsourceOrder: outsourceOrderFilter,
        ...(keyword
          ? {
              OR: [
                { material: { code: { contains: keyword, mode: "insensitive" } } },
                { material: { name: { contains: keyword, mode: "insensitive" } } },
                {
                  outsourceOrder: {
                    orderNo: { contains: keyword, mode: "insensitive" },
                  },
                },
                {
                  outsourceOrder: {
                    supplier: { code: { contains: keyword, mode: "insensitive" } },
                  },
                },
                {
                  outsourceOrder: {
                    supplier: { name: { contains: keyword, mode: "insensitive" } },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        materialId: true,
        quantity: true,
        issuedQuantity: true,
        outsourceOrderId: true,
        outsourceOrder: {
          select: {
            id: true,
            orderNo: true,
            status: true,
            productQty: true,
            supplier: { select: { id: true, code: true, name: true } },
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
        material: {
          select: {
            id: true,
            code: true,
            name: true,
            partDescription: true,
            unit: true,
          },
        },
      },
      orderBy: [{ material: { code: "asc" } }],
      take: 4000,
    });

    const orderIds = [...new Set(rows.map((r) => r.outsourceOrderId))];
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
        productSetsByOrderNo.set(
          r.purchaseOrderNo,
          Number(r._sum.quantity ?? 0),
        );
      }
    }
    const recoverySetsByOrderId = new Map<string, number>();
    for (const r of recoverySetsRows) {
      recoverySetsByOrderId.set(r.outsourceOrderId, Number(r._sum.quantity ?? 0));
    }
    const warehouseByOrderMaterial = new Map<string, number>();
    for (const r of warehouseRows) {
      if (!r.purchaseOrderNo) continue;
      const key = `${r.purchaseOrderNo}::${r.materialId}`;
      warehouseByOrderMaterial.set(
        key,
        Math.abs(Number(r._sum.quantity ?? 0)),
      );
    }
    const closeReturnByOrderMaterial = new Map<string, number>();
    for (const r of closeReturnRows) {
      if (!r.purchaseOrderNo) continue;
      const key = `${r.purchaseOrderNo}::${r.materialId}`;
      closeReturnByOrderMaterial.set(key, Number(r._sum.quantity ?? 0));
    }

    const byKey = new Map<string, StockAgg & { orderIds: Set<string> }>();
    for (const row of rows) {
      const order = row.outsourceOrder;
      const orderNo = order.orderNo?.trim() ?? "";
      const omKey = `${orderNo}::${row.materialId}`;
      const recoveredSets =
        order.product.processingMode === "OUTSOURCE_INHOUSE"
          ? recoverySetsByOrderId.get(order.id) ?? 0
          : productSetsByOrderNo.get(orderNo) ?? 0;
      const perSet = perSetFromProductMaterials(
        order.product.processingMode,
        order.product.productMaterials ?? [],
        row.materialId,
      );
      const split = computeOutsourceLineStockSplit({
        orderStatus: order.status,
        processingMode: order.product.processingMode,
        orderNo,
        materialId: row.materialId,
        productQty: order.productQty,
        issuedQuantity: row.issuedQuantity,
        storedQuantity: row.quantity,
        warehouseOutbound: warehouseByOrderMaterial.get(omKey) ?? 0,
        recoveredSets,
        closeReturnQty: closeReturnByOrderMaterial.get(omKey) ?? 0,
        perSet,
      });

      if (split.openOccupancy <= 0 && split.poolRemaining <= 0) continue;

      const supplier = order.supplier;
      const supplierId = supplier?.id ?? null;
      const key = `${supplierId ?? "NONE"}::${row.material.id}`;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, {
          supplierId,
          supplierCode: supplier?.code ?? null,
          supplierName: supplier?.name ?? null,
          materialId: row.material.id,
          materialCode: row.material.code,
          materialName: row.material.name,
          partDescription: row.material.partDescription ?? null,
          unit: row.material.unit,
          quantity: split.poolRemaining,
          openQty: split.openOccupancy,
          closedCarryQty: order.status === "CLOSED" ? split.poolRemaining : 0,
          orderCount: 0,
          orderIds: new Set([row.outsourceOrderId]),
        });
      } else {
        prev.quantity += split.poolRemaining;
        prev.openQty += split.openOccupancy;
        if (order.status === "CLOSED") {
          prev.closedCarryQty += split.poolRemaining;
        }
        prev.orderIds.add(row.outsourceOrderId);
      }
    }

    const list = [...byKey.values()]
      .map((x) => ({
        supplierId: x.supplierId,
        supplierCode: x.supplierCode,
        supplierName: x.supplierName,
        materialId: x.materialId,
        materialCode: x.materialCode,
        materialName: x.materialName,
        partDescription: x.partDescription,
        unit: x.unit,
        quantity: x.quantity,
        openQty: x.openQty,
        closedCarryQty: x.closedCarryQty,
        orderCount: x.orderIds.size,
      }))
      .sort((a, b) => {
        const sa = a.supplierName ?? "";
        const sb = b.supplierName ?? "";
        if (sa !== sb) return sa.localeCompare(sb, "zh-Hans-CN");
        return a.materialCode.localeCompare(b.materialCode, "zh-Hans-CN");
      });

    return NextResponse.json({ list });
  } catch (e) {
    console.error("[GET /api/outsource-material-stock]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
