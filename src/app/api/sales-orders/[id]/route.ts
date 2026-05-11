import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  effectiveQuantityShipped,
  storedQuantityShipped,
} from "@/lib/sales-order-shipping";

function parseImageUrls(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

const lineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
  unitPrice: z.union([z.number(), z.string()]).optional(),
  remark: z.string().optional().nullable(),
});

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("deliver"),
    /** 不传则默认当前时间 */
    actualDeliveredAt: z.string().optional(),
  }),
  z.object({
    action: z.literal("update"),
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
  }),
]);

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

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("sales.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;

  try {
    const row = await prisma.salesOrder.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        lines: {
          orderBy: { sortOrder: "asc" },
          include: {
            product: {
              select: {
                id: true,
                customerMaterialCode: true,
                model: true,
                spec: true,
                unit: true,
                price: true,
                inspectionNotes: true,
                imageUrls: true,
              },
            },
          },
        },
      },
    });

    if (!row) {
      return NextResponse.json({ error: "销售订单不存在" }, { status: 404 });
    }

    return NextResponse.json({
      id: row.id,
      customerOrderNo: row.customerOrderNo,
      customerModel: row.customerModel,
      deliveryDueAt: row.deliveryDueAt?.toISOString() ?? null,
      actualDeliveredAt: row.actualDeliveredAt?.toISOString() ?? null,
      totalAmount: row.totalAmount.toString(),
      remark: row.remark,
      customer: row.customer,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lines: row.lines.map((l) => {
        const shipped = effectiveQuantityShipped(
          l.quantity,
          storedQuantityShipped(l),
          row.actualDeliveredAt,
        );
        return {
          id: l.id,
          quantity: String(l.quantity),
          quantityShipped: String(shipped),
          unitPrice: l.unitPrice.toString(),
          remark: l.remark,
          product: {
            id: l.product.id,
            customerMaterialCode: l.product.customerMaterialCode,
            model: l.product.model,
            spec: l.product.spec,
            unit: l.product.unit,
            price: l.product.price.toString(),
            inspectionNotes: l.product.inspectionNotes,
            imageUrls: parseImageUrls(l.product.imageUrls),
          },
        };
      }),
    });
  } catch (e) {
    console.error("[GET /api/sales-orders/[id]]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
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

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    const fe = parsed.error.flatten();
    return NextResponse.json(
      { error: fe.fieldErrors, formErrors: fe.formErrors },
      { status: 400 },
    );
  }

  if (parsed.data.action === "deliver") {
    const at = parsed.data.actualDeliveredAt
      ? new Date(parsed.data.actualDeliveredAt)
      : new Date();
    if (Number.isNaN(at.getTime())) {
      return NextResponse.json({ error: "实际交货时间无效" }, { status: 400 });
    }

    try {
      const existing = await prisma.salesOrder.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json({ error: "销售订单不存在" }, { status: 404 });
      }
      if (existing.actualDeliveredAt) {
        return NextResponse.json({ error: "该订单已确认出货" }, { status: 400 });
      }

      await prisma.$transaction(async (tx) => {
        const lines = await tx.salesOrderLine.findMany({
          where: { salesOrderId: id },
          select: { id: true, quantity: true },
        });
        for (const ln of lines) {
          await tx.salesOrderLine.update({
            where: { id: ln.id },
            data: { quantityShipped: ln.quantity } as object,
          });
        }
        await tx.salesOrder.update({
          where: { id },
          data: { actualDeliveredAt: at },
        });
      });

      return NextResponse.json({ ok: true, actualDeliveredAt: at.toISOString() });
    } catch (e) {
      console.error("[PATCH /api/sales-orders/[id]] deliver", e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "更新失败" },
        { status: 500 },
      );
    }
  }

  const d = parsed.data;
  try {
    const existing = await prisma.salesOrder.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "销售订单不存在" }, { status: 404 });
    }
    if (existing.actualDeliveredAt) {
      return NextResponse.json(
        { error: "已出货的订单不可修改" },
        { status: 400 },
      );
    }

    const anyShipped = await prisma.salesOrderLine.findFirst({
      where: { salesOrderId: id, quantityShipped: { gt: 0 } } as object,
    });
    if (anyShipped) {
      return NextResponse.json(
        { error: "该订单已有出货记录，不可修改" },
        { status: 400 },
      );
    }

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
      select: { id: true, customerId: true },
    });
    if (products.length !== productIds.length) {
      return NextResponse.json({ error: "存在无效的商品" }, { status: 400 });
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

    const row = await prisma.$transaction(async (tx) => {
      await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } });
      return tx.salesOrder.update({
        where: { id },
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
    console.error("[PATCH /api/sales-orders/[id]] update", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "更新失败" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("sales.delete");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;

  try {
    const existing = await prisma.salesOrder.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "销售订单不存在" }, { status: 404 });
    }
    if (existing.actualDeliveredAt) {
      return NextResponse.json(
        { error: "已出货的订单不可删除" },
        { status: 400 },
      );
    }

    const anyShipped = await prisma.salesOrderLine.findFirst({
      where: { salesOrderId: id, quantityShipped: { gt: 0 } } as object,
    });
    if (anyShipped) {
      return NextResponse.json(
        { error: "该订单已有出货记录，不可删除" },
        { status: 400 },
      );
    }

    await prisma.salesOrder.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/sales-orders/[id]]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "删除失败" },
      { status: 500 },
    );
  }
}
