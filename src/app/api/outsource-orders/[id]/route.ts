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
import {
  closedPoolQtyMap,
  consumeClosedPool,
  loadClosedOutsourcePoolLines,
  restoreClosedPool,
} from "@/lib/outsource-material-stock-pool";

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

function toNonNegativeLineQty(v: unknown): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function effectiveOutsourceDemand(userQty: number, bomNeed: number): number {
  if (userQty <= 0) return Math.max(0, bomNeed);
  return userQty;
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

    /** 外发回收批次：纯外发走成品入库；外发+自加工走外发回收库 */
    const productRecoveryBatches =
      row.product.processingMode === "OUTSOURCE_INHOUSE"
        ? await prisma.outsourceRecoveryInbound.findMany({
            where: {
              outsourceOrderId: row.id,
              quantity: { gt: 0 },
            },
            select: {
              quantity: true,
              receivedAt: true,
              partDescription: true,
            },
            orderBy: { receivedAt: "asc" },
          })
        : await prisma.productInbound.findMany({
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
      // 编辑/打印优先使用单行已保存的实发数，确保与建单确认时一致；
      // 仅历史脏数据（未迁移 issuedQuantity）再回退到流水还原值。
      issuedQuantity:
        Math.max(0, l.issuedQuantity) ||
        (issuedByMaterialId.get(l.materialId) ?? 0),
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
              issuedQuantity: issuedByMaterialId.get(b.materialId) ?? 0,
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
    const row = await prisma.outsourceOrder.findUnique({
      where: { id },
      include: {
        lines: {
          select: { id: true, materialId: true, quantity: true, issuedQuantity: true },
        },
      },
    });
    if (!row) {
      return NextResponse.json({ error: "外发单不存在" }, { status: 404 });
    }
    if (!auth.user.isAdmin && row.createdByUserId !== auth.user.id) {
      return NextResponse.json(
        { error: "仅可取消本人创建的外发单" },
        { status: 403 },
      );
    }
    if (row.status !== "OPEN") {
      return NextResponse.json({ error: "仅未回收状态可取消" }, { status: 400 });
    }

    const [materialRecvCount, productRecvCount, recoveryRecvCount] = await Promise.all([
      prisma.materialInbound.count({
        where: { purchaseOrderNo: row.orderNo, quantity: { gt: 0 } },
      }),
      prisma.productInbound.count({
        where: { purchaseOrderNo: row.orderNo, quantity: { gt: 0 } },
      }),
      prisma.outsourceRecoveryInbound.count({
        where: { outsourceOrderId: row.id, quantity: { gt: 0 } },
      }),
    ]);
    if (materialRecvCount > 0 || productRecvCount > 0 || recoveryRecvCount > 0) {
      return NextResponse.json(
        { error: "该外发单已有出货/回收入库记录，不可取消" },
        { status: 400 },
      );
    }

    await prisma.$transaction(async (tx) => {
      /**
       * 取消按原路径回退：
       * - 仓库实发部分：删除本单 materialInbound 负流水后自动回仓库库存
       * - 外发库存池抵扣部分：回冲到同加工方可复用池行
       */
      const restoreByMaterial = new Map<string, number>();
      for (const ln of row.lines) {
        const issued = Math.max(0, Math.trunc(Number(ln.issuedQuantity) || 0));
        const atProcessor = Math.max(0, Math.trunc(Number(ln.quantity) || 0));
        const fromPool = Math.max(0, atProcessor - issued);
        if (fromPool <= 0) continue;
        restoreByMaterial.set(
          ln.materialId,
          (restoreByMaterial.get(ln.materialId) ?? 0) + fromPool,
        );
      }
      if (restoreByMaterial.size > 0) {
        const poolLines = await loadClosedOutsourcePoolLines(
          tx,
          row.supplierId,
          [...restoreByMaterial.keys()],
        );
        const ownLineIds = new Set(row.lines.map((ln) => ln.id));
        const restoreTargets = poolLines.filter((ln) => !ownLineIds.has(ln.id));
        await restoreClosedPool(tx, restoreTargets, restoreByMaterial);
      }

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
 * 注意：当前该功能已关闭（直接返回错误），如需重新启用请取消下方注释并移除提前返回。
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

  // 外发单修改功能已关闭
  return NextResponse.json({ error: "外发单修改功能已关闭" }, { status: 400 });

  // 以下代码已禁用，如需重新启用请取消注释并确保类型正确
  /*
  const body = parsed.data;
  const hasQtyPatch =
    body.productQty !== undefined ||
    (body.lines !== undefined && body.lines.length > 0);

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

    const [materialRecvCount, productRecvCount, recoveryRecvCount] = await Promise.all([
      prisma.materialInbound.count({
        where: { purchaseOrderNo: order.orderNo, quantity: { gt: 0 } },
      }),
      prisma.productInbound.count({
        where: { purchaseOrderNo: order.orderNo, quantity: { gt: 0 } },
      }),
      prisma.outsourceRecoveryInbound.count({
        where: { outsourceOrderId: order.id, quantity: { gt: 0 } },
      }),
    ]);
    const locked = materialRecvCount > 0 || productRecvCount > 0 || recoveryRecvCount > 0;

    if (locked) {
      return NextResponse.json(
        { error: "该外发单已有确认回收记录，不可修改" },
        { status: 400 },
      );
    }

    const supplierIdIn = body.supplierId;
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

    const remarkIn = body.remark;
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
      body.productQty !== undefined
        ? toPositiveInt(body.productQty, order.productQty)
        : order.productQty;

    type FinalLine = { lineId: string; materialId: string; quantity: number };
    let finalLines: FinalLine[];

    if (body.lines !== undefined && body.lines.length > 0) {
      const lineById = new Map(order.lines.map((l) => [l.id, l]));
      const idSet = new Set(order.lines.map((l) => l.id));
      const got = new Set<string>();
      finalLines = [];
      for (const row of body.lines) {
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
          quantity: toNonNegativeLineQty(row.quantity),
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

    const bomNeedLines = computeOutsourceLinesFromBom(
      bom.map((m) => ({
        materialId: m.materialId,
        usageQty: m.usageQty.toString(),
      })),
      newProductQty,
    );
    const bomNeedByMaterial = new Map(
      bomNeedLines.map((l) => [l.materialId, l.quantity]),
    );

    const model = (order.product?.model ?? "").trim() || "—";
    const receivedAt = new Date();

    await prisma.$transaction(async (tx) => {
      const finalSupplierId = supplierId !== undefined ? supplierId : order.supplierId;
      const finalPoolSupplierId =
        finalSupplierId === null ? undefined : finalSupplierId;
      const materialIds = finalLines.map((l) => l.materialId);
      const newQtyByMaterial = new Map<string, number>();
      for (const l of finalLines) {
        newQtyByMaterial.set(l.materialId, l.quantity);
      }
      const currentQtyByMaterial = new Map<string, number>();
      for (const l of order.lines) {
        currentQtyByMaterial.set(
          l.materialId,
          (currentQtyByMaterial.get(l.materialId) ?? 0) + l.quantity,
        );
      }

      const currentNegativeRows = await tx.materialInbound.groupBy({
        by: ["materialId"],
        where: {
          purchaseOrderNo: order.orderNo,
          quantity: { lt: 0 },
        },
        _sum: { quantity: true },
      });
      const currentWarehouseByMaterial = new Map<string, number>();
      for (const r of currentNegativeRows) {
        currentWarehouseByMaterial.set(r.materialId, Math.abs(r._sum.quantity ?? 0));
      }

      const currentCarryByMaterial = new Map<string, number>();
      for (const materialId of new Set([...materialIds, ...currentQtyByMaterial.keys()])) {
        const curQty = currentQtyByMaterial.get(materialId) ?? 0;
        const curWh = currentWarehouseByMaterial.get(materialId) ?? 0;
        currentCarryByMaterial.set(materialId, Math.max(0, curQty - curWh));
      }

      const closedPoolLines = await loadClosedOutsourcePoolLines(
        tx,
        finalPoolSupplierId,
        materialIds,
      );
      const closedPoolMap = closedPoolQtyMap(closedPoolLines);
      const consumeFromClosed = new Map<string, number>();
      const restoreToClosed = new Map<string, number>();
      const targetWarehouseByMaterial = new Map<string, number>();
      const needExtraWarehouse = new Map<string, number>();
      const poolShortage: { materialId: string; need: number; have: number }[] = [];

      for (const materialId of materialIds) {
        const userQty = newQtyByMaterial.get(materialId) ?? 0;
        const bomNeed = bomNeedByMaterial.get(materialId) ?? 0;
        const demand = effectiveOutsourceDemand(userQty, bomNeed);
        const currentCarry = currentCarryByMaterial.get(materialId) ?? 0;
        const closedAvail = closedPoolMap.get(materialId) ?? 0;
        if (userQty <= 0 && demand > currentCarry + closedAvail) {
          poolShortage.push({
            materialId,
            need: demand,
            have: currentCarry + closedAvail,
          });
          continue;
        }
        const targetCarry = Math.min(demand, currentCarry + closedAvail);
        const consumeQty = Math.max(0, targetCarry - currentCarry);
        const restoreQty = Math.max(0, currentCarry - targetCarry);
        const targetWh = Math.max(0, demand - targetCarry);
        const currentWh = currentWarehouseByMaterial.get(materialId) ?? 0;
        const extraWh = Math.max(0, targetWh - currentWh);
        if (consumeQty > 0) consumeFromClosed.set(materialId, consumeQty);
        if (restoreQty > 0) restoreToClosed.set(materialId, restoreQty);
        targetWarehouseByMaterial.set(materialId, targetWh);
        if (extraWh > 0) needExtraWarehouse.set(materialId, extraWh);
      }

      if (poolShortage.length > 0) {
        const mats = await tx.material.findMany({
          where: { id: { in: poolShortage.map((s) => s.materialId) } },
          select: { id: true, code: true, name: true },
        });
        const meta = new Map(mats.map((m) => [m.id, m]));
        const parts = poolShortage.map((s) => {
          const m = meta.get(s.materialId);
          return `${m?.code ?? s.materialId}（${m?.name ?? "—"}）需外发库存 ${s.need}，当前 ${s.have}`;
        });
        throw new Error(`外发库存不足：${parts.join("；")}`);
      }

      const stockMap = await getMaterialInboundTotalsByIds(tx, materialIds);
      const shortage = materialIds.filter(
        (materialId) =>
          (needExtraWarehouse.get(materialId) ?? 0) > (stockMap.get(materialId) ?? 0),
      );
      if (shortage.length > 0) {
        const mats = await tx.material.findMany({
          where: { id: { in: shortage } },
          select: { id: true, code: true, name: true },
        });
        const meta = new Map(mats.map((m) => [m.id, m]));
        const parts = shortage.map((materialId) => {
          const m = meta.get(materialId);
          const need = needExtraWarehouse.get(materialId) ?? 0;
          const have = stockMap.get(materialId) ?? 0;
          return `${m?.code ?? materialId}（${m?.name ?? "—"}）需扣 ${need}，库存 ${have}`;
        });
        throw new Error(`物料库存不足：${parts.join("；")}`);
      }

      await restoreClosedPool(tx, closedPoolLines, restoreToClosed);
      await consumeClosedPool(tx, closedPoolLines, consumeFromClosed);

      for (const fl of finalLines) {
        const bomNeed = bomNeedByMaterial.get(fl.materialId) ?? 0;
        const demand = effectiveOutsourceDemand(
          fl.quantity,
          bomNeed,
        );
        const targetWh = targetWarehouseByMaterial.get(fl.materialId) ?? 0;
        await tx.outsourceOrderLine.update({
          where: { id: fl.lineId },
          data: { quantity: demand, issuedQuantity: targetWh },
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

      const adjustRows: {
        materialId: string;
        quantity: number;
        receivedAt: Date;
        purchaseOrderNo: string;
        partDescription: string;
        operatorUserId: string;
      }[] = [];
      for (const materialId of materialIds) {
        const targetWh = targetWarehouseByMaterial.get(materialId) ?? 0;
        const currentWh = currentWarehouseByMaterial.get(materialId) ?? 0;
        const delta = targetWh - currentWh;
        if (delta === 0) continue;
        adjustRows.push({
          materialId,
          quantity: delta > 0 ? -delta : Math.abs(delta),
          receivedAt,
          purchaseOrderNo: order.orderNo,
          partDescription:
            delta > 0
              ? `外发出库调整（${model}×${newProductQty}）`
              : `外发改单回库（${model}×${newProductQty}）`,
          operatorUserId: auth.user.id,
        });
      }
      if (adjustRows.length > 0) {
        await tx.materialInbound.createMany({ data: adjustRows });
      }
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
  */
}