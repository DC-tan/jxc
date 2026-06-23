import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

/** 无单出货：可选商品 */
export async function GET(req: Request) {
  const auth = await requirePermission("warehouse.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId")?.trim() || "";
  const productModel = searchParams.get("productModel")?.trim() || "";

  if (!customerId && !productModel) {
    return NextResponse.json(
      { error: "请选择客户或输入商品型号" },
      { status: 400 },
    );
  }

  const where: Prisma.ProductWhereInput = {
    isDeprecated: false,
    ...(customerId ? { customerId } : {}),
    ...(productModel
      ? {
          model: { contains: productModel, mode: "insensitive" },
        }
      : {}),
  };

  try {
    const products = await prisma.product.findMany({
      where,
      orderBy: [{ model: "asc" }, { customerMaterialCode: "asc" }],
      take: 80,
      select: {
        id: true,
        customerId: true,
        model: true,
        customerMaterialCode: true,
        unit: true,
        processingMode: true,
        customer: { select: { code: true, name: true } },
      },
    });

    const ids = products.map((p) => p.id);
    const stockByProduct = new Map<string, number>();
    if (ids.length > 0) {
      const grouped = await prisma.productInbound.groupBy({
        by: ["productId"],
        where: { productId: { in: ids } },
        _sum: { quantity: true },
      });
      for (const g of grouped) {
        stockByProduct.set(g.productId, Number(g._sum.quantity ?? 0));
      }
    }

    const list = await Promise.all(
      products.map(async (p) => {
        const stockQuantity = stockByProduct.get(p.id) ?? 0;
        if (stockQuantity <= 0) return null;
        return {
          id: p.id,
          customerId: p.customerId,
          model: p.model,
          customerMaterialCode: p.customerMaterialCode,
          unit: p.unit,
          processingMode: p.processingMode,
          customer: p.customer,
          stockQuantity,
        };
      }),
    );

    return NextResponse.json({
      list: list.filter((x): x is NonNullable<typeof x> => x != null),
    });
  } catch (e) {
    console.error("[GET /api/warehouse/product-ship-out/products]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
