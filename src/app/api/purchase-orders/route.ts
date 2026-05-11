import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { computePurchaseOrderDeliveryDue } from "@/lib/purchase-order-delivery";
import { allocatePurchaseOrderNo } from "@/lib/purchase-order-number";

const lineSchema = z.object({
  materialId: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
  unitPrice: z.union([z.number(), z.string()]).optional(),
  remark: z.string().optional().nullable(),
});

const createSchema = z.object({
  supplierId: z.string().min(1, "请选择供应商"),
  remark: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, "请至少添加一行物料"),
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

export async function GET(req: Request) {
  const auth = await requirePermission("purchase.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const createdFrom = searchParams.get("createdFrom");
    const createdTo = searchParams.get("createdTo");
    const supplierId = searchParams.get("supplierId")?.trim() || undefined;
    const orderNo = searchParams.get("orderNo")?.trim() || undefined;
    /** 未交采购：待收料 */
    const pendingOnly = searchParams.get("pending") === "1";
    /** 采购订单查询：仅已收料确认、已结单或已取消（不含待收料） */
    const inQuery = searchParams.get("inQuery") === "1";

    const where: Prisma.PurchaseOrderWhereInput = {};
    if (pendingOnly && inQuery) {
      return NextResponse.json(
        { error: "参数冲突：不能同时指定 pending 与 inQuery" },
        { status: 400 },
      );
    }
    if (pendingOnly) {
      where.status = "PENDING_RECEIPT";
    } else if (inQuery) {
      where.status = { in: ["CONFIRMED", "CLOSED", "CANCELLED"] as never };
    }
    if (createdFrom && createdTo) {
      const a = new Date(createdFrom);
      const b = new Date(createdTo);
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
        where.createdAt = { gte: a, lte: b };
      }
    }
    if (supplierId) where.supplierId = supplierId;
    if (orderNo) {
      where.orderNo = { contains: orderNo, mode: "insensitive" };
    }

    const list = await prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        salesOrder: {
          select: {
            id: true,
            customerOrderNo: true,
            customerModel: true,
          },
        },
        _count: { select: { lines: true } },
      },
    });

    const orderIds = list.map((p) => p.id);
    const orderNos = list.map((p) => p.orderNo);
    const lineCountByOrderId = new Map<string, number>();

    if (orderIds.length > 0) {
      const [lineRows, inboundRows] = await Promise.all([
        prisma.purchaseOrderLine.findMany({
          where: { purchaseOrderId: { in: orderIds } },
          select: { purchaseOrderId: true, materialId: true },
        }),
        prisma.materialInbound.findMany({
          where: { purchaseOrderNo: { in: orderNos } },
          select: { purchaseOrderNo: true, materialId: true },
        }),
      ]);

      const fallbackById = new Map(list.map((p) => [p.id, p._count.lines]));
      const materialSetByOrderId = new Map<string, Set<string>>();

      for (const row of lineRows) {
        const set = materialSetByOrderId.get(row.purchaseOrderId) ?? new Set<string>();
        set.add(row.materialId);
        materialSetByOrderId.set(row.purchaseOrderId, set);
      }

      const orderIdByOrderNo = new Map(list.map((p) => [p.orderNo, p.id]));
      for (const row of inboundRows) {
        const orderId = orderIdByOrderNo.get(row.purchaseOrderNo);
        if (!orderId) continue;
        const set = materialSetByOrderId.get(orderId) ?? new Set<string>();
        set.add(row.materialId);
        materialSetByOrderId.set(orderId, set);
      }

      for (const id of orderIds) {
        const liveCount = materialSetByOrderId.get(id)?.size ?? 0;
        // fallback 保底：避免历史脏数据导致无任何明细/流水时显示异常
        const fallback = fallbackById.get(id) ?? 0;
        lineCountByOrderId.set(id, liveCount || fallback);
      }
    }

    return NextResponse.json({
      list: list.map((p) => ({
        id: p.id,
        orderNo: p.orderNo,
        status: p.status,
        remark: p.remark,
        supplier: p.supplier,
        salesOrder: p.salesOrder,
        lineCount: lineCountByOrderId.get(p.id) ?? p._count.lines,
        deliveryDueAt: p.deliveryDueAt?.toISOString() ?? null,
        actualDeliveredAt: p.actualDeliveredAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  } catch (e) {
    console.error("[GET /api/purchase-orders]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
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

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    const fe = parsed.error.flatten();
    return NextResponse.json(
      { error: fe.fieldErrors, formErrors: fe.formErrors },
      { status: 400 },
    );
  }

  const d = parsed.data;
  const sup = await prisma.supplier.findUnique({
    where: { id: d.supplierId },
    select: { id: true, deliveryLeadDays: true },
  });
  if (!sup) {
    return NextResponse.json({ error: "供应商不存在" }, { status: 400 });
  }

  const matIds = d.lines.map((l) => l.materialId);
  if (new Set(matIds).size !== matIds.length) {
    return NextResponse.json({ error: "物料不能重复添加" }, { status: 400 });
  }

  const mats = await prisma.material.findMany({
    where: { id: { in: matIds } },
    select: { id: true, isCustomerSupplied: true, supplierId: true },
  });
  if (mats.length !== matIds.length) {
    return NextResponse.json({ error: "存在无效的物料" }, { status: 400 });
  }
  if (mats.some((m) => m.isCustomerSupplied)) {
    return NextResponse.json(
      { error: "客供料不可加入采购单，请在“物料信息-客供料入口”中收料入库" },
      { status: 400 },
    );
  }
  if (mats.some((m) => m.supplierId !== d.supplierId)) {
    return NextResponse.json(
      { error: "存在物料与所选供应商不匹配" },
      { status: 400 },
    );
  }

  try {
    const row = await prisma.$transaction(async (tx) => {
      const orderNo = await allocatePurchaseOrderNo(tx, d.supplierId);
      const createdAt = new Date();
      const deliveryDueAt = computePurchaseOrderDeliveryDue(
        createdAt,
        sup.deliveryLeadDays,
      );
      return tx.purchaseOrder.create({
        data: {
          orderNo,
          supplierId: d.supplierId,
          status: "PENDING_RECEIPT",
          remark: d.remark?.trim() || null,
          createdAt,
          deliveryDueAt,
          lines: {
            create: d.lines.map((l, i) => ({
              materialId: l.materialId,
              quantity: toPositiveInt(l.quantity, 1),
              unitPrice: toDecimal(l.unitPrice ?? 0, "0"),
              remark: l.remark?.trim() || null,
              sortOrder: i,
            })),
          },
        },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          _count: { select: { lines: true } },
        },
      });
    });

    return NextResponse.json({
      id: row.id,
      orderNo: row.orderNo,
      remark: row.remark,
      supplier: row.supplier,
      lineCount: row._count.lines,
      deliveryDueAt: row.deliveryDueAt?.toISOString() ?? null,
      actualDeliveredAt: row.actualDeliveredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (e) {
    console.error("[POST /api/purchase-orders]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "创建失败" },
      { status: 500 },
    );
  }
}
