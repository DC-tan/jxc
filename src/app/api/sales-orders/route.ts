import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const lineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
  unitPrice: z.union([z.number(), z.string()]).optional(),
  remark: z.string().optional().nullable(),
});

const createSchema = z.object({
  customerId: z.string().min(1, "请选择客户"),
  customerOrderNo: z
    .string()
    .min(1, "请填写客户订单编号")
    .transform((s) => s.trim()),
  customerModel: z
    .string()
    .optional()
    .transform((s) => (s ?? "").trim()),
  deliveryDueAt: z
    .string()
    .min(1, "请选择要求交货时间")
    .transform((s) => new Date(s.trim()))
    .refine((d) => !Number.isNaN(d.getTime()), "要求交货时间无效"),
  remark: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, "请至少添加一行商品"),
});

function toDecimal(v: unknown, fallback = "0"): string {
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return String(v);
}

/** 数量：正整数 */
function toPositiveInt(v: unknown, fallback = 1): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export async function GET(req: Request) {
  const auth = await requirePermission("sales.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const pending = searchParams.get("pending") === "1";
    const deliveredFrom = searchParams.get("deliveredFrom");
    const deliveredTo = searchParams.get("deliveredTo");
    const createdFrom = searchParams.get("createdFrom");
    const createdTo = searchParams.get("createdTo");
    const customerId = searchParams.get("customerId")?.trim() || undefined;
    const customerOrderNo =
      searchParams.get("customerOrderNo")?.trim() || undefined;
    const customerModel =
      searchParams.get("customerModel")?.trim() || undefined;

    const where: Prisma.SalesOrderWhereInput = {};

    if (customerId) where.customerId = customerId;
    if (customerOrderNo) {
      where.customerOrderNo = {
        contains: customerOrderNo,
        mode: "insensitive",
      };
    }
    if (customerModel) {
      where.customerModel = {
        contains: customerModel,
        mode: "insensitive",
      };
    }

    if (pending) {
      where.actualDeliveredAt = null;
      if (createdFrom && createdTo) {
        const a = new Date(createdFrom);
        const b = new Date(createdTo);
        if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
          where.createdAt = { gte: a, lte: b };
        }
      }
    } else if (deliveredFrom && deliveredTo) {
      const a = new Date(deliveredFrom);
      const b = new Date(deliveredTo);
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
        where.actualDeliveredAt = { gte: a, lte: b };
      }
    } else if (createdFrom && createdTo) {
      const a = new Date(createdFrom);
      const b = new Date(createdTo);
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
        where.createdAt = { gte: a, lte: b };
      }
    }

    const list = await prisma.salesOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
        ...(pending
          ? {
              lines: {
                select: { quantity: true, quantityShipped: true },
              },
            }
          : {}),
      },
    });

    const normalizedList = pending
      ? list.filter((o) => {
          const lines = (o as typeof o & {
            lines?: { quantity: number; quantityShipped: number }[];
          }).lines;
          const hasUnshippedLine = (lines ?? []).some(
            (ln) => Math.max(0, ln.quantityShipped) < Math.max(0, ln.quantity),
          );
          return o.actualDeliveredAt == null || hasUnshippedLine;
        })
      : list;

    return NextResponse.json({
      list: normalizedList.map((p) => ({
        id: p.id,
        customerOrderNo: p.customerOrderNo,
        customerModel: p.customerModel,
        deliveryDueAt: p.deliveryDueAt?.toISOString() ?? null,
        actualDeliveredAt: p.actualDeliveredAt?.toISOString() ?? null,
        totalAmount: p.totalAmount.toString(),
        remark: p.remark,
        customer: p.customer,
        lineCount: p._count.lines,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  } catch (e) {
    console.error("[GET /api/sales-orders]", e);
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
  const cust = await prisma.customer.findUnique({ where: { id: d.customerId } });
  if (!cust) {
    return NextResponse.json({ error: "客户不存在" }, { status: 400 });
  }

  const productIds = d.lines.map((l) => l.productId);
  if (new Set(productIds).size !== productIds.length) {
    return NextResponse.json({ error: "商品不能重复添加" }, { status: 400 });
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, customerId: true, isDeprecated: true },
  });
  if (products.length !== productIds.length) {
    return NextResponse.json({ error: "存在无效的商品" }, { status: 400 });
  }
  if (products.some((p) => p.isDeprecated)) {
    return NextResponse.json(
      { error: "不能添加已弃用的商品" },
      { status: 400 },
    );
  }
  const wrongCustomer = products
    .filter((p) => p.customerId !== d.customerId)
    .map((p) => p.id);
  if (wrongCustomer.length > 0) {
    return NextResponse.json(
      { error: "所选商品必须属于当前客户" },
      { status: 400 },
    );
  }

  let totalAmount = 0;
  const lineCreates = d.lines.map((l, i) => {
    const qty = toPositiveInt(l.quantity, 1);
    const up = Number(toDecimal(l.unitPrice ?? 0, "0"));
    totalAmount += qty * up;
    return {
      productId: l.productId,
      quantity: qty,
      unitPrice: toDecimal(l.unitPrice ?? 0, "0"),
      remark: l.remark?.trim() || null,
      sortOrder: i,
    };
  });

  try {
    const row = await prisma.salesOrder.create({
      data: {
        customerId: d.customerId,
        customerOrderNo: d.customerOrderNo,
        customerModel: d.customerModel ?? "",
        deliveryDueAt: d.deliveryDueAt,
        totalAmount: String(totalAmount),
        remark: d.remark?.trim() || null,
        lines: {
          create: lineCreates,
        },
      },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
      },
    });

    return NextResponse.json({
      id: row.id,
      customerOrderNo: row.customerOrderNo,
      customerModel: row.customerModel,
      deliveryDueAt: row.deliveryDueAt?.toISOString() ?? null,
      actualDeliveredAt: row.actualDeliveredAt?.toISOString() ?? null,
      totalAmount: row.totalAmount.toString(),
      remark: row.remark,
      customer: row.customer,
      lineCount: row._count.lines,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (e) {
    console.error("[POST /api/sales-orders]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "创建失败" },
      { status: 500 },
    );
  }
}
