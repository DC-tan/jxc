import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const bodySchema = z.object({
  quantity: z.union([z.number(), z.string()]).transform((v) => String(v)),
  receivedAt: z.string().optional(),
  purchaseOrderNo: z.string().optional().nullable(),
  partDescription: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
});

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

  const qty = Math.trunc(Number(parsed.data.quantity));
  if (!Number.isFinite(qty) || qty < 1) {
    return NextResponse.json({ error: "入库数量须为正整数" }, { status: 400 });
  }

  const p = await prisma.product.findUnique({ where: { id: productId } });
  if (!p) {
    return NextResponse.json({ error: "商品不存在" }, { status: 404 });
  }

  let receivedAt = new Date();
  if (parsed.data.receivedAt) {
    const d = new Date(parsed.data.receivedAt);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "入库时间无效" }, { status: 400 });
    }
    receivedAt = d;
  }

  const row = await prisma.productInbound.create({
    data: {
      productId,
      quantity: qty,
      receivedAt,
      purchaseOrderNo: parsed.data.purchaseOrderNo?.trim() || null,
      partDescription: parsed.data.partDescription?.trim() || null,
      remark: parsed.data.remark?.trim() || null,
      operatorUserId: auth.user.id,
    },
  });

  return NextResponse.json({ id: row.id });
}
