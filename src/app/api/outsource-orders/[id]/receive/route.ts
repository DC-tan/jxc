import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { ceilOutsourceMaterialQty } from "@/lib/outsource-lines";
import { productBomForOutsource } from "@/lib/product-bom-scope";
import {
  computeOpenOrderOccupancy,
  computeOutsourceLineRemaining,
} from "@/lib/outsource-material-stock-balance";
import { reconcileOutsourceOrderLineQuantities } from "@/lib/outsource-material-stock-query";

function perSetMaterialNeedFromBom(usageQty: number): number {
  return ceilOutsourceMaterialQty(Number(usageQty) * 1);
}

/** 本批各物料回收量按「单套用量（向上取整）」折算成品套数，取各物料可支撑套数的最小值 */
function impliedProductSetsFromBatch(
  inputs: { lineId: string; receivedQty: number }[],
  lineById: Map<string, { materialId: string }>,
  usagePerSetByMaterialId: Map<string, number>,
): number {
  let min = Infinity;
  for (const row of inputs) {
    if (row.receivedQty <= 0) continue;
    const ln = lineById.get(row.lineId);
    if (!ln) continue;
    const perSet = usagePerSetByMaterialId.get(ln.materialId) ?? 0;
    if (perSet <= 0) continue;
    const s = Math.floor(row.receivedQty / perSet);
    min = Math.min(min, s);
  }
  return min === Infinity ? 0 : min;
}

function maxSetsByMaterials(
  lines: { id: string; materialId: string; quantity: number }[],
  usagePerSetByMaterialId: Map<string, number>,
): number {
  let min = Infinity;
  for (const ln of lines) {
    const perSet = usagePerSetByMaterialId.get(ln.materialId) ?? 0;
    if (perSet <= 0) continue;
    min = Math.min(min, Math.floor(ln.quantity / perSet));
  }
  return min === Infinity ? 0 : min;
}

const receiveLineSchema = z.object({
  lineId: z.string().min(1),
  receivedQty: z.number().int().min(0),
});

const receiveBodySchema = z.object({
  /** 本次回收成品套数（推荐传入；省略则按 lines 折算） */
  sets: z.number().int().min(1).optional(),
  /** 兼容旧客户端：与 sets 二选一 */
  lines: z.array(receiveLineSchema).optional(),
});

/** 确认回收：登记成品入库，并按 BOM 扣减在外物料（发料数 − 累计回收套数×单套用量） */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("outsource.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;

  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    /* 空 body：走默认足额回收 */
  }

  const parsed = receiveBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

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
      return NextResponse.json(
        { error: "仅未回收状态可确认回收" },
        { status: 400 },
      );
    }

    const lineById = new Map(order.lines.map((l) => [l.id, l]));
    const usagePerSetByMaterialId = new Map<string, number>();
    const obom = productBomForOutsource(
      order.product.processingMode,
      order.product.productMaterials ?? [],
    );
    for (const pm of obom) {
      usagePerSetByMaterialId.set(
        pm.materialId,
        perSetMaterialNeedFromBom(Number(pm.usageQty)),
      );
    }

    const sumBeforeCheck =
      order.product.processingMode === "OUTSOURCE_INHOUSE"
        ? await prisma.outsourceRecoveryInbound.aggregate({
            where: { outsourceOrderId: id },
            _sum: { quantity: true },
          })
        : await prisma.productInbound.aggregate({
            where: { purchaseOrderNo: order.orderNo },
            _sum: { quantity: true },
          });
    const sumBefore0 = Number(sumBeforeCheck._sum.quantity ?? 0);

    const warehouseRows0 = await prisma.materialInbound.groupBy({
      by: ["materialId"],
      where: { purchaseOrderNo: order.orderNo, quantity: { lt: 0 } },
      _sum: { quantity: true },
    });
    const warehouse0 = new Map<string, number>();
    for (const r of warehouseRows0) {
      warehouse0.set(r.materialId, Math.abs(Number(r._sum.quantity ?? 0)));
    }
    const closeReturnRows0 = await prisma.materialInbound.groupBy({
      by: ["materialId"],
      where: {
        purchaseOrderNo: order.orderNo,
        quantity: { gt: 0 },
        partDescription: { startsWith: "外发结单退回" },
      },
      _sum: { quantity: true },
    });
    const closeReturn0 = new Map<string, number>();
    for (const r of closeReturnRows0) {
      closeReturn0.set(r.materialId, Number(r._sum.quantity ?? 0));
    }

    const effectiveLines = order.lines.map((ln) => {
      const perSet = usagePerSetByMaterialId.get(ln.materialId) ?? 0;
      const totalRemaining = computeOutsourceLineRemaining({
        orderStatus: "OPEN",
        processingMode: order.product.processingMode,
        orderNo: order.orderNo,
        materialId: ln.materialId,
        productQty: order.productQty,
        issuedQuantity: ln.issuedQuantity,
        storedQuantity: ln.quantity,
        warehouseOutbound: warehouse0.get(ln.materialId) ?? 0,
        recoveredSets: sumBefore0,
        closeReturnQty: closeReturn0.get(ln.materialId) ?? 0,
        perSet,
      });
      const occupancy = computeOpenOrderOccupancy({
        productQty: order.productQty,
        recoveredSets: sumBefore0,
        perSet,
        totalRemaining,
      });
      return { ...ln, quantity: occupancy };
    });

    if (
      effectiveLines.every((l) => l.quantity <= 0) &&
      sumBefore0 >= order.productQty
    ) {
      return NextResponse.json({ error: "外发单无待回收物料" }, { status: 400 });
    }

    let setsRequested = parsed.data.sets;
    const linesInput = parsed.data.lines;
    if (setsRequested == null) {
      if (!linesInput || linesInput.length === 0) {
        setsRequested = maxSetsByMaterials(effectiveLines, usagePerSetByMaterialId);
      } else {
        setsRequested = impliedProductSetsFromBatch(
          linesInput,
          lineById,
          usagePerSetByMaterialId,
        );
      }
    }
    if (setsRequested <= 0) {
      return NextResponse.json(
        { error: "本次回收套数须大于 0" },
        { status: 400 },
      );
    }

    if (setsRequested > Math.max(0, order.productQty - sumBefore0)) {
      return NextResponse.json(
        { error: "数量超过外发数量" },
        { status: 400 },
      );
    }

    const maxByMaterials = maxSetsByMaterials(
      effectiveLines,
      usagePerSetByMaterialId,
    );
    if (setsRequested > maxByMaterials) {
      return NextResponse.json(
        { error: `本次回收套数不能超过待收套数（${maxByMaterials} 套）` },
        { status: 400 },
      );
    }

    const now = new Date();
    const fullyClosed = await prisma.$transaction(async (tx) => {
      const sumBefore =
        order.product.processingMode === "OUTSOURCE_INHOUSE"
          ? Number(
              (
                await tx.outsourceRecoveryInbound.aggregate({
                  where: { outsourceOrderId: id },
                  _sum: { quantity: true },
                })
              )._sum.quantity ?? 0,
            )
          : Number(
              (
                await tx.productInbound.aggregate({
                  where: { purchaseOrderNo: order.orderNo },
                  _sum: { quantity: true },
                })
              )._sum.quantity ?? 0,
            );

      const setsBatch = Math.min(
        setsRequested,
        Math.max(0, order.productQty - sumBefore),
      );
      if (setsBatch <= 0) {
        throw new Error("本次无可回收套数");
      }

      const modelRef = (order.product?.model ?? "").trim() || "—";
      if (order.product.processingMode === "OUTSOURCE_INHOUSE") {
        await tx.outsourceRecoveryInbound.create({
          data: {
            productId: order.productId,
            outsourceOrderId: id,
            outsourceOrderNo: order.orderNo,
            quantity: setsBatch,
            receivedAt: now,
            partDescription: `外发加工回收库入库（${modelRef}×${setsBatch}）`,
            entryType: "RECOVERY",
            operatorUserId: auth.user.id,
          },
        });
      } else {
        await tx.productInbound.create({
          data: {
            productId: order.productId,
            quantity: setsBatch,
            receivedAt: now,
            purchaseOrderNo: order.orderNo,
            partDescription: `外发加工回收入库（${modelRef}×${setsBatch}）`,
            operatorUserId: auth.user.id,
          },
        });
      }

      const sumAfter =
        order.product.processingMode === "OUTSOURCE_INHOUSE"
          ? Number(
              (
                await tx.outsourceRecoveryInbound.aggregate({
                  where: { outsourceOrderId: id },
                  _sum: { quantity: true },
                })
              )._sum.quantity ?? 0,
            )
          : Number(
              (
                await tx.productInbound.aggregate({
                  where: { purchaseOrderNo: order.orderNo },
                  _sum: { quantity: true },
                })
              )._sum.quantity ?? 0,
            );

      for (const ln of order.lines) {
        const perSet = usagePerSetByMaterialId.get(ln.materialId) ?? 0;
        const batchConsume =
          perSet > 0 ? perSet * setsBatch : 0;
        const newQty = Math.max(0, ln.quantity - batchConsume);
        await tx.outsourceOrderLine.update({
          where: { id: ln.id },
          data: { quantity: newQty },
        });
      }

      const remaining = await tx.outsourceOrderLine.count({
        where: { outsourceOrderId: id, quantity: { gt: 0 } },
      });

      /** 物料行全部收完，或累计回收套数已达外发套数 → 默认结单 */
      const shouldClose = remaining === 0 || sumAfter >= order.productQty;

      if (shouldClose) {
        if (remaining === 0 && order.product.processingMode !== "OUTSOURCE_INHOUSE") {
          const gap = order.productQty - sumAfter;
          if (gap > 0) {
            const model = (order.product?.model ?? "").trim() || "—";
            await tx.productInbound.create({
              data: {
                productId: order.productId,
                quantity: gap,
                receivedAt: now,
                purchaseOrderNo: order.orderNo,
                partDescription: `外发加工回收入库补差（${model}×${gap}）`,
                operatorUserId: auth.user.id,
              },
            });
          }
        }
        await tx.outsourceOrder.update({
          where: { id },
          data: {
            status: "CLOSED",
            receivedAt: now,
          },
        });
        await reconcileOutsourceOrderLineQuantities(tx, id);
        return true;
      }

      await tx.outsourceOrder.update({
        where: { id },
        data: {
          status: "OPEN",
          receivedAt: null,
        },
      });
      return false;
    });

    return NextResponse.json({ ok: true, fullyClosed });
  } catch (e) {
    console.error("[POST /api/outsource-orders/[id]/receive]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "操作失败" },
      { status: 500 },
    );
  }
}
