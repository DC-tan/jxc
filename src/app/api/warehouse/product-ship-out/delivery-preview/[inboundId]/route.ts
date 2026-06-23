import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { buildNoOrderShipOutDeliveryPreview } from "@/lib/warehouse-no-order-ship-out-query";

/** 出货查询：无单出货送货单只读预览 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ inboundId: string }> },
) {
  const auth = await requirePermission("warehouse.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { inboundId } = await ctx.params;
  const id = inboundId?.trim();
  if (!id) {
    return NextResponse.json({ error: "缺少出库流水 ID" }, { status: 400 });
  }

  const preview = await buildNoOrderShipOutDeliveryPreview(prisma, id);
  if (!preview) {
    return NextResponse.json({ error: "未找到无单出货记录" }, { status: 404 });
  }

  return NextResponse.json(preview);
}
