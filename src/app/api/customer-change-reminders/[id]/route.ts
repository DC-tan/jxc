import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const updateSchema = z.object({
  customerId: z.string().min(1, "请选择客户"),
  productId: z.string().min(1, "请选择商品"),
  changeSummary: z.string().trim().min(1, "请填写变更内容"),
  proposedAt: z.string().datetime(),
});

const voidSchema = z.object({
  action: z.literal("void"),
});

function mapReminderRow(row: {
  id: string;
  customerId: string;
  customer: { name: string; code: string };
  productId: string;
  product: { model: string; customerMaterialCode: string };
  changeSummary: string;
  proposedAt: Date;
  status: string;
  salesConfirmCount: number;
  purchaseConfirmCount: number;
  salesLastConfirmedAt: Date | null;
  salesLastConfirmedBy: { name: string } | null;
  purchaseLastConfirmedAt: Date | null;
  purchaseLastConfirmedBy: { name: string } | null;
  createdBy: { name: string };
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName: row.customer.name,
    customerCode: row.customer.code,
    productId: row.productId,
    productModel: row.product.model,
    customerMaterialCode: row.product.customerMaterialCode,
    changeSummary: row.changeSummary,
    proposedAt: row.proposedAt.toISOString(),
    status: row.status,
    salesConfirmCount: row.salesConfirmCount,
    purchaseConfirmCount: row.purchaseConfirmCount,
    salesLastConfirmedAt: row.salesLastConfirmedAt?.toISOString() ?? null,
    salesLastConfirmedByName: row.salesLastConfirmedBy?.name ?? null,
    purchaseLastConfirmedAt: row.purchaseLastConfirmedAt?.toISOString() ?? null,
    purchaseLastConfirmedByName: row.purchaseLastConfirmedBy?.name ?? null,
    createdByName: row.createdBy.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("sales.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const { id } = await ctx.params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const asVoid = voidSchema.safeParse(json);
  try {
    if (asVoid.success) {
      const row = await prisma.customerChangeReminder.update({
        where: { id },
        data: { status: "VOIDED" },
        include: {
          customer: { select: { id: true, code: true, name: true } },
          product: {
            select: { id: true, model: true, customerMaterialCode: true },
          },
          createdBy: { select: { id: true, name: true } },
          salesLastConfirmedBy: { select: { id: true, name: true } },
          purchaseLastConfirmedBy: { select: { id: true, name: true } },
        },
      });
      return NextResponse.json(mapReminderRow(row));
    }

    const parsed = updateSchema.safeParse(json);
    if (!parsed.success) {
      const fe = parsed.error.flatten();
      return NextResponse.json(
        { error: fe.fieldErrors, formErrors: fe.formErrors },
        { status: 400 },
      );
    }
    const d = parsed.data;
    const existing = await prisma.customerChangeReminder.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }
    if (existing.status !== "ACTIVE") {
      return NextResponse.json({ error: "仅进行中的提醒可修改" }, { status: 400 });
    }
    const product = await prisma.product.findUnique({
      where: { id: d.productId },
      select: { customerId: true },
    });
    if (!product || product.customerId !== d.customerId) {
      return NextResponse.json(
        { error: "所选商品与客户不匹配" },
        { status: 400 },
      );
    }
    const row = await prisma.customerChangeReminder.update({
      where: { id },
      data: {
        customerId: d.customerId,
        productId: d.productId,
        changeSummary: d.changeSummary,
        proposedAt: new Date(d.proposedAt),
      },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        product: {
          select: { id: true, model: true, customerMaterialCode: true },
        },
        createdBy: { select: { id: true, name: true } },
        salesLastConfirmedBy: { select: { id: true, name: true } },
        purchaseLastConfirmedBy: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json(mapReminderRow(row));
  } catch (e) {
    console.error("[PATCH /api/customer-change-reminders/:id]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "更新失败" },
      { status: 500 },
    );
  }
}
