import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { allocateOutsourceOrderNo } from "@/lib/outsource-order-number";
import {
  computeOutsourceLinesFromBom,
  allocateOutsourceMaterialSend,
  defaultOutsourceWarehouseSend,
} from "@/lib/outsource-lines";
import { getMaterialInboundTotalsByIds } from "@/lib/materialStock";
import { productBomForOutsource } from "@/lib/product-bom-scope";
import {
  closedPoolQtyMap,
  consumeClosedPool,
  loadClosedOutsourcePoolLines,
} from "@/lib/outsource-material-stock-pool";

const lineInSchema = z.object({
  materialId: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
});

const postSchema = z.object({
  productId: z.string().min(1),
  productQty: z.union([z.number(), z.string()]),
  supplierId: z.string().min(1, "请选择加工方"),
  remark: z.string().optional().nullable(),
  lines: z.array(lineInSchema).optional(),
});

function toPositiveInt(v: unknown, fallback = 1): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

/** 外发数量 = 本次从仓库实发数 */
function toWarehouseSendQty(v: unknown): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
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
  const supplierId = searchParams.get("supplierId")?.trim();

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
  if (supplierId) {
    where.supplierId = supplierId;
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

    const orderIds = rows.map((r) => r.id);
    const orderNos = rows
      .map((r) => r.orderNo?.trim())
      .filter((x): x is string => Boolean(x));
    const [materialReceived, productInbounded, recoveryByOrderNo, recoveryByOrderId] = await Promise.all([
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
      prisma.outsourceRecoveryInbound.groupBy({
        by: ["outsourceOrderId"],
        where: {
          outsourceOrderId: { in: orderIds },
          quantity: { gt: 0 },
        },
        _count: { _all: true },
      }),
    ]);
    const hasPositiveInboundByOrderNo = new Set<string>();
    const hasRecoveryByOrderNo = new Set<string>();
    const hasRecoveryByOrderId = new Set<string>();
    for (const g of materialReceived) {
      if (g.purchaseOrderNo) hasPositiveInboundByOrderNo.add(g.purchaseOrderNo);
    }
    for (const g of productInbounded) {
      if (g.purchaseOrderNo) hasPositiveInboundByOrderNo.add(g.purchaseOrderNo);
      if (g.purchaseOrderNo) hasRecoveryByOrderNo.add(g.purchaseOrderNo);
    }
    for (const g of recoveryByOrderNo) {
      if (g.outsourceOrderNo) hasPositiveInboundByOrderNo.add(g.outsourceOrderNo);
      if (g.outsourceOrderNo) hasRecoveryByOrderNo.add(g.outsourceOrderNo);
    }
    for (const g of recoveryByOrderId) {
      if (g.outsourceOrderId) hasRecoveryByOrderId.add(g.outsourceOrderId);
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
          r.status === "OPEN" &&
          !hasPositiveInboundByOrderNo.has(r.orderNo) &&
          !hasRecoveryByOrderId.has(r.id),
        canClose:
          r.status === "OPEN" &&
          (hasRecoveryByOrderNo.has(r.orderNo) || hasRecoveryByOrderId.has(r.id)),
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
  if (!supplierIdRaw) {
    return NextResponse.json({ error: "请选择加工方" }, { status: 400 });
  }
  const supplierId = supplierIdRaw;

  const sup = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true },
  });
  if (!sup) {
    return NextResponse.json({ error: "供应商不存在" }, { status: 400 });
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
  const bomNeedLines = computeOutsourceLinesFromBom(
    outsourceBom.map((m) => ({
      materialId: m.materialId,
      usageQty: m.usageQty.toString(),
    })),
    productQty,
  );
  const bomNeedByMaterial = new Map(
    bomNeedLines.map((l) => [l.materialId, l.quantity]),
  );
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
        quantity: toWarehouseSendQty(row.quantity),
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
    lineInputs = bomNeedLines;
  }

  const receivedAt = new Date();

  try {
    const created = await prisma.$transaction(async (tx) => {
      const materialIds = lineInputs.map((l) => l.materialId);
      const closedPoolLines = await loadClosedOutsourcePoolLines(
        tx,
        supplierId,
        materialIds,
      );
      const closedPoolMap = closedPoolQtyMap(closedPoolLines);
      if (!parsed.data.lines?.length) {
        lineInputs = lineInputs.map((l) => {
          const bomNeed = bomNeedByMaterial.get(l.materialId) ?? 0;
          return {
            ...l,
            quantity: defaultOutsourceWarehouseSend(
              bomNeed,
              closedPoolMap.get(l.materialId) ?? 0,
            ),
          };
        });
      }
      const consumeFromClosed = new Map<string, number>();
      const deductFromWarehouse = new Map<string, number>();
      const materialShortage: { materialId: string; bomNeed: number; poolUse: number; send: number }[] = [];
      for (const l of lineInputs) {
        const bomNeed = bomNeedByMaterial.get(l.materialId) ?? 0;
        const closedAvail = closedPoolMap.get(l.materialId) ?? 0;
        const { poolUse, warehouseSend, totalAtProcessor } =
          allocateOutsourceMaterialSend(l.quantity, bomNeed, closedAvail);
        if (totalAtProcessor < bomNeed) {
          materialShortage.push({
            materialId: l.materialId,
            bomNeed,
            poolUse,
            send: warehouseSend,
          });
          continue;
        }
        if (poolUse > 0) consumeFromClosed.set(l.materialId, poolUse);
        if (warehouseSend > 0) deductFromWarehouse.set(l.materialId, warehouseSend);
      }
      if (materialShortage.length > 0) {
        const matMeta = await tx.material.findMany({
          where: { id: { in: materialShortage.map((s) => s.materialId) } },
          select: { id: true, code: true, name: true },
        });
        const metaById = new Map(matMeta.map((m) => [m.id, m]));
        const parts = materialShortage.map((s) => {
          const m = metaById.get(s.materialId);
          return `${m?.code ?? s.materialId}（${m?.name ?? "—"}）本套需 ${s.bomNeed}，外发库存可扣 ${s.poolUse}，实发 ${s.send}，合计不足`;
        });
        throw new Error(`外发用料不足，无法生成外发单：${parts.join("；")}`);
      }

      const stockMap = await getMaterialInboundTotalsByIds(tx, materialIds);
      const shortageLines = lineInputs.filter((l) => {
        const need = deductFromWarehouse.get(l.materialId) ?? 0;
        return need > (stockMap.get(l.materialId) ?? 0);
      });
      if (shortageLines.length > 0) {
        const matMeta = await tx.material.findMany({
          where: { id: { in: shortageLines.map((l) => l.materialId) } },
          select: { id: true, code: true, name: true },
        });
        const metaById = new Map(matMeta.map((m) => [m.id, m]));
        const parts = shortageLines.map((l) => {
          const m = metaById.get(l.materialId);
          const need = deductFromWarehouse.get(l.materialId) ?? 0;
          const have = stockMap.get(l.materialId) ?? 0;
          return `${m?.code ?? l.materialId}（${m?.name ?? "—"}）需扣 ${need}，库存 ${have}`;
        });
        throw new Error(`物料库存不足，无法生成外发单：${parts.join("；")}`);
      }

      const orderNo = await allocateOutsourceOrderNo(tx, receivedAt, supplierId);
      /** 行数量 = 外发库存抵扣 + 仓库实发（在外总量） */
      const lineQtyAtProcessor = (materialId: string, userWarehouseQty: number) => {
        const bomNeed = bomNeedByMaterial.get(materialId) ?? 0;
        const closedAvail = closedPoolMap.get(materialId) ?? 0;
        return allocateOutsourceMaterialSend(
          userWarehouseQty,
          bomNeed,
          closedAvail,
        ).totalAtProcessor;
      };
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
              quantity: lineQtyAtProcessor(l.materialId, l.quantity),
              /** 仓库实发数（外发单预览/打印用） */
              issuedQuantity: l.quantity,
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

      await consumeClosedPool(tx, closedPoolLines, consumeFromClosed);

      // 与「物料库存」一致：`MaterialInbound.quantity` 汇总；负数量表示外发出库扣减
      const outboundRows = lineInputs
        .map((l) => ({
          materialId: l.materialId,
          quantity: -(deductFromWarehouse.get(l.materialId) ?? 0),
          receivedAt,
          purchaseOrderNo: order.orderNo,
          partDescription: `外发出库（${order.product.model}×${productQty}）`,
          operatorUserId: auth.user.id,
        }))
        .filter((x) => x.quantity < 0);
      if (outboundRows.length > 0) {
        await tx.materialInbound.createMany({ data: outboundRows });
      }

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
    const msg = e instanceof Error ? e.message : "创建失败";
    return NextResponse.json(
      { error: msg },
      { status: msg.includes("库存不足") ? 400 : 500 },
    );
  }
}
