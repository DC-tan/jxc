import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { allocateOutsourceOrderNo } from "@/lib/outsource-order-number";
import { computeOutsourceLinesFromBom } from "@/lib/outsource-lines";
import { getMaterialInboundTotalsByIds } from "@/lib/materialStock";
import { productBomForOutsource } from "@/lib/product-bom-scope";

const lineInSchema = z.object({
  materialId: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
});

const postSchema = z.object({
  productId: z.string().min(1),
  productQty: z.union([z.number(), z.string()]),
  supplierId: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
  lines: z.array(lineInSchema).optional(),
});

function toPositiveInt(v: unknown, fallback = 1): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

function toPositiveLineQty(v: unknown): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

export async function GET(req: Request) {
  const auth = await requirePermission("outsource.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status")?.trim().toUpperCase();
  const keyword = searchParams.get("keyword")?.trim() ?? "";
  const from = searchParams.get("from")?.trim();
  const to = searchParams.get("to")?.trim();

  const where: Prisma.OutsourceOrderWhereInput = {};
  if (status === "OPEN" || status === "CLOSED" || status === "CANCELLED") {
    where.status = status;
  }
  if (keyword) {
    where.OR = [
      { orderNo: { contains: keyword, mode: "insensitive" } },
      { product: { model: { contains: keyword, mode: "insensitive" } } },
      { product: { customerMaterialCode: { contains: keyword, mode: "insensitive" } } },
      {
        product: {
          customer: { name: { contains: keyword, mode: "insensitive" } },
        },
      },
    ];
  }
  if (from || to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (from) {
      const g = new Date(from);
      if (!Number.isNaN(g.getTime())) createdAt.gte = g;
    }
    if (to) {
      const end = new Date(to);
      if (!Number.isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
    }
    if (Object.keys(createdAt).length > 0) {
      where.createdAt = createdAt;
    }
  }

  try {
    const rows = await prisma.outsourceOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        supplier: {
          select: { id: true, code: true, name: true, shortName: true },
        },
        product: {
          select: {
            id: true,
            model: true,
            customerMaterialCode: true,
            unit: true,
            customer: { select: { code: true, name: true } },
          },
        },
        lines: {
          orderBy: { sortOrder: "asc" },
          include: {
            material: {
              select: { id: true, code: true, name: true, unit: true },
            },
          },
        },
      },
    });

    const orderNos = rows
      .map((r) => r.orderNo?.trim())
      .filter((x): x is string => Boolean(x));
    const [materialReceived, productInbounded, recoveryInbounded] = await Promise.all([
      prisma.materialInbound.groupBy({
        by: ["purchaseOrderNo"],
        where: {
          purchaseOrderNo: { in: orderNos },
          quantity: { gt: 0 },
        },
        _count: { _all: true },
      }),
      prisma.productInbound.groupBy({
        by: ["purchaseOrderNo"],
        where: {
          purchaseOrderNo: { in: orderNos },
          quantity: { gt: 0 },
        },
        _count: { _all: true },
      }),
      prisma.outsourceRecoveryInbound.groupBy({
        by: ["outsourceOrderNo"],
        where: {
          outsourceOrderNo: { in: orderNos },
          quantity: { gt: 0 },
        },
        _count: { _all: true },
      }),
    ]);
    const hasPositiveInboundByOrderNo = new Set<string>();
    for (const g of materialReceived) {
      if (g.purchaseOrderNo) hasPositiveInboundByOrderNo.add(g.purchaseOrderNo);
    }
    for (const g of productInbounded) {
      if (g.purchaseOrderNo) hasPositiveInboundByOrderNo.add(g.purchaseOrderNo);
    }
    for (const g of recoveryInbounded) {
      if (g.outsourceOrderNo) hasPositiveInboundByOrderNo.add(g.outsourceOrderNo);
    }

    return NextResponse.json({
      list: rows.map((r) => ({
        id: r.id,
        orderNo: r.orderNo,
        status: r.status,
        productQty: r.productQty,
        remark: r.remark,
        receivedAt: r.receivedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        canCancel:
          r.status === "OPEN" && !hasPositiveInboundByOrderNo.has(r.orderNo),
        supplier: r.supplier,
        product: r.product,
        lines: r.lines.map((l) => ({
          id: l.id,
          quantity: l.quantity,
          material: l.material,
        })),
      })),
    });
  } catch (e) {
    console.error("[GET /api/outsource-orders]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const auth = await requirePermission("outsource.create");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { productId, remark } = parsed.data;
  const productQty = toPositiveInt(parsed.data.productQty, 1);
  const supplierIdRaw = parsed.data.supplierId?.trim();
  const supplierId = supplierIdRaw && supplierIdRaw.length > 0 ? supplierIdRaw : null;

  if (supplierId) {
    const sup = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!sup) {
      return NextResponse.json({ error: "供应商不存在" }, { status: 400 });
    }
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      productMaterials: {
        orderBy: { sortOrder: "asc" },
        select: { materialId: true, usageQty: true, scope: true },
      },
    },
  });
  if (!product) {
    return NextResponse.json({ error: "商品不存在" }, { status: 400 });
  }
  if (
    product.processingMode !== "OUTSOURCE" &&
    product.processingMode !== "OUTSOURCE_INHOUSE"
  ) {
    return NextResponse.json(
      { error: "仅「外发加工」或「外发+自加工」类商品可建立外发单" },
      { status: 400 },
    );
  }
  const outsourceBom = productBomForOutsource(
    product.processingMode,
    product.productMaterials,
  );
  if (outsourceBom.length === 0) {
    return NextResponse.json(
      { error: "该商品无外发侧 BOM，无法外发" },
      { status: 400 },
    );
  }

  const bomSet = new Set(outsourceBom.map((m) => m.materialId));
  let lineInputs: { materialId: string; quantity: number; sortOrder: number }[];

  if (parsed.data.lines?.length) {
    const seen = new Set<string>();
    lineInputs = [];
    for (let i = 0; i < parsed.data.lines.length; i++) {
      const row = parsed.data.lines[i]!;
      if (!bomSet.has(row.materialId)) {
        return NextResponse.json(
          { error: `物料不在该商品 BOM 中：${row.materialId}` },
          { status: 400 },
        );
      }
      if (seen.has(row.materialId)) {
        return NextResponse.json({ error: "物料行不能重复" }, { status: 400 });
      }
      seen.add(row.materialId);
      lineInputs.push({
        materialId: row.materialId,
        quantity: toPositiveLineQty(row.quantity),
        sortOrder: lineInputs.length,
      });
    }
    if (lineInputs.length !== outsourceBom.length) {
      return NextResponse.json(
        { error: "外发物料行须与外发侧 BOM 物料一一对应（可改数量）" },
        { status: 400 },
      );
    }
  } else {
    lineInputs = computeOutsourceLinesFromBom(
      outsourceBom.map((m) => ({
        materialId: m.materialId,
        usageQty: m.usageQty.toString(),
      })),
      productQty,
    );
  }

  const stockMap = await getMaterialInboundTotalsByIds(
    prisma,
    lineInputs.map((l) => l.materialId),
  );
  const shortageLines = lineInputs.filter(
    (l) => l.quantity > (stockMap.get(l.materialId) ?? 0),
  );
  if (shortageLines.length > 0) {
    const matMeta = await prisma.material.findMany({
      where: { id: { in: shortageLines.map((l) => l.materialId) } },
      select: { id: true, code: true, name: true },
    });
    const metaById = new Map(matMeta.map((m) => [m.id, m]));
    const parts = shortageLines.map((l) => {
      const m = metaById.get(l.materialId);
      const have = stockMap.get(l.materialId) ?? 0;
      return `${m?.code ?? l.materialId}（${m?.name ?? "—"}）需 ${l.quantity}，库存 ${have}`;
    });
    return NextResponse.json(
      {
        error: `物料库存不足，无法生成外发单：${parts.join("；")}`,
      },
      { status: 400 },
    );
  }

  const receivedAt = new Date();

  try {
    const created = await prisma.$transaction(async (tx) => {
      const orderNo = await allocateOutsourceOrderNo(tx, receivedAt, supplierId);
      const order = await tx.outsourceOrder.create({
        data: {
          orderNo,
          productId,
          supplierId,
          productQty,
          remark: remark?.trim() || null,
          status: "OPEN",
          lines: {
            create: lineInputs.map((l) => ({
              materialId: l.materialId,
              quantity: l.quantity,
              sortOrder: l.sortOrder,
            })),
          },
        },
        include: {
          supplier: {
            select: { id: true, code: true, name: true, shortName: true },
          },
          product: {
            select: {
              id: true,
              model: true,
              customerMaterialCode: true,
              unit: true,
              customer: { select: { code: true, name: true } },
            },
          },
          lines: {
            orderBy: { sortOrder: "asc" },
            include: {
              material: {
                select: { id: true, code: true, name: true, unit: true },
              },
            },
          },
        },
      });

      // 与「物料库存」一致：`MaterialInbound.quantity` 汇总；负数量表示外发出库扣减
      await tx.materialInbound.createMany({
        data: lineInputs.map((l) => ({
          materialId: l.materialId,
          quantity: -l.quantity,
          receivedAt,
          purchaseOrderNo: order.orderNo,
          partDescription: `外发出库（${order.product.model}×${productQty}）`,
          operatorUserId: auth.user.id,
        })),
      });

      return order;
    });

    return NextResponse.json({
      id: created.id,
      orderNo: created.orderNo,
      status: created.status,
      productQty: created.productQty,
      supplier: created.supplier,
      product: created.product,
      lines: created.lines.map((l) => ({
        id: l.id,
        quantity: l.quantity,
        material: l.material,
      })),
      createdAt: created.createdAt.toISOString(),
    });
  } catch (e) {
    console.error("[POST /api/outsource-orders]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "创建失败" },
      { status: 500 },
    );
  }
}
