import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

export async function GET(req: Request) {
  const auth = await requirePermission("stats.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get("q")?.trim() ?? "";
  if (keyword.length < 1) {
    return NextResponse.json({ options: [] });
  }

  try {
    const list = await prisma.product.findMany({
      where: {
        OR: [
          { model: { contains: keyword, mode: "insensitive" } },
          { customerMaterialCode: { contains: keyword, mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        model: true,
        customerMaterialCode: true,
      },
    });
    return NextResponse.json({
      options: list.map((p) => ({
        value: p.id,
        label: `${p.model || "—"}${p.customerMaterialCode ? `（${p.customerMaterialCode}）` : ""}`,
      })),
    });
  } catch (e) {
    console.error("[GET /api/stats/order-profit/product-options]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载商品选项失败" },
      { status: 500 },
    );
  }
}
