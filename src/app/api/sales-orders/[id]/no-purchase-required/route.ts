import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

/** 存在此类状态的采购单时不可标记为「无需采购」 */
const OPEN_PURCHASE: Set<string> = new Set(["DRAFT", "PENDING_RECEIPT"]);

/**
 * 将本销售单标记为「无需采购」（不生成/不补采购单），
 * 效果与「本单相关采购单均已收料确认」后不再出现在从销售建采购下拉里一致。
 * 若仍有草稿或待收料的采购单，则拒绝。
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("purchase.create");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id: salesOrderId } = await ctx.params;
  if (!salesOrderId?.trim()) {
    return NextResponse.json({ error: "销售订单 id 无效" }, { status: 400 });
  }

  const so = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: {
      id: true,
      noPurchaseRequiredAt: true,
      purchaseOrders: { select: { id: true, status: true } },
    },
  });
  if (!so) {
    return NextResponse.json({ error: "销售订单不存在" }, { status: 404 });
  }
  if (so.noPurchaseRequiredAt) {
    return NextResponse.json({ ok: true, alreadyMarked: true });
  }

  const hasOpen = so.purchaseOrders.some((p) => OPEN_PURCHASE.has(p.status));
  if (hasOpen) {
    return NextResponse.json(
      { error: "本单尚有进行中的采购单，请先收料或处理后再标记「无需采购」" },
      { status: 400 },
    );
  }

  const now = new Date();
  await prisma.salesOrder.update({
    where: { id: so.id },
    data: { noPurchaseRequiredAt: now },
  });

  return NextResponse.json({ ok: true, noPurchaseRequiredAt: now.toISOString() });
}
