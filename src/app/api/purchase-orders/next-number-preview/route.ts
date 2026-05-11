import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { generateNextPurchaseOrderNumber } from "@/lib/purchase-order-number";
import { mergePurchasePrintConfig } from "@/lib/purchase-print-template";

const SINGLETON_ID = "singleton";

/**
 * 预览「下一单」采购单号（与创建时规则一致，不写库）。
 */
export async function GET(req: Request) {
  const auth = await requirePermission("purchase.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const supplierId = new URL(req.url).searchParams.get("supplierId")?.trim();
  if (!supplierId) {
    return NextResponse.json({ error: "缺少 supplierId" }, { status: 400 });
  }

  try {
    const [tpl, sup] = await Promise.all([
      prisma.purchasePrintTemplate.findUnique({
        where: { id: SINGLETON_ID },
        select: { config: true },
      }),
      prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { shortName: true, code: true, name: true },
      }),
    ]);

    if (!sup) {
      return NextResponse.json({ error: "供应商不存在" }, { status: 404 });
    }

    const rule = mergePurchasePrintConfig(tpl?.config ?? {}).orderNumberRule;
    const orderNo = await generateNextPurchaseOrderNumber(
      prisma,
      rule,
      supplierId,
      sup,
      new Date(),
    );
    return NextResponse.json({ orderNo });
  } catch (e) {
    console.error("[GET /api/purchase-orders/next-number-preview]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "计算失败" },
      { status: 500 },
    );
  }
}
