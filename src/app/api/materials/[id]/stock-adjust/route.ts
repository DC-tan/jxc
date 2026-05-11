import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const bodySchema = z.object({
  delta: z.number().int(),
  remark: z.string().max(500).optional().nullable(),
});

/**
 * 盘点后手动增减库存：写入一条 `MANUAL_STOCK_ADJUST` 流水，与采购收料、外发扣料一同汇总为当前库存。
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("material.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id: materialId } = await ctx.params;

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

  const mat = await prisma.material.findUnique({
    where: { id: materialId },
    include: { inbounds: { select: { quantity: true } } },
  });
  if (!mat) {
    return NextResponse.json({ error: "物料不存在" }, { status: 404 });
  }

  const current = mat.inbounds.reduce((s, i) => s + i.quantity, 0);
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

  const row = await prisma.materialInbound.create({
    data: {
      materialId,
      quantity: delta,
      receivedAt: new Date(),
      purchaseOrderNo: null,
      partDescription: remark,
      entryType: "MANUAL_STOCK_ADJUST",
      operatorUserId: auth.user.id,
    },
  });

  return NextResponse.json({ ok: true, id: row.id, newTotal: current + delta });
}
