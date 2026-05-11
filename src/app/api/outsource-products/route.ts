import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  productBomForOutsource,
  productBomForInhouseProduction,
} from "@/lib/product-bom-scope";

/**
 * 检索「外发加工」商品（用于外发建单），按型号/物料编号/规格/客户名称模糊匹配。
 */
export async function GET(req: Request) {
  const auth = await requirePermission("outsource.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const q = new URL(req.url).searchParams.get("search")?.trim() ?? "";
  if (q.length < 1) {
    return NextResponse.json({ list: [] });
  }

  const parts = q.split(/\s+/).filter(Boolean);
  const and: Prisma.ProductWhereInput[] = [
    { processingMode: { in: ["OUTSOURCE", "OUTSOURCE_INHOUSE"] } },
  ];
  for (const p of parts) {
    and.push({
      OR: [
        { model: { contains: p, mode: "insensitive" } },
        { customerMaterialCode: { contains: p, mode: "insensitive" } },
        { spec: { contains: p, mode: "insensitive" } },
        { customer: { name: { contains: p, mode: "insensitive" } } },
        { customer: { code: { contains: p, mode: "insensitive" } } },
      ],
    });
  }

  try {
    const list = await prisma.product.findMany({
      where: { AND: and },
      take: 30,
      orderBy: { updatedAt: "desc" },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        productMaterials: {
          orderBy: { sortOrder: "asc" },
          select: {
            materialId: true,
            usageQty: true,
            scope: true,
            material: {
              select: {
                id: true,
                code: true,
                name: true,
                unit: true,
                partDescription: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      list: list.map((p) => ({
        id: p.id,
        customerMaterialCode: p.customerMaterialCode,
        model: p.model,
        spec: p.spec,
        unit: p.unit,
        processingMode: p.processingMode,
        customer: p.customer,
        bom: productBomForOutsource(p.processingMode, p.productMaterials).map(
          (pm) => ({
            materialId: pm.materialId,
            usageQty: pm.usageQty.toString(),
            material: pm.material,
          }),
        ),
        inhouseBom:
          p.processingMode === "OUTSOURCE_INHOUSE"
            ? productBomForInhouseProduction(
                p.processingMode,
                p.productMaterials,
              ).map((pm) => ({
                materialId: pm.materialId,
                usageQty: pm.usageQty.toString(),
                material: pm.material,
              }))
            : [],
      })),
    });
  } catch (e) {
    console.error("[GET /api/outsource-products]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
