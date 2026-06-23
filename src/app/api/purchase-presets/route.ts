import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

/** 采购订单表单：供应商、可选物料列表 */
export async function GET(req: Request) {
  const auth = await requirePermission("purchase.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const purchaseChannel = searchParams.get("purchaseChannel")?.trim();
    const channelFilter =
      purchaseChannel === "PROCESSING_CONTRACT"
        ? "PROCESSING_CONTRACT"
        : purchaseChannel === "STANDARD_PURCHASE"
          ? "STANDARD_PURCHASE"
          : null;

    const [suppliers, materials] = await Promise.all([
      prisma.supplier.findMany({
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, shortName: true, priceIncludesTax: true },
      }),
      prisma.material.findMany({
        where: {
          isCustomerSupplied: false,
          ...(channelFilter ? ({ purchaseChannel: channelFilter } as never) : {}),
        },
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          partDescription: true,
          unit: true,
          unitPrice: true,
          purchaseChannel: true,
          supplier: { select: { id: true, code: true, name: true } },
        },
      }),
    ]);

    return NextResponse.json({
      suppliers,
      materials: materials.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        partDescription: m.partDescription,
        unit: m.unit,
        unitPrice: m.unitPrice.toString(),
        purchaseChannel: m.purchaseChannel,
        supplier: m.supplier,
      })),
    });
  } catch (e) {
    console.error("[GET /api/purchase-presets]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
