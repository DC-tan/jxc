import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  productBomForOutsource,
  productBomForInhouseProduction,
} from "@/lib/product-bom-scope";
import { computeOutsourceLinesFromBom } from "@/lib/outsource-lines";
import { getMaterialInboundTotalsByIds } from "@/lib/materialStock";

const patchLineSchema = z.object({
  lineId: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
});

const patchBodySchema = z.object({
  supplierId: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
  productQty: z.union([z.number(), z.string()]).optional(),
  lines: z.array(patchLineSchema).optional(),
});

function toPositiveInt(v: unknown, fallback: number): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

function toPositiveLineQty(v: unknown): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

/** 外发单详情（物料单预览 / 打印用） */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("outsource.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;

  try {
    const row = await prisma.outsourceOrder.findUnique({
      where: { id },
      include: {
        supplier: {
          select: { id: true, code: true, name: true, shortName: true },
        },
        product: {
          select: {
            model: true,
            customerMaterialCode: true,
            unit: true,
            processingMode: true,
            customer: { select: { code: true, name: true } },
            productMaterials: {
              orderBy: { sortOrder: "asc" },
              select: {
                materialId: true,
                usageQty: true,
                scope: true,
                material: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                    unit: true,
                    partDescription: true,
                  },
                },
              },
            },
          },
        },
        lines: {
          orderBy: { sortOrder: "asc" },
          include: {
            material: {
              select: {
                id: true,
                code: true,
                name: true,
                unit: true,
                partDescription: true,
                brand: true,
                kind: true,
                presetKind: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!row) {
      return NextResponse.json({ error: "外发单不存在" }, { status: 404 });
    }

    const materialReturnBatches = await prisma.materialInbound.findMany({
      where: {
        purchaseOrderNo: row.orderNo,
        quantity: { gt: 0 },
      },
      select: {
        materialId: true,
        quantity: true,
        receivedAt: true,
      },
      orderBy: { receivedAt: "asc" },
    });

    const materialOutboundBatches = await prisma.materialInbound.findMany({
      where: {
        purchaseOrderNo: row.orderNo,
        quantity: { lt: 0 },
        partDescription: { startsWith: "外发出库（" },
      },
      select: {
        materialId: true,
        quantity: true,
      },
    });

    /** 外发回收产生的成品入库（套数），用于「收回明细」弹层，非物料行 */
    const productRecoveryBatches = await prisma.productInbound.findMany({
      where: {
        purchaseOrderNo: row.orderNo,
        productId: row.productId,
        quantity: { gt: 0 },
      },
      select: {
        quantity: true,
        receivedAt: true,
        partDescription: true,
      },
      orderBy: { receivedAt: "asc" },
    });

    const returnedByMaterialId = new Map<string, number>();
    for (const b of materialReturnBatches) {
      returnedByMaterialId.set(
        b.materialId,
        (returnedByMaterialId.get(b.materialId) ?? 0) + b.quantity,
      );
    }
    const issuedByMaterialId = new Map<string, number>();
    for (const b of materialOutboundBatches) {
      issuedByMaterialId.set(
        b.materialId,
        (issuedByMaterialId.get(b.materialId) ?? 0) + Math.abs(b.quantity),
      );
    }

    let responseLines: {
      id: string;
      quantity: number;
      issuedQuantity: number;
      material: (typeof row.lines)[number]["material"];
    }[] = row.lines.map((l) => ({
      id: l.id,
      quantity: l.quantity,
      issuedQuantity:
        issuedByMaterialId.get(l.materialId) ??
        l.quantity + (returnedByMaterialId.get(l.materialId) ?? 0),
      material: l.material,
    }));

    /**
     * 历史数据：确认回收时曾删除明细行，关闭后详情的 lines 为空，预览/打印无表体。
     * 已回收单无行时，按商品 BOM + 本单套数还原与建单/打印一致的物料行（待回收=0，数量由回收入库批次累加在预览中还原「单上总数」）。
     */
    if (responseLines.length === 0 && row.status === "CLOSED") {
      const obom = productBomForOutsource(
        row.product.processingMode,
        row.product.productMaterials ?? [],
      );
      const fromBom = computeOutsourceLinesFromBom(
        obom.map((x) => ({
          materialId: x.materialId,
          usageQty: Number(x.usageQty),
        })),
        row.productQty,
      );
      if (fromBom.length > 0) {
        const matIds = fromBom.map((b) => b.materialId);
        const materials = await prisma.material.findMany({
          where: { id: { in: matIds } },
          select: {
            id: true,
            code: true,
            name: true,
            unit: true,
            partDescription: true,
            brand: true,
            kind: true,
            presetKind: { select: { name: true } },
          },
        });
        const byId = new Map(materials.map((m) => [m.id, m]));
        const rebuilt: typeof responseLines = [];
        for (const b of fromBom) {
          const m = byId.get(b.materialId);
          if (m) {
            rebuilt.push({
              id: `closed-bom-${b.materialId}`,
              quantity: 0,
              issuedQuantity: issuedByMaterialId.get(b.materialId) ?? b.quantity,
              material: m,
            });
          }
        }
        responseLines = rebuilt;
      }
    }

    const rawPm = row.product.productMaterials ?? [];
    const inhouseBomForPayload =
      row.product.processingMode === "OUTSOURCE_INHOUSE"
        ? productBomForInhouseProduction(
            row.product.processingMode,
            rawPm,
          ).map((pm) => ({
            materialId: pm.materialId,
            usageQty: Number(pm.usageQty),
            material: pm.material,
          }))
        : [];

    return NextResponse.json({
      id: row.id,
      orderNo: row.orderNo,
      status: row.status,
      productId: row.productId,
      productQty: row.productQty,
      remark: row.remark,
      createdAt: row.createdAt.toISOString(),
      supplier: row.supplier,
      product: {
        ...row.product,
        productMaterials: productBomForOutsource(
          row.product.processingMode,
          rawPm,
        ),
        inhouseBom: inhouseBomForPayload,
      },
      lines: responseLines,
      materialReturnBatches: materialReturnBatches.map((b) => ({
        materialId: b.materialId,
        quantity: b.quantity,
        receivedAt: b.receivedAt.toISOString(),
      })),
      productRecoveryBatches: productRecoveryBatches.map((b) => ({
        quantity: b.quantity,
        receivedAt: b.receivedAt.toISOString(),
        partDescription: b.partDescription,
      })),
    });
  } catch (e) {
    console.error("[GET /api/outsource-orders/[id]]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}

/** 取消未回收的外发单 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("outsource.delete");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;

  try {
    const row = await prisma.outsourceOrder.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json({ error: "外发单不存在" }, { status: 404 });
    }
    if (row.status !== "OPEN") {
      return NextResponse.json({ error: "仅未回收状态可取消" }, { status: 400 });
    }

    const [materialRecvCount, productRecvCount] = await Promise.all([
      prisma.materialInbound.count({
        where: { purchaseOrderNo: row.orderNo, quantity: { gt: 0 } },
      }),
      prisma.productInbound.count({
        where: { purchaseOrderNo: row.orderNo, quantity: { gt: 0 } },
      }),
    ]);
    if (materialRecvCount > 0 || productRecvCount > 0) {
      return NextResponse.json(
        { error: "该外发单已有出货/回收入库记录，不可取消" },
        { status: 400 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.materialInbound.deleteMany({
        where: { purchaseOrderNo: row.orderNo },
      });
      await tx.productInbound.deleteMany({
        where: { purchaseOrderNo: row.orderNo },
      });
      await tx.outsourceOrder.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/outsource-orders/[id]]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "操作失败" },
      { status: 500 },
    );
  }
}

/**
 * 未回收外发单：可改加工方、备注；若尚无任一回收入库流水，还可改加工套数与各物料外发数量（并重写外发出库流水）。
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("outsource.edit");
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

  const parsed = patchBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const hasQtyPatch =
    parsed.data.productQty !== undefined ||
    (parsed.data.lines !== undefined && parsed.data.lines.length > 0);

  try {
    const order = await prisma.outsourceOrder.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { sortOrder: "asc" } },
        product: {
          select: {
            model: true,
            processingMode: true,
            productMaterials: {
              orderBy: { sortOrder: "asc" },
              select: { materialId: true, usageQty: true, scope: true },
            },
          },
        },
      },
    });
    if (!order) {
      return NextResponse.json({ error: "外发单不存在" }, { status: 404 });
    }
    if (order.status !== "OPEN") {
      return NextResponse.json({ error: "仅未回收状态可编辑" }, { status: 400 });
    }

    const [materialRecvCount, productRecvCount] = await Promise.all([
      prisma.materialInbound.count({
        where: { purchaseOrderNo: order.orderNo, quantity: { gt: 0 } },
      }),
      prisma.productInbound.count({
        where: { purchaseOrderNo: order.orderNo, quantity: { gt: 0 } },
      }),
    ]);
    const locked = materialRecvCount > 0 || productRecvCount > 0;

    if (locked) {
      return NextResponse.json(
        { error: "该外发单已有确认回收记录，不可修改" },
        { status: 400 },
      );
    }

    const supplierIdIn = parsed.data.supplierId;
    const supplierId =
      supplierIdIn === undefined
        ? undefined
        : supplierIdIn && String(supplierIdIn).trim().length > 0
          ? String(supplierIdIn).trim()
          : null;
    if (supplierId) {
      const sup = await prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true },
      });
      if (!sup) {
        return NextResponse.json({ error: "供应商不存在" }, { status: 400 });
      }
    }

    const remarkIn = parsed.data.remark;
    const remark =
      remarkIn === undefined ? undefined : remarkIn?.trim() ? remarkIn.trim() : null;

    if (!hasQtyPatch) {
      if (
        supplierId === undefined &&
        remark === undefined
      ) {
        return NextResponse.json({ error: "没有要更新的内容" }, { status: 400 });
      }
      await prisma.outsourceOrder.update({
        where: { id },
        data: {
          ...(supplierId !== undefined ? { supplierId } : {}),
          ...(remark !== undefined ? { remark } : {}),
        },
      });
      return NextResponse.json({ ok: true });
    }

    const bom = productBomForOutsource(
      order.product.processingMode,
      order.product.productMaterials ?? [],
    );
    if (bom.length === 0) {
      return NextResponse.json(
        { error: "该商品无外发侧 BOM，无法调整外发数量" },
        { status: 400 },
      );
    }

    const newProductQty =
      parsed.data.productQty !== undefined
        ? toPositiveInt(parsed.data.productQty, order.productQty)
        : order.productQty;

    type FinalLine = { lineId: string; materialId: string; quantity: number };
    let finalLines: FinalLine[];

    if (parsed.data.lines !== undefined && parsed.data.lines.length > 0) {
      const lineById = new Map(order.lines.map((l) => [l.id, l]));
      const idSet = new Set(order.lines.map((l) => l.id));
      const got = new Set<string>();
      finalLines = [];
      for (const row of parsed.data.lines) {
        if (got.has(row.lineId)) {
          return NextResponse.json({ error: "lines 中存在重复的 lineId" }, { status: 400 });
        }
        got.add(row.lineId);
        const ln = lineById.get(row.lineId);
        if (!ln) {
          return NextResponse.json({ error: "存在无效的明细行" }, { status: 400 });
        }
        finalLines.push({
          lineId: ln.id,
          materialId: ln.materialId,
          quantity: toPositiveLineQty(row.quantity),
        });
      }
      if (idSet.size !== got.size || ![...idSet].every((lid) => got.has(lid))) {
        return NextResponse.json(
          { error: "lines 须包含本单全部物料明细行" },
          { status: 400 },
        );
      }
    } else {
      const computed = computeOutsourceLinesFromBom(
        bom.map((m) => ({
          materialId: m.materialId,
          usageQty: m.usageQty.toString(),
        })),
        newProductQty,
      );
      const byMaterial = new Map(order.lines.map((l) => [l.materialId, l]));
      finalLines = [];
      for (const c of computed) {
        const ln = byMaterial.get(c.materialId);
        if (!ln) {
          return NextResponse.json(
            { error: "BOM 与当前外发明细不一致，请刷新后重试" },
            { status: 400 },
          );
        }
        finalLines.push({
          lineId: ln.id,
          materialId: c.materialId,
          quantity: c.quantity,
        });
      }
    }

    const model = (order.product?.model ?? "").trim() || "—";
    const receivedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.materialInbound.deleteMany({
        where: { purchaseOrderNo: order.orderNo, quantity: { lt: 0 } },
      });

      const stockMap = await getMaterialInboundTotalsByIds(
        tx,
        finalLines.map((l) => l.materialId),
      );
      const shortage = finalLines.filter(
        (l) => l.quantity > (stockMap.get(l.materialId) ?? 0),
      );
      if (shortage.length > 0) {
        const mats = await tx.material.findMany({
          where: { id: { in: shortage.map((s) => s.materialId) } },
          select: { id: true, code: true, name: true },
        });
        const meta = new Map(mats.map((m) => [m.id, m]));
        const parts = shortage.map((s) => {
          const m = meta.get(s.materialId);
          const have = stockMap.get(s.materialId) ?? 0;
          return `${m?.code ?? s.materialId}（${m?.name ?? "—"}）需 ${s.quantity}，库存 ${have}`;
        });
        throw new Error(`物料库存不足：${parts.join("；")}`);
      }

      for (const fl of finalLines) {
        await tx.outsourceOrderLine.update({
          where: { id: fl.lineId },
          data: { quantity: fl.quantity },
        });
      }

      await tx.outsourceOrder.update({
        where: { id },
        data: {
          productQty: newProductQty,
          ...(supplierId !== undefined ? { supplierId } : {}),
          ...(remark !== undefined ? { remark } : {}),
        },
      });

      await tx.materialInbound.createMany({
        data: finalLines.map((l) => ({
          materialId: l.materialId,
          quantity: -l.quantity,
          receivedAt,
          purchaseOrderNo: order.orderNo,
          partDescription: `外发出库（${model}×${newProductQty}）`,
          operatorUserId: auth.user.id,
        })),
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[PATCH /api/outsource-orders/[id]]", e);
    const msg = e instanceof Error ? e.message : "操作失败";
    if (msg.startsWith("物料库存不足")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
