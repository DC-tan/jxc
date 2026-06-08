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
    const [customers, relations, products] = await Promise.all([
      prisma.customer.findMany({
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, shortName: true },
      }),
      prisma.customerRelation.findMany({
        select: { customerId: true, relatedCustomerId: true },
      }),
      prisma.product.findMany({
        where: { isDeprecated: false },
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

    const customerScopeMap = new Map<string, Set<string>>();
    for (const c of customers) {
      customerScopeMap.set(c.id, new Set([c.id]));
    }
    for (const rel of relations) {
      if (!customerScopeMap.has(rel.customerId)) {
        customerScopeMap.set(rel.customerId, new Set([rel.customerId]));
      }
      if (!customerScopeMap.has(rel.relatedCustomerId)) {
        customerScopeMap.set(rel.relatedCustomerId, new Set([rel.relatedCustomerId]));
      }
      customerScopeMap.get(rel.customerId)?.add(rel.relatedCustomerId);
      customerScopeMap.get(rel.relatedCustomerId)?.add(rel.customerId);
    }

    return NextResponse.json({
      customers,
      customerScopes: Object.fromEntries(
        Array.from(customerScopeMap.entries()).map(([customerId, ids]) => [
          customerId,
          Array.from(ids),
        ]),
      ),
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
