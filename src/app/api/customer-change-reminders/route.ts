import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const createSchema = z.object({
  customerId: z.string().min(1, "请选择客户"),
  productId: z.string().min(1, "请选择商品"),
  changeSummary: z.string().trim().min(1, "请填写变更内容"),
  proposedAt: z.string().datetime().optional(),
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

export async function GET(req: Request) {
  const auth = await requirePermission("sales.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  try {
    const { searchParams } = new URL(req.url);
    const includeDone = searchParams.get("includeDone") === "1";
    const customerId = searchParams.get("customerId")?.trim() || undefined;
    const where = {
      ...(customerId ? { customerId } : {}),
      ...(includeDone
        ? {}
        : { status: "ACTIVE" as const }),
    };
    const list = await prisma.customerChangeReminder.findMany({
      where,
      include: {
        customer: { select: { id: true, code: true, name: true } },
        product: {
          select: { id: true, model: true, customerMaterialCode: true },
        },
        createdBy: { select: { id: true, name: true } },
        salesLastConfirmedBy: { select: { id: true, name: true } },
        purchaseLastConfirmedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ proposedAt: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ list: list.map(mapReminderRow) });
  } catch (e) {
    console.error("[GET /api/customer-change-reminders]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const auth = await requirePermission("sales.create");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    const fe = parsed.error.flatten();
    return NextResponse.json(
      { error: fe.fieldErrors, formErrors: fe.formErrors },
      { status: 400 },
    );
  }
  const d = parsed.data;
  try {
    const product = await prisma.product.findUnique({
      where: { id: d.productId },
      select: { id: true, customerId: true },
    });
    if (!product) {
      return NextResponse.json({ error: "商品不存在" }, { status: 400 });
    }
    if (product.customerId !== d.customerId) {
      return NextResponse.json(
        { error: "所选商品与客户不匹配" },
        { status: 400 },
      );
    }
    const row = await prisma.customerChangeReminder.create({
      data: {
        customerId: d.customerId,
        productId: d.productId,
        changeSummary: d.changeSummary,
        proposedAt: d.proposedAt ? new Date(d.proposedAt) : new Date(),
        status: "ACTIVE",
        createdById: auth.user.id,
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
    console.error("[POST /api/customer-change-reminders]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "创建失败" },
      { status: 500 },
    );
  }
}
