import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { ceilOutsourceMaterialQty } from "@/lib/outsource-lines";
import { productBomForOutsource } from "@/lib/product-bom-scope";

const closeLineSchema = z.object({
  lineId: z.string().min(1),
  returnQty: z.number().int().min(0).optional(),
});

const closeBodySchema = z.object({
  lossSets: z.number().int().min(0).optional(),
  lines: z.array(closeLineSchema).optional(),
});

/** 手工结单：允许未回收外发单在回收未齐时直接结单 */
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
    /* 兼容空 body */
  }
  const parsed = closeBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const row = await prisma.outsourceOrder.findUnique({
      where: { id },
      include: {
        product: {
          select: {
            model: true,
            customerMaterialCode: true,
            processingMode: true,
            productMaterials: {
              orderBy: { sortOrder: "asc" },
              select: { materialId: true, usageQty: true, scope: true },
            },
          },
        },
        lines: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, materialId: true, quantity: true },
        },
      },
    });
    if (!row) {
      return NextResponse.json({ error: "外发单不存在" }, { status: 404 });
    }
    if (row.status !== "OPEN") {
      return NextResponse.json({ error: "仅未回收状态可结单" }, { status: 400 });
    }

    const lossSets = Math.max(0, Math.trunc(Number(parsed.data.lossSets ?? 0)));
    const linesInput = parsed.data.lines ?? [];
    const lineById = new Map(row.lines.map((l) => [l.id, l]));
    const lineInputById = new Map<string, { returnQty: number }>();
    for (const item of linesInput) {
      if (lineInputById.has(item.lineId)) {
        return NextResponse.json({ error: "lines 中存在重复的 lineId" }, { status: 400 });
      }
      if (!lineById.has(item.lineId)) {
        return NextResponse.json({ error: "存在无效的明细行" }, { status: 400 });
      }
      lineInputById.set(item.lineId, {
        returnQty: Math.max(0, Math.trunc(Number(item.returnQty ?? 0))),
      });
    }

    const outsourceBom = productBomForOutsource(
      row.product.processingMode,
      row.product.productMaterials ?? [],
    );
    const perSetByMaterial = new Map<string, number>();
    for (const b of outsourceBom) {
      perSetByMaterial.set(
        b.materialId,
        ceilOutsourceMaterialQty(Number(b.usageQty) * 1),
      );
    }

    const lossSetCaps = row.lines
      .map((l) => {
        const perSet = perSetByMaterial.get(l.materialId) ?? 0;
        if (perSet <= 0) return Number.POSITIVE_INFINITY;
        return Math.floor(l.quantity / perSet);
      })
      .filter((n) => Number.isFinite(n));
    const maxLossSets = lossSetCaps.length > 0 ? Math.min(...lossSetCaps) : 0;
    if (lossSets > maxLossSets) {
      return NextResponse.json(
        { error: `损耗套数不能超过可损耗上限（${maxLossSets} 套）` },
        { status: 400 },
      );
    }

    for (const ln of row.lines) {
      const perSet = perSetByMaterial.get(ln.materialId) ?? 0;
      const lossQty = perSet > 0 ? perSet * lossSets : 0;
      const returnQty = lineInputById.get(ln.id)?.returnQty ?? 0;
      if (lossQty + returnQty > ln.quantity) {
        return NextResponse.json(
          { error: `${ln.id} 的损耗折算数量 + 退回数量不能超过当前在外数量` },
          { status: 400 },
        );
      }
    }

    const now = new Date();
    const productLabel = row.product.model?.trim() || row.product.customerMaterialCode?.trim() || "—";
    let returnedQtyTotal = 0;
    let lossQtyTotal = 0;

    await prisma.$transaction(async (tx) => {
      for (const ln of row.lines) {
        const perSet = perSetByMaterial.get(ln.materialId) ?? 0;
        const lossQty = perSet > 0 ? perSet * lossSets : 0;
        const returnQty = lineInputById.get(ln.id)?.returnQty ?? 0;
        const remaining = ln.quantity - lossQty - returnQty;
        if (remaining !== ln.quantity) {
          await tx.outsourceOrderLine.update({
            where: { id: ln.id },
            data: { quantity: remaining },
          });
        }
        if (returnQty > 0) {
          await tx.materialInbound.create({
            data: {
              materialId: ln.materialId,
              quantity: returnQty,
              receivedAt: now,
              purchaseOrderNo: row.orderNo,
              partDescription: `外发结单退回（${productLabel}）`,
              operatorUserId: auth.user.id,
            },
          });
        }
        returnedQtyTotal += returnQty;
        lossQtyTotal += lossQty;
      }
      await tx.outsourceOrder.update({
        where: { id },
        data: {
          status: "CLOSED",
          receivedAt: now,
        },
      });
    });

    return NextResponse.json({ ok: true, lossSets, returnedQtyTotal, lossQtyTotal });
  } catch (e) {
    console.error("[POST /api/outsource-orders/[id]/close]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "操作失败" },
      { status: 500 },
    );
  }
}
