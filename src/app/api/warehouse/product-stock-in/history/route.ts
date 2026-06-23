import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { buildWarehouseProductStockInHistoryWhere } from "@/lib/warehouse-product-stock-in";

/** 仓库 · 商品入库：历史明细列表 */
export async function GET(req: Request) {
  const auth = await requirePermission("warehouse.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get("keyword")?.trim() || "";
  const receivedFrom = searchParams.get("receivedFrom")?.trim();
  const receivedTo = searchParams.get("receivedTo")?.trim();

  let fromDate: Date | undefined;
  let toDate: Date | undefined;
  if (receivedFrom) {
    fromDate = new Date(receivedFrom);
    if (Number.isNaN(fromDate.getTime())) {
      return NextResponse.json({ error: "开始时间无效" }, { status: 400 });
    }
  }
  if (receivedTo) {
    toDate = new Date(receivedTo);
    if (Number.isNaN(toDate.getTime())) {
      return NextResponse.json({ error: "结束时间无效" }, { status: 400 });
    }
    toDate.setHours(23, 59, 59, 999);
  }

  try {
    const where = buildWarehouseProductStockInHistoryWhere({
      keyword: keyword || undefined,
      receivedFrom: fromDate,
      receivedTo: toDate,
    });

    const rows = await prisma.productInbound.findMany({
      where,
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      take: 500,
      select: {
        id: true,
        quantity: true,
        receivedAt: true,
        partDescription: true,
        remark: true,
        createdAt: true,
        product: {
          select: {
            id: true,
            model: true,
            customerMaterialCode: true,
            unit: true,
            processingMode: true,
            customer: { select: { code: true, name: true } },
          },
        },
        operator: { select: { name: true, employeeNo: true } },
      },
    });

    return NextResponse.json({
      list: rows.map((r) => ({
        id: r.id,
        quantity: r.quantity,
        receivedAt: r.receivedAt.toISOString(),
        partDescription: r.partDescription,
        remark: r.remark,
        createdAt: r.createdAt.toISOString(),
        product: {
          id: r.product.id,
          model: r.product.model,
          customerMaterialCode: r.product.customerMaterialCode,
          unit: r.product.unit,
          processingMode: r.product.processingMode,
          customer: r.product.customer,
        },
        operatorName: r.operator?.name ?? null,
        operatorEmployeeNo: r.operator?.employeeNo ?? null,
      })),
    });
  } catch (e) {
    console.error("[GET /api/warehouse/product-stock-in/history]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
