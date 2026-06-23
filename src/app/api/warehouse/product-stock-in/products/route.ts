import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { formatOutsourceRecoveryMaterialCode } from "@/lib/outsource-recovery-display";
import { getOutsourceRecoveryQtyByProductId } from "@/lib/outsource-recovery-stock";

/** 商品入库：可选商品（自加工 / 外发+自加工） */
export async function GET(req: Request) {
  const auth = await requirePermission("warehouse.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get("keyword")?.trim() || "";

  const where: Prisma.ProductWhereInput = {
    isDeprecated: false,
    processingMode: { in: ["INHOUSE", "OUTSOURCE_INHOUSE"] },
  };
  if (keyword) {
    where.OR = [
      { model: { contains: keyword, mode: "insensitive" } },
      { customerMaterialCode: { contains: keyword, mode: "insensitive" } },
      { spec: { contains: keyword, mode: "insensitive" } },
      {
        customer: {
          name: { contains: keyword, mode: "insensitive" },
        },
      },
      {
        customer: {
          code: { contains: keyword, mode: "insensitive" },
        },
      },
    ];
  }

  try {
    const products = await prisma.product.findMany({
      where,
      orderBy: [{ model: "asc" }, { customerMaterialCode: "asc" }],
      take: 80,
      select: {
        id: true,
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
        const recoveryStock =
          p.processingMode === "OUTSOURCE_INHOUSE"
            ? await getOutsourceRecoveryQtyByProductId(prisma, p.id)
            : null;
        return {
          id: p.id,
          model: p.model,
          customerMaterialCode: p.customerMaterialCode,
          unit: p.unit,
          processingMode: p.processingMode,
          customer: p.customer,
          stockQuantity: stockByProduct.get(p.id) ?? 0,
          recoveryStockQuantity: recoveryStock,
          recoveryLabel:
            p.processingMode === "OUTSOURCE_INHOUSE"
              ? formatOutsourceRecoveryMaterialCode(p.customerMaterialCode)
              : null,
        };
      }),
    );

    return NextResponse.json({ list });
  } catch (e) {
    console.error("[GET /api/warehouse/product-stock-in/products]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
