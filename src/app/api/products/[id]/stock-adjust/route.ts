import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const bodySchema = z.object({
  delta: z.number().int(),
  remark: z.string().max(500).optional().nullable(),
});

/**
 * 盘点后手动增减商品成品库存：写入 `MANUAL_STOCK_ADJUST` 流水，与采购入库、出货扣减等汇总为当前库存。
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("product.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id: productId } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const delta = Math.trunc(parsed.data.delta);
  if (delta === 0) {
    return NextResponse.json({ error: "调整数量不能为 0" }, { status: 400 });
  }

  const remark = parsed.data.remark?.trim() || null;

  const p = await prisma.product.findUnique({
    where: { id: productId },
    include: { inbounds: { select: { quantity: true } } },
  });
  if (!p) {
    return NextResponse.json({ error: "商品不存在" }, { status: 404 });
  }

  const current = p.inbounds.reduce((s, i) => s + i.quantity, 0);
  if (current + delta < 0) {
    return NextResponse.json(
      {
        error: `调整后库存不能为负（当前系统库存 ${current}，本次调整 ${
          delta > 0 ? "+" : ""
        }${delta}）`,
      },
      { status: 400 },
    );
  }

  const row = await prisma.productInbound.create({
    data: {
      productId,
      quantity: delta,
      receivedAt: new Date(),
      purchaseOrderNo: null,
      partDescription: null,
      remark,
      entryType: "MANUAL_STOCK_ADJUST",
      operatorUserId: auth.user.id,
    },
  });

  return NextResponse.json({ ok: true, id: row.id, newTotal: current + delta });
}
