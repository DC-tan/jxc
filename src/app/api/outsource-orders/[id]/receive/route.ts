import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { ceilOutsourceMaterialQty, computeOutsourceLinesFromBom } from "@/lib/outsource-lines";
import { getMaterialInboundTotalsByIds } from "@/lib/materialStock";
import {
  productBomForOutsource,
  productBomForInhouseProduction,
} from "@/lib/product-bom-scope";

type Tx = Prisma.TransactionClient;

type OrderForInhouse = {
  orderNo: string;
  product: {
    model: string | null;
    processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
    productMaterials: {
      materialId: string;
      usageQty: unknown;
      scope: import("@prisma/client").ProductBomLineScope;
    }[];
  };
};

/**
 * 外发+自加工：按成品套数在库存中扣减自加工侧物料（`MaterialInbound` 负数量，与全系统库存汇总一致）
 */
async function applyInhouseMaterialDeduction(
  tx: Tx,
  order: OrderForInhouse,
  setCount: number,
  now: Date,
  partDescription: string,
  operatorUserId: string,
): Promise<void> {
  if (setCount <= 0) return;
  if (order.product.processingMode !== "OUTSOURCE_INHOUSE") return;
  const inhouseBom = productBomForInhouseProduction(
    order.product.processingMode,
    order.product.productMaterials ?? [],
  );
  if (inhouseBom.length === 0) return;
  const deductLines = computeOutsourceLinesFromBom(
    inhouseBom.map((x) => ({
      materialId: x.materialId,
      usageQty: Number(x.usageQty),
    })),
    setCount,
  );
  const mIds = deductLines.map((d) => d.materialId);
  const stockMap = await getMaterialInboundTotalsByIds(tx, mIds);
  const shortage: string[] = [];
  for (const d of deductLines) {
    if (d.quantity <= 0) continue;
    const have = stockMap.get(d.materialId) ?? 0;
    if (d.quantity > have) {
      const mat = await tx.material.findUnique({
        where: { id: d.materialId },
        select: { code: true, name: true },
      });
      const label = mat ? `${mat.code}（${mat.name}）` : d.materialId;
      shortage.push(
        `${label}需扣 ${d.quantity}，当前库存（含本单已记账流水）${have}`,
      );
    }
  }
  if (shortage.length > 0) {
    throw new Error(
      `自加工侧物料库存不足，无法按 ${setCount} 套扣料：${shortage.join("；")}`,
    );
  }
  for (const d of deductLines) {
    if (d.quantity <= 0) continue;
    await tx.materialInbound.create({
      data: {
        materialId: d.materialId,
        quantity: -d.quantity,
        receivedAt: now,
        purchaseOrderNo: order.orderNo,
        partDescription,
        operatorUserId,
      },
    });
  }
}

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

const receiveLineSchema = z.object({
  lineId: z.string().min(1),
  receivedQty: z.number().int().min(0),
});

const receiveBodySchema = z.object({
  /** 若省略则默认每行按当前待回收数量足额回收（兼容旧客户端） */
  lines: z.array(receiveLineSchema).optional(),
});

/** 确认回收：只登记成品入库；外发物料在建单时已扣库，回收时不再回冲物料库存 */
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
    const linesPendingReceive = order.lines.filter((l) => l.quantity > 0);
    if (linesPendingReceive.length === 0) {
      return NextResponse.json({ error: "外发单无明细" }, { status: 400 });
    }

    let linesInput = parsed.data.lines;
    if (!linesInput || linesInput.length === 0) {
      linesInput = order.lines.map((l) => ({
        lineId: l.id,
        receivedQty: l.quantity,
      }));
    }

    const lineById = new Map(order.lines.map((l) => [l.id, l]));
    const idSet = new Set(order.lines.map((l) => l.id));
    const gotIds = new Set(linesInput.map((x) => x.lineId));
    if (gotIds.size !== linesInput.length) {
      return NextResponse.json(
        { error: "lines 中存在重复的 lineId" },
        { status: 400 },
      );
    }
    if (idSet.size !== gotIds.size || ![...idSet].every((lid) => gotIds.has(lid))) {
      return NextResponse.json(
        { error: "lines 须包含本单全部物料明细行" },
        { status: 400 },
      );
    }

    let anyPositive = false;
    for (const row of linesInput) {
      const line = lineById.get(row.lineId);
      if (!line) {
        return NextResponse.json({ error: "存在无效的明细行" }, { status: 400 });
      }
      if (row.receivedQty > line.quantity) {
        return NextResponse.json(
          { error: "本次回收数量不能超过该行待回收数量" },
          { status: 400 },
        );
      }
      if (row.receivedQty > 0) anyPositive = true;
    }
    if (!anyPositive) {
      return NextResponse.json(
        { error: "至少一行本次回收数量须大于 0" },
        { status: 400 },
      );
    }

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

    const sumBeforeCheck = await prisma.productInbound.aggregate({
      where: { purchaseOrderNo: order.orderNo },
      _sum: { quantity: true },
    });
    const sumBefore0 = Number(sumBeforeCheck._sum.quantity ?? 0);
    const inferred0 = impliedProductSetsFromBatch(
      linesInput,
      lineById,
      usagePerSetByMaterialId,
    );
    if (inferred0 > Math.max(0, order.productQty - sumBefore0)) {
      return NextResponse.json(
        { error: "数量超过外发数量" },
        { status: 400 },
      );
    }

    const now = new Date();
    const fullyClosed = await prisma.$transaction(async (tx) => {
      for (const row of linesInput) {
        const line = await tx.outsourceOrderLine.findUnique({
          where: { id: row.lineId },
        });
        if (!line || line.outsourceOrderId !== id) {
          throw new Error("明细不存在或已变更");
        }
        if (row.receivedQty < 0 || row.receivedQty > line.quantity) {
          throw new Error("回收数量无效");
        }
        if (row.receivedQty === line.quantity) {
          /** 保留行（数量置 0），供关闭后外发单预览/打印与回收前一致，勿删行 */
          await tx.outsourceOrderLine.update({
            where: { id: line.id },
            data: { quantity: 0 },
          });
        } else if (row.receivedQty > 0) {
          await tx.outsourceOrderLine.update({
            where: { id: line.id },
            data: { quantity: line.quantity - row.receivedQty },
          });
        }
      }

      const piSumBefore = await tx.productInbound.aggregate({
        where: { purchaseOrderNo: order.orderNo },
        _sum: { quantity: true },
      });
      const sumBefore = piSumBefore._sum.quantity ?? 0;

      const inferred = impliedProductSetsFromBatch(
        linesInput,
        lineById,
        usagePerSetByMaterialId,
      );
      const setsBatch = Math.min(
        inferred,
        Math.max(0, order.productQty - sumBefore),
      );

      const modelRef = (order.product?.model ?? "").trim() || "—";
      if (setsBatch > 0) {
        await applyInhouseMaterialDeduction(
          tx,
          order,
          setsBatch,
          now,
          `外发加工回收-自加工扣料（${modelRef}×${setsBatch}）`,
          auth.user.id,
        );
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

      const remaining = await tx.outsourceOrderLine.count({
        where: { outsourceOrderId: id, quantity: { gt: 0 } },
      });
      if (remaining === 0) {
        const piSumAfter = await tx.productInbound.aggregate({
          where: { purchaseOrderNo: order.orderNo },
          _sum: { quantity: true },
        });
        const sumAfter = piSumAfter._sum.quantity ?? 0;
        const gap = order.productQty - sumAfter;
        if (gap > 0) {
          const model = (order.product?.model ?? "").trim() || "—";
          await applyInhouseMaterialDeduction(
            tx,
            order,
            gap,
            now,
            `外发加工回收-自加工扣料-补差（${model}×${gap}）`,
            auth.user.id,
          );
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
        await tx.outsourceOrder.update({
          where: { id },
          data: {
            status: "CLOSED",
            receivedAt: now,
          },
        });
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
