import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermissionSome } from "@/lib/api-auth";

const bodySchema = z.object({
  salesOrderId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  productIds: z.array(z.string().min(1)).optional(),
  materialIds: z.array(z.string().min(1)).optional(),
  channel: z.enum(["sales", "purchase"]),
});

function toUniqueStrings(input: string[] | undefined): string[] {
  if (!input?.length) return [];
  return [...new Set(input.map((x) => x.trim()).filter(Boolean))];
}

export async function POST(req: Request) {
  const auth = await requirePermissionSome([
    "sales.create",
    "purchase.create",
    "purchase.edit",
  ]);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const fe = parsed.error.flatten();
    return NextResponse.json(
      { error: fe.fieldErrors, formErrors: fe.formErrors },
      { status: 400 },
    );
  }

  let customerId = parsed.data.customerId?.trim() || "";
  let productIds = toUniqueStrings(parsed.data.productIds);
  const materialIds = toUniqueStrings(parsed.data.materialIds);

  try {
    if (parsed.data.salesOrderId) {
      const so = await prisma.salesOrder.findUnique({
        where: { id: parsed.data.salesOrderId },
        select: {
          customerId: true,
          lines: { select: { productId: true } },
        },
      });
      if (!so) {
        return NextResponse.json({ error: "销售订单不存在" }, { status: 400 });
      }
      customerId = so.customerId;
      productIds = toUniqueStrings(so.lines.map((x) => x.productId));
    }

    if (productIds.length === 0 && materialIds.length > 0) {
      const productMaterialRows = await prisma.productMaterial.findMany({
        where: { materialId: { in: materialIds } },
        select: { productId: true },
        distinct: ["productId"],
      });
      productIds = toUniqueStrings(productMaterialRows.map((x) => x.productId));
    }

    if (productIds.length === 0) {
      return NextResponse.json({ list: [] });
    }

    const list = await prisma.customerChangeReminder.findMany({
      where: {
        ...(customerId ? { customerId } : {}),
        productId: { in: productIds },
        status: "ACTIVE",
        ...(parsed.data.channel === "sales"
          ? { salesConfirmCount: { lt: 2 } }
          : { purchaseConfirmCount: { lt: 2 } }),
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
      orderBy: [{ proposedAt: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({
      list: list.map((row) => ({
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
        createdByName: row.createdBy.name,
        salesLastConfirmedAt: row.salesLastConfirmedAt?.toISOString() ?? null,
        salesLastConfirmedByName: row.salesLastConfirmedBy?.name ?? null,
        purchaseLastConfirmedAt: row.purchaseLastConfirmedAt?.toISOString() ?? null,
        purchaseLastConfirmedByName: row.purchaseLastConfirmedBy?.name ?? null,
      })),
    });
  } catch (e) {
    console.error("[POST /api/customer-change-reminders/match]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载提醒失败" },
      { status: 500 },
    );
  }
}
