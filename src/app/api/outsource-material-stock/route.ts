import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { OutsourceOrderStatus } from '@prisma/client';

type StockAgg = {
  supplierId: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  materialId: string;
  materialCode: string;
  materialName: string;
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
        quantity: { gt: 0 },
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
        quantity: true,
        outsourceOrderId: true,
        outsourceOrder: {
          select: {
            status: true,
            supplier: { select: { id: true, code: true, name: true } },
          },
        },
        material: {
          select: {
            id: true,
            code: true,
            name: true,
            unit: true,
          },
        },
      },
      orderBy: [{ material: { code: "asc" } }],
      take: 2000,
    });

    const byKey = new Map<string, StockAgg & { orderIds: Set<string> }>();
    for (const row of rows) {
      const supplier = row.outsourceOrder.supplier;
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
          unit: row.material.unit,
          quantity: row.quantity,
          openQty: row.outsourceOrder.status === "OPEN" ? row.quantity : 0,
          closedCarryQty: row.outsourceOrder.status === "CLOSED" ? row.quantity : 0,
          orderCount: 0,
          orderIds: new Set([row.outsourceOrderId]),
        });
      } else {
        prev.quantity += row.quantity;
        if (row.outsourceOrder.status === "OPEN") prev.openQty += row.quantity;
        if (row.outsourceOrder.status === "CLOSED") prev.closedCarryQty += row.quantity;
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