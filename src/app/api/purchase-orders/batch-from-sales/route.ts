import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { computePurchaseOrderDeliveryDue } from "@/lib/purchase-order-delivery";
import { allocatePurchaseOrderNo } from "@/lib/purchase-order-number";
import {
  parseExtraFeesPayload,
  syncPurchaseOrderExtraFees,
} from "@/lib/purchase-extra-fees";

const lineInSchema = z.object({
  materialId: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
  unitPrice: z.union([z.number(), z.string()]).optional(),
  remark: z.string().optional().nullable(),
});

const groupSchema = z.object({
  supplierId: z.string().min(1),
  /** 先原样接受，提交后过滤掉 quantity <= 0 行；行全空则整组丢弃 */
  lines: z.array(lineInSchema),
  extraFees: z.array(z.unknown()).optional(),
});

const bodySchema = z.object({
  salesOrderId: z.string().min(1),
  remark: z.string().optional().nullable(),
  groups: z.array(groupSchema).min(1),
});

function toDecimal(v: unknown, fallback = "0"): string {
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return String(v);
}

function toPositiveInt(v: unknown, fallback = 1): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

function isPositiveIntQuantity(v: unknown): boolean {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0;
}

export async function POST(req: Request) {
  const auth = await requirePermission("purchase.create");
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

  const { salesOrderId, groups: rawGroups, remark } = parsed.data;

  const groups: {
    supplierId: string;
    lines: z.infer<typeof lineInSchema>[];
    extraFees: { amount: number; purpose: string }[];
  }[] = [];
  for (const g of rawGroups) {
    const lines = g.lines.filter((l) => isPositiveIntQuantity(l.quantity));
    if (lines.length === 0) continue;
    const extraParsed = parseExtraFeesPayload(g.extraFees);
    if (!extraParsed.ok) {
      return NextResponse.json({ error: extraParsed.error }, { status: 400 });
    }
    groups.push({
      supplierId: g.supplierId,
      lines,
      extraFees: extraParsed.fees,
    });
  }
  if (groups.length === 0) {
    return NextResponse.json(
      { error: "没有有效的采购明细（每行数量须大于 0）" },
      { status: 400 },
    );
  }

  const so = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { id: true },
  });
  if (!so) {
    return NextResponse.json({ error: "销售订单不存在" }, { status: 400 });
  }

  const allMatIds = new Set<string>();
  for (const g of groups) {
    for (const l of g.lines) {
      allMatIds.add(l.materialId);
    }
  }

  const mats = await prisma.material.findMany({
    where: { id: { in: [...allMatIds] } },
    select: {
      id: true,
      supplierId: true,
      isCustomerSupplied: true,
      purchaseChannel: true,
    },
  });
  if (mats.length !== allMatIds.size) {
    return NextResponse.json({ error: "存在无效物料" }, { status: 400 });
  }

  if (mats.some((m) => m.isCustomerSupplied)) {
    return NextResponse.json(
      { error: "存在客供料，请从采购拆单中移除并在客供料入口执行收料" },
      { status: 400 },
    );
  }
  if (mats.some((m) => m.purchaseChannel !== "STANDARD_PURCHASE")) {
    return NextResponse.json(
      { error: "销售订单拆单仅支持常规采购物料，PCB加工合同请在“PCB采购”TAB录入" },
      { status: 400 },
    );
  }

  for (const g of groups) {
    const sup = await prisma.supplier.findUnique({
      where: { id: g.supplierId },
    });
    if (!sup) {
      return NextResponse.json({ error: "供应商不存在" }, { status: 400 });
    }
    for (const l of g.lines) {
      const m = mats.find((x) => x.id === l.materialId);
      if (!m || m.supplierId !== g.supplierId) {
        return NextResponse.json(
          { error: "物料与供应商分组不一致" },
          { status: 400 },
        );
      }
    }
    const ids = g.lines.map((l) => l.materialId);
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json(
        { error: "同一采购单中物料不能重复" },
        { status: 400 },
      );
    }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const out: {
        id: string;
        orderNo: string;
        supplierId: string;
        lineCount: number;
      }[] = [];

      for (const g of groups) {
        const orderNo = await allocatePurchaseOrderNo(tx, g.supplierId);
        const supLead = await tx.supplier.findUnique({
          where: { id: g.supplierId },
          select: { deliveryLeadDays: true },
        });
        const createdAt = new Date();
        const deliveryDueAt = computePurchaseOrderDeliveryDue(
          createdAt,
          supLead?.deliveryLeadDays,
        );
        const row = await tx.purchaseOrder.create({
          data: {
            orderNo,
            supplierId: g.supplierId,
            salesOrderId,
            purchaseChannel: "STANDARD_PURCHASE",
            status: "PENDING_RECEIPT",
            remark: remark?.trim() || null,
            createdAt,
            deliveryDueAt,
            lines: {
              create: g.lines.map((l, i) => ({
                materialId: l.materialId,
                quantity: toPositiveInt(l.quantity, 1),
                unitPrice: toDecimal(l.unitPrice ?? 0, "0"),
                remark: l.remark?.trim() || null,
                sortOrder: i,
              })),
            },
          },
          include: {
            _count: { select: { lines: true } },
          },
        });
        await syncPurchaseOrderExtraFees(tx, row.id, g.extraFees);
        out.push({
          id: row.id,
          orderNo: row.orderNo,
          supplierId: row.supplierId,
          lineCount: row._count.lines,
        });
      }
      return out;
    });

    return NextResponse.json({ ok: true, orders: created });
  } catch (e) {
    console.error("[POST /api/purchase-orders/batch-from-sales]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "创建失败" },
      { status: 500 },
    );
  }
}
