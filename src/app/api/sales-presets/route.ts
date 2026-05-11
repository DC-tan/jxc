import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

function parseImageUrls(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** 销售订单：客户 + 可选商品（按客户归属） */
export async function GET() {
  const auth = await requirePermission("sales.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const [customers, products] = await Promise.all([
      prisma.customer.findMany({
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      }),
      prisma.product.findMany({
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          customerId: true,
          customerMaterialCode: true,
          machineModel: true,
          model: true,
          spec: true,
          unit: true,
          price: true,
          inspectionNotes: true,
          productRemark: true,
          imageUrls: true,
          customer: { select: { id: true, code: true, name: true } },
        },
      }),
    ]);

    return NextResponse.json({
      customers,
      products: products.map((p) => ({
        id: p.id,
        customerId: p.customerId,
        customerMaterialCode: p.customerMaterialCode,
        machineModel: p.machineModel,
        model: p.model,
        spec: p.spec,
        unit: p.unit,
        price: p.price.toString(),
        inspectionNotes: p.inspectionNotes,
        productRemark: p.productRemark,
        imageUrls: parseImageUrls(p.imageUrls),
        customer: p.customer,
      })),
    });
  } catch (e) {
    console.error("[GET /api/sales-presets]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
