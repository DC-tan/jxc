import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { shipmentProductModelLabel } from "@/lib/inhouse-bom-display";
import {
  isWarehouseProductStockInRecord,
  WAREHOUSE_PRODUCT_STOCK_IN_REMARK_DEFAULT,
} from "@/lib/warehouse-product-stock-in";

/** 单条商品入库明细：含关联扣料 / 外发回收库扣减 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("warehouse.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;

  try {
    const row = await prisma.productInbound.findUnique({
      where: { id },
      select: {
        id: true,
        productId: true,
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

    if (!row || !isWarehouseProductStockInRecord(row)) {
      return NextResponse.json({ error: "入库记录不存在" }, { status: 404 });
    }

    const productLabel = shipmentProductModelLabel(row.product);
    const labelToken =
      productLabel !== "—" ? productLabel : row.product.customerMaterialCode?.trim();

    const [materialDeductions, recoveryDeduction] = await Promise.all([
      prisma.materialInbound.findMany({
        where: {
          receivedAt: row.receivedAt,
          quantity: { lt: 0 },
          partDescription: { contains: "·商品入库" },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          quantity: true,
          partDescription: true,
          material: {
            select: {
              code: true,
              name: true,
              partDescription: true,
              unit: true,
            },
          },
        },
      }),
      row.product.processingMode === "OUTSOURCE_INHOUSE"
        ? prisma.outsourceRecoveryInbound.findFirst({
            where: {
              productId: row.productId,
              receivedAt: row.receivedAt,
              quantity: { lt: 0 },
              partDescription: { contains: "商品入库" },
            },
            select: {
              id: true,
              quantity: true,
              partDescription: true,
              remark: true,
            },
          })
        : Promise.resolve(null),
    ]);

    const filteredMaterials = labelToken
      ? materialDeductions.filter((m) =>
          (m.partDescription ?? "").includes(labelToken),
        )
      : materialDeductions;

    return NextResponse.json({
      id: row.id,
      quantity: row.quantity,
      receivedAt: row.receivedAt.toISOString(),
      partDescription: row.partDescription,
      remark: row.remark,
      remarkDefault: WAREHOUSE_PRODUCT_STOCK_IN_REMARK_DEFAULT,
      createdAt: row.createdAt.toISOString(),
      product: row.product,
      operatorName: row.operator?.name ?? null,
      operatorEmployeeNo: row.operator?.employeeNo ?? null,
      materialDeductions: filteredMaterials.map((m) => ({
        id: m.id,
        quantity: m.quantity,
        partDescription: m.partDescription,
        materialCode: m.material.code,
        materialName: m.material.name,
        materialPart: m.material.partDescription,
        unit: m.material.unit,
      })),
      recoveryDeduction: recoveryDeduction
        ? {
            id: recoveryDeduction.id,
            quantity: recoveryDeduction.quantity,
            partDescription: recoveryDeduction.partDescription,
            remark: recoveryDeduction.remark,
          }
        : null,
    });
  } catch (e) {
    console.error("[GET /api/warehouse/product-stock-in/history/[id]]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
