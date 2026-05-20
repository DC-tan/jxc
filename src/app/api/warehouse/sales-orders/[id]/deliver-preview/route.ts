import { NextResponse } from "next/server";
import { z } from "zod";
import { bomNeedForShort } from "@/lib/bom-need";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { getMaterialInboundTotalsByIds } from "@/lib/materialStock";
import {
  shipmentMaterialPartLabel,
  shipmentProductModelLabel,
} from "@/lib/inhouse-bom-display";
import { formatOutsourceRecoveryMaterialCode } from "@/lib/outsource-recovery-display";
import { getOutsourceRecoveryQtyByProductId } from "@/lib/outsource-recovery-stock";
import {
  defaultInhouseProduceQty,
  inhouseProduceTooLowToShipMessage,
} from "@/lib/warehouse-delivery-inhouse-step";
import { productBomForInhouseProduction } from "@/lib/product-bom-scope";

const lineShipSchema = z.object({
  lineId: z.string().min(1),
  shipQty: z.union([z.number(), z.string()]),
});

const produceByLineSchema = z
  .record(z.string(), z.union([z.number(), z.string()]))
  .optional();

const bodySchema = z.object({
  lines: z.array(lineShipSchema).min(1, "请至少选择一行出货"),
  /** 自加工 / 外发+自加工：确认出货弹窗填写的本批自加工完工数（≥ 本批出货） */
  hybridInhouseProduceByLineId: produceByLineSchema,
  inhouseProduceByLineId: produceByLineSchema,
});

function toNonNegInt(v: unknown): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function lineInhouseProduceQty(
  lineId: string,
  shipQty: number,
  maps: {
    hybridInhouseProduceByLineId?: Record<string, unknown>;
    inhouseProduceByLineId?: Record<string, unknown>;
  },
): number {
  const raw =
    maps.hybridInhouseProduceByLineId?.[lineId] ??
    maps.inhouseProduceByLineId?.[lineId];
  return raw !== undefined ? toNonNegInt(raw) : shipQty;
}

type BomRow = {
  materialId: string;
  materialCode: string;
  materialName: string;
  materialPart: string;
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
  /** 纯自加工：成品库存；外发+自加工（有超出）：商品库存；外发+自加工（无超出）：外发回收库 */
  productStock: number;
  /** 纯自加工：超出默认完工的补产数；外发+自加工：超出出货进商品库存的数量 */
  short: number;
  /** 纯自加工：max(0, 出货−库存) */
  defaultProduceQty?: number;
  inhouseProduceQty?: number;
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
                    material: {
                      select: {
                        code: true,
                        name: true,
                        partDescription: true,
                      },
                    },
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

      const isHybrid = prod.processingMode === "OUTSOURCE_INHOUSE";
      const agg = await prisma.productInbound.aggregate({
        where: { productId: ln.productId },
        _sum: { quantity: true },
      });
      const have = Number(agg._sum.quantity ?? 0);
      const recoveryHave = isHybrid
        ? await getOutsourceRecoveryQtyByProductId(prisma, ln.productId)
        : 0;
      const short = isHybrid
        ? 0
        : Math.max(0, inc.add - have);

      const productModel = shipmentProductModelLabel(prod);
      const unit = prod.unit?.trim() || "—";

      if (isHybrid) {
        const shipQty = inc.add;
        const defaultProduce = defaultInhouseProduceQty(shipQty, have);
        const produceRaw =
          parsed.data.hybridInhouseProduceByLineId?.[inc.lineId] ??
          parsed.data.inhouseProduceByLineId?.[inc.lineId];
        const inhouseProduce =
          produceRaw !== undefined
            ? toNonNegInt(produceRaw)
            : defaultProduce;
        if (inhouseProduce < defaultProduce) {
          return NextResponse.json(
            { error: inhouseProduceTooLowToShipMessage(productModel) },
            { status: 400 },
          );
        }
        const recoveryLabel = formatOutsourceRecoveryMaterialCode(
          prod.customerMaterialCode,
        );
        if (inhouseProduce > 0 && recoveryHave < inhouseProduce) {
          return NextResponse.json(
            {
              error: `「${recoveryLabel} / ${productModel}」外发回收库库存不足（当前 ${recoveryHave}，本批自加工完工 ${inhouseProduce}）。请先在「物料外发 → 外发回收库」确认回收入库。`,
            },
            { status: 400 },
          );
        }

        const boms = productBomForInhouseProduction(
          prod.processingMode,
          prod.productMaterials ?? [],
        );
        if (boms.length === 0 && defaultProduce > 0) {
          return NextResponse.json(
            {
              error: `外发+自加工商品「${productModel}」需本批自加工 ${defaultProduce} 件（出货 ${shipQty} − 商品库存 ${have}），且未维护自加工侧 BOM。请先维护 BOM。`,
            },
            { status: 400 },
          );
        }

        const matCheckQty = Math.max(inhouseProduce, defaultProduce);
        let bom: BomRow[] | null = null;
        if (boms.length > 0 && matCheckQty > 0) {
          const matIds = boms.map((b) => b.materialId);
          const stockMap = await getMaterialInboundTotalsByIds(prisma, matIds);
          const rows: BomRow[] = [];
          for (const b of boms) {
            const u = Number(b.usageQty);
            const usageQty = Number.isFinite(u) && u > 0 ? u : 0;
            const needW = bomNeedForShort(b.usageQty, matCheckQty);
            const matCode = b.material.code?.trim() || b.materialId;
            const matName = b.material.name?.trim() || "—";
            const stock = stockMap.get(b.materialId) ?? 0;
            const materialPart = shipmentMaterialPartLabel(b.material);
            rows.push({
              materialId: b.materialId,
              materialCode: matCode,
              materialName: matName,
              materialPart,
              usageQty,
              materialStock: stock,
              needWhenProduceEqualsShort: needW,
            });
            if (needW > 0 && stock < needW) {
              return NextResponse.json(
                {
                  error: `外发+自加工「${productModel}」时自加工物料「${materialPart}」库存不足（当前 ${stock}，需 ${needW}，按自加工完工 ${matCheckQty} 件测算）。`,
                },
                { status: 400 },
              );
            }
          }
          bom = rows;
        }

        const surplus = inhouseProduce - defaultProduce;
        if (surplus > 0) {
          needsInhouseStep = true;
          let bomForStep: BomRow[] | null = null;
          if (boms.length > 0 && inhouseProduce > 0) {
            const matIds = boms.map((b) => b.materialId);
            const stockMap = await getMaterialInboundTotalsByIds(prisma, matIds);
            bomForStep = [];
            for (const b of boms) {
              const u = Number(b.usageQty);
              const usageQty = Number.isFinite(u) && u > 0 ? u : 0;
              const needW = bomNeedForShort(b.usageQty, inhouseProduce);
              bomForStep.push({
                materialId: b.materialId,
                materialCode: b.material.code?.trim() || b.materialId,
                materialName: b.material.name?.trim() || "—",
                materialPart: shipmentMaterialPartLabel(b.material),
                usageQty,
                materialStock: stockMap.get(b.materialId) ?? 0,
                needWhenProduceEqualsShort: needW,
              });
            }
          }
          previewLines.push({
            lineId: inc.lineId,
            productLabel: productModel,
            unit,
            processingMode: prod.processingMode,
            shipQty,
            productStock: have,
            short: surplus,
            defaultProduceQty: defaultProduce,
            inhouseProduceQty: inhouseProduce,
            bom: bomForStep,
          });
        } else {
          previewLines.push({
            lineId: inc.lineId,
            productLabel: productModel,
            unit,
            processingMode: prod.processingMode,
            shipQty,
            productStock: have,
            short: 0,
            defaultProduceQty: defaultProduce,
            inhouseProduceQty: inhouseProduce,
            bom,
          });
        }
        continue;
      }

      if (prod.processingMode === "INHOUSE") {
        const shipQty = inc.add;
        const defaultProduce = defaultInhouseProduceQty(shipQty, have);
        const produceRaw =
          parsed.data.hybridInhouseProduceByLineId?.[inc.lineId] ??
          parsed.data.inhouseProduceByLineId?.[inc.lineId];
        const inhouseProduce =
          produceRaw !== undefined
            ? toNonNegInt(produceRaw)
            : defaultProduce;
        if (inhouseProduce < defaultProduce) {
          return NextResponse.json(
            { error: inhouseProduceTooLowToShipMessage(productModel) },
            { status: 400 },
          );
        }

        const boms = productBomForInhouseProduction(
          prod.processingMode,
          prod.productMaterials ?? [],
        );
        if (boms.length === 0 && defaultProduce > 0) {
          return NextResponse.json(
            {
              error: `自加工商品「${productModel}」需本批加工 ${defaultProduce} 件（出货 ${shipQty} − 库存 ${have}），且未维护 BOM。请维护 BOM 后再出货。`,
            },
            { status: 400 },
          );
        }

        let bom: BomRow[] | null = null;
        if (boms.length > 0 && inhouseProduce > 0) {
          const matIds = boms.map((b) => b.materialId);
          const stockMap = await getMaterialInboundTotalsByIds(prisma, matIds);
          const rows: BomRow[] = [];
          for (const b of boms) {
            const u = Number(b.usageQty);
            const usageQty = Number.isFinite(u) && u > 0 ? u : 0;
            const needW = bomNeedForShort(b.usageQty, inhouseProduce);
            const matCode = b.material.code?.trim() || b.materialId;
            const matName = b.material.name?.trim() || "—";
            const stock = stockMap.get(b.materialId) ?? 0;
            const materialPart = shipmentMaterialPartLabel(b.material);
            rows.push({
              materialId: b.materialId,
              materialCode: matCode,
              materialName: matName,
              materialPart,
              usageQty,
              materialStock: stock,
              needWhenProduceEqualsShort: needW,
            });
            if (needW > 0 && stock < needW) {
              return NextResponse.json(
                {
                  error: `自加工出货「${productModel}」时物料「${materialPart}」库存不足（当前 ${stock}，需 ${needW}，按自加工完工 ${inhouseProduce} 件测算）。`,
                },
                { status: 400 },
              );
            }
          }
          bom = rows;
        }

        const surplus = inhouseProduce - defaultProduce;
        if (surplus > 0) {
          needsInhouseStep = true;
          previewLines.push({
            lineId: inc.lineId,
            productLabel: productModel,
            unit,
            processingMode: prod.processingMode,
            shipQty,
            productStock: have,
            short: surplus,
            defaultProduceQty: defaultProduce,
            inhouseProduceQty: inhouseProduce,
            bom,
          });
        } else {
          previewLines.push({
            lineId: inc.lineId,
            productLabel: productModel,
            unit,
            processingMode: prod.processingMode,
            shipQty,
            productStock: have,
            short: 0,
            defaultProduceQty: defaultProduce,
            inhouseProduceQty: inhouseProduce,
            bom: null,
          });
        }
        continue;
      }

      if (short <= 0) {
        previewLines.push({
          lineId: inc.lineId,
          productLabel: productModel,
          unit,
          processingMode: prod.processingMode,
          shipQty: inc.add,
          productStock: have,
          short: 0,
          bom: null,
        });
        continue;
      }

      return NextResponse.json(
        {
          error: `「${productModel}」为外发加工商品，不支持出货补产。商品库存不足（当前 ${have}，本次出货 ${inc.add}）。请先办理成品入库后再出货。`,
        },
        { status: 400 },
      );
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
