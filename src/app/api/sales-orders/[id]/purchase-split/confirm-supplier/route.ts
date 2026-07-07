import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  ackPurchaseSupplierConfirm,
  revokePurchaseSupplierConfirm,
} from "@/lib/purchase-sales-supplier-confirm";

const bodySchema = z.object({
  supplierId: z.string().min(1),
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

  const so = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { id: true },
  });
  if (!so) {
    return NextResponse.json({ error: "销售订单不存在" }, { status: 404 });
  }

  const supplier = await prisma.supplier.findUnique({
    where: { id: parsed.data.supplierId },
    select: { id: true },
  });
  if (!supplier) {
    return NextResponse.json({ error: "供应商不存在" }, { status: 404 });
  }

  try {
    if (parsed.data.revoke) {
      await revokePurchaseSupplierConfirm(
        prisma,
        salesOrderId,
        parsed.data.supplierId,
      );
    } else {
      await ackPurchaseSupplierConfirm(
        prisma,
        salesOrderId,
        parsed.data.supplierId,
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "操作失败" },
      { status: 400 },
    );
  }
}
