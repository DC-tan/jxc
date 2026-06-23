import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  ackPurchaseSkipMaterials,
  revokePurchaseSkipMaterials,
} from "@/lib/purchase-sales-skip-material";

const bodySchema = z.object({
  materialIds: z.array(z.string().min(1)),
  revoke: z.boolean().optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("purchase.create");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id: salesOrderId } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  try {
    const { materialIds, revoke } = parsed.data;
    const count = revoke
      ? await revokePurchaseSkipMaterials(prisma, salesOrderId, materialIds)
      : await ackPurchaseSkipMaterials(prisma, salesOrderId, materialIds);
    return NextResponse.json({ ok: true, count });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "操作失败" },
      { status: 400 },
    );
  }
}
