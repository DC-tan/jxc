import { NextResponse } from "next/server";
import { z } from "zod";
import { bomNeedForShort } from "@/lib/bom-need";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { getMaterialInboundTotalsByIds } from "@/lib/materialStock";
import {
  productAllowsShipmentInhouseBackfill,
  productBomForInhouseProduction,
} from "@/lib/product-bom-scope";

const lineShipSchema = z.object({
  lineId: z.string().min(1),
  shipQty: z.union([z.number(), z.string()]),
});

const bodySchema = z.object({
  lines: z.array(lineShipSchema).min(1, "请至少选择一行出货"),
});

function toNonNegInt(v: unknown): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

type BomRow = {
  materialId: string;
  materialCode: string;
  materialName: string;
  usageQty: number;
  materialStock: number;
  needWhenProduceEqualsShort: number;
};

type PreviewLine = {
  lineId: string;
  productLabel: string;
  unit: string;
  processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
  shipQty: number;
  productStock: number;
  short: number;
  bom: BomRow[] | null;
};

/**
 * 出货前检查：本批自加工是否需先经「补产入库存」页；不可出货时直接返回 400
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("warehouse.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;

  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    /* empty */
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: {
        lines: {
          orderBy: { sortOrder: "asc" },
          include: {
            product: {
              select: {
                model: true,
                customerMaterialCode: true,
                spec: true,
                unit: true,
                processingMode: true,
                productMaterials: {
                  orderBy: { sortOrder: "asc" },
                  select: {
                    materialId: true,
                    scope: true,
                    usageQty: true,
                    material: { select: { code: true, name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!order) {
      return NextResponse.json({ error: "销售订单不存在" }, { status: 404 });
    }
    if (order.actualDeliveredAt) {
      return NextResponse.json({ error: "该订单已全部交清" }, { status: 400 });
    }

    const lineById = new Map(order.lines.map((l) => [l.id, l]));
    const gotIds = new Set<string>();
    const increments: { lineId: string; add: number }[] = [];

    for (const row of parsed.data.lines) {
      if (gotIds.has(row.lineId)) {
        return NextResponse.json(
          { error: "lines 中存在重复的 lineId" },
          { status: 400 },
        );
      }
      gotIds.add(row.lineId);
      const ln = lineById.get(row.lineId);
      if (!ln) {
        return NextResponse.json({ error: "存在无效的明细行" }, { status: 400 });
      }
      const want = toNonNegInt(row.shipQty);
      if (want === 0) continue;
      increments.push({ lineId: row.lineId, add: want });
    }

    const totalAdd = increments.reduce((s, x) => s + x.add, 0);
    if (totalAdd <= 0) {
      return NextResponse.json(
        { error: "请填写大于 0 的本次发货数量" },
        { status: 400 },
      );
    }

    const previewLines: PreviewLine[] = [];
    let needsInhouseStep = false;

    for (const inc of increments) {
      const ln = lineById.get(inc.lineId)!;
      const prod = ln.product as {
        model: string;
        customerMaterialCode: string;
        spec: string;
        unit: string;
        processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
        productMaterials: {
          materialId: string;
          scope: "DEFAULT" | "OUTSOURCE" | "INHOUSE";
          usageQty: unknown;
          material: { code: string; name: string };
        }[];
      };

      const agg = await prisma.productInbound.aggregate({
        where: { productId: ln.productId },
        _sum: { quantity: true },
      });
      const have = Number(agg._sum.quantity ?? 0);
      const short = Math.max(0, inc.add - have);

      const productLabel =
        prod.model?.trim() || prod.customerMaterialCode?.trim() || "—";
      const unit = prod.unit?.trim() || "—";

      if (short <= 0) {
        previewLines.push({
          lineId: inc.lineId,
          productLabel,
          unit,
          processingMode: prod.processingMode,
          shipQty: inc.add,
          productStock: have,
          short: 0,
          bom: null,
        });
        continue;
      }

      if (!productAllowsShipmentInhouseBackfill(prod.processingMode)) {
        const detail =
          prod.processingMode === "OUTSOURCE"
            ? "为外发加工商品，不支持出货补产。"
            : "为外发+自加工商品，不支持出货补产。";
        return NextResponse.json(
          {
            error: `「${productLabel}」${detail}商品库存不足（当前 ${have}，本次出货 ${inc.add}）。请先办理成品入库后再出货。`,
          },
          { status: 400 },
        );
      }

      const boms = productBomForInhouseProduction(
        prod.processingMode,
        prod.productMaterials ?? [],
      );
      if (boms.length === 0) {
        return NextResponse.json(
          {
            error: `自加工商品「${productLabel}」库存不足（缺 ${short}），且未维护对应 BOM。请在商品信息中维护自加工侧 BOM 或先办理成品入库。`,
          },
          { status: 400 },
        );
      }

      const matIds = boms.map((b) => b.materialId);
      const stockMap = await getMaterialInboundTotalsByIds(prisma, matIds);

      const bom: BomRow[] = [];
      for (const b of boms) {
        const u = Number(b.usageQty);
        const usageQty = Number.isFinite(u) && u > 0 ? u : 0;
        const needW = bomNeedForShort(b.usageQty, short);
        const matCode = b.material.code?.trim() || b.materialId;
        const matName = b.material.name?.trim() || "—";
        const stock = stockMap.get(b.materialId) ?? 0;
        bom.push({
          materialId: b.materialId,
          materialCode: matCode,
          materialName: matName,
          usageQty,
          materialStock: stock,
          needWhenProduceEqualsShort: needW,
        });
        if (needW > 0 && stock < needW) {
          return NextResponse.json(
            {
              error: `自加工补产「${productLabel}」时物料「${matCode}」库存不足（当前 ${stock}，需 ${needW}，按缺口 ${short} 件投产测算）。请补料或调低本次发货数量。`,
            },
            { status: 400 },
          );
        }
      }

      needsInhouseStep = true;
      previewLines.push({
        lineId: inc.lineId,
        productLabel,
        unit,
        processingMode: prod.processingMode,
        shipQty: inc.add,
        productStock: have,
        short,
        bom,
      });
    }

    return NextResponse.json({ needsInhouseStep, lines: previewLines });
  } catch (e) {
    console.error("[POST /api/warehouse/sales-orders/[id]/deliver-preview]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "预检失败" },
      { status: 500 },
    );
  }
}
