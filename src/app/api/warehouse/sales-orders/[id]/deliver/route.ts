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
import {
  storedQuantityShipped,
} from "@/lib/sales-order-shipping";

const lineShipSchema = z.object({
  lineId: z.string().min(1),
  /** 本行总出库 = 实出(送货单表身) + 备品；与打单页 lineOutboundTotal 一致 */
  shipQty: z.union([z.number(), z.string()]),
  /** 备品件数；与库存扣减、ship log 一并存档，供出货查询还原与当时送货单一致 */
  spareQty: z.union([z.number(), z.string()]).optional(),
});

const bodySchema = z.object({
  /** 不传则默认当前时间；整单交清时写入订单 */
  actualDeliveredAt: z.string().optional(),
  /** 与送货单上 NO. 一致，写入本批每行 shipLog 供查询预览 */
  documentNo: z.string().max(64).optional().nullable(),
  lines: z.array(lineShipSchema).min(1, "请至少选择一行出货"),
  /** 自加工缺额行：本批补产/成品入库数量（≥缺口）；缺省=缺口，与「出货前补产」页一致 */
  inhouseProduceByLineId: z
    .record(z.string(), z.union([z.number(), z.string()]))
    .optional(),
  hybridInhouseProduceByLineId: z
    .record(z.string(), z.union([z.number(), z.string()]))
    .optional(),
});

function toNonNegInt(v: unknown): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function lineInhouseProduceQty(
  lineId: string,
  shipQty: number,
  hybridMap?: Record<string, unknown>,
  inhouseMap?: Record<string, unknown>,
): number {
  const raw = hybridMap?.[lineId] ?? inhouseMap?.[lineId];
  return raw !== undefined ? toNonNegInt(raw) : shipQty;
}

type InhouseBackfillLine = { materialCode: string; qty: number };
type InhouseBackfillItem = {
  productLabel: string;
  shortQty: number;
  bomLines: InhouseBackfillLine[];
};

/**
 * 仓库分批出货：按行累加 quantityShipped；全部交清时写入 actualDeliveredAt
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
    /* 空 body */
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const at = parsed.data.actualDeliveredAt
    ? new Date(parsed.data.actualDeliveredAt)
    : new Date();
  if (Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: "实际交货时间无效" }, { status: 400 });
  }

  const logDeliveryNoteNo = (() => {
    const t = parsed.data.documentNo?.trim();
    if (!t) return null;
    return t;
  })();

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
    const increments: { lineId: string; add: number; spare: number }[] = [];

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
      const spareW = toNonNegInt(row.spareQty);
      const spare = Math.min(spareW, want);
      increments.push({ lineId: row.lineId, add: want, spare });
    }

    const totalAdd = increments.reduce((s, x) => s + x.add, 0);
    if (totalAdd <= 0) {
      return NextResponse.json(
        { error: "请填写大于 0 的本次发货数量" },
        { status: 400 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const inhouseBackfills: InhouseBackfillItem[] = [];

      for (const inc of increments) {
        const ln = lineById.get(inc.lineId)!;
        const pid = (ln as { productId: string }).productId;
        const prod = ln.product as {
          model: string;
          customerMaterialCode: string;
          processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
          productMaterials: {
            materialId: string;
            scope: "DEFAULT" | "OUTSOURCE" | "INHOUSE";
            usageQty: unknown;
            material: {
              code: string;
              name: string;
              partDescription: string | null;
            };
          }[];
        };

        const productModel = shipmentProductModelLabel(prod);
        const label = productModel === "—" ? "商品" : productModel;

        if (prod.processingMode === "OUTSOURCE_INHOUSE") {
          const shipQty = inc.add;
          const agg = await tx.productInbound.aggregate({
            where: { productId: pid },
            _sum: { quantity: true },
          });
          const have = Number(agg._sum.quantity ?? 0);
          const defaultProduce = defaultInhouseProduceQty(shipQty, have);
          const produceRaw =
            parsed.data.hybridInhouseProduceByLineId?.[inc.lineId] ??
            parsed.data.inhouseProduceByLineId?.[inc.lineId];
          const inhouseProduce =
            produceRaw !== undefined
              ? toNonNegInt(produceRaw)
              : defaultProduce;
          if (inhouseProduce < defaultProduce) {
            throw new Error(
              JSON.stringify({
                kind: "PRODUCE_SHORT" as const,
                lineId: inc.lineId,
                productModel,
                needProduce: defaultProduce,
                produce: inhouseProduce,
              }),
            );
          }

          const boms = productBomForInhouseProduction(
            prod.processingMode,
            prod.productMaterials ?? [],
          );
          if (boms.length === 0 && defaultProduce > 0) {
            throw new Error(
              JSON.stringify({
                kind: "NO_BOM" as const,
                productModel,
                short: defaultProduce,
              }),
            );
          }

          const recoveryQty = await getOutsourceRecoveryQtyByProductId(tx, pid);
          if (inhouseProduce > 0 && recoveryQty < inhouseProduce) {
            throw new Error(
              JSON.stringify({
                kind: "RECOVERY_SHORT" as const,
                productModel,
                recoveryLabel: formatOutsourceRecoveryMaterialCode(
                  prod.customerMaterialCode,
                ),
                have: recoveryQty,
                need: inhouseProduce,
              }),
            );
          }

          const matQty = Math.max(inhouseProduce, defaultProduce);
          const bomLines: InhouseBackfillLine[] = [];
          if (matQty > 0 && boms.length > 0) {
            const matIds = boms.map((b) => b.materialId);
            const stockMap = await getMaterialInboundTotalsByIds(tx, matIds);
            for (const b of boms) {
              const need = bomNeedForShort(b.usageQty, matQty);
              if (need <= 0) continue;
              const stock = stockMap.get(b.materialId) ?? 0;
              const matCode = b.material.code?.trim() || b.materialId;
              if (stock < need) {
                throw new Error(
                  JSON.stringify({
                    kind: "MATERIAL_SHORT" as const,
                    productModel,
                    materialPart: shipmentMaterialPartLabel(b.material),
                    shipQty: matQty,
                    have: stock,
                    need,
                  }),
                );
              }
              bomLines.push({ materialCode: matCode, qty: need });
            }

            for (const b of boms) {
              const need = bomNeedForShort(b.usageQty, matQty);
              if (need <= 0) continue;
              await tx.materialInbound.create({
                data: {
                  materialId: b.materialId,
                  quantity: -need,
                  receivedAt: at,
                  purchaseOrderNo: order.customerOrderNo?.trim() || null,
                  partDescription: `外发+自加工扣料·自加工完工（${label}×${matQty}）`,
                  operatorUserId: auth.user.id,
                },
              });
            }
          }

          if (inhouseProduce > defaultProduce) {
            inhouseBackfills.push({
              productLabel: productModel,
              shortQty: inhouseProduce - defaultProduce,
              bomLines,
            });
          }

          if (inhouseProduce > 0) {
            await tx.outsourceRecoveryInbound.create({
              data: {
                productId: pid,
                quantity: -inhouseProduce,
                receivedAt: at,
                entryType: "SHIP_CONSUME",
                partDescription: `销售出货消耗外发回收库（${label}×${inhouseProduce}，本批自加工完工）`,
                remark: `销售单 ${order.customerOrderNo?.trim() || id}`,
                operatorUserId: auth.user.id,
              },
            });
          }

          // 商品流水：外发结转入库记本批自加工实际完工数；销售出货记本批实发数（净增 = 完工 − 出货，超出部分留商品库存）
          if (inhouseProduce > 0) {
            await tx.productInbound.create({
              data: {
                productId: pid,
                quantity: inhouseProduce,
                receivedAt: at,
                purchaseOrderNo: order.customerOrderNo?.trim() || null,
                partDescription: `外发回收库结转（${label}×${inhouseProduce}，本批自加工完工）`,
                remark: `销售单 ${order.customerOrderNo?.trim() || id}`,
                operatorUserId: auth.user.id,
              },
            });
          }

          continue;
        }

        if (prod.processingMode === "INHOUSE") {
          const shipQty = inc.add;
          const agg = await tx.productInbound.aggregate({
            where: { productId: pid },
            _sum: { quantity: true },
          });
          const have = Number(agg._sum.quantity ?? 0);
          const defaultProduce = defaultInhouseProduceQty(shipQty, have);
          const produceRaw =
            parsed.data.hybridInhouseProduceByLineId?.[inc.lineId] ??
            parsed.data.inhouseProduceByLineId?.[inc.lineId];
          const produce =
            produceRaw !== undefined
              ? toNonNegInt(produceRaw)
              : defaultProduce;
          if (produce < defaultProduce) {
            throw new Error(
              JSON.stringify({
                kind: "PRODUCE_SHORT" as const,
                lineId: inc.lineId,
                productModel,
                needProduce: defaultProduce,
                produce,
              }),
            );
          }

          const boms = productBomForInhouseProduction(
            prod.processingMode,
            prod.productMaterials ?? [],
          );
          if (boms.length === 0 && defaultProduce > 0) {
            throw new Error(
              JSON.stringify({
                kind: "NO_BOM" as const,
                productModel,
                short: defaultProduce,
              }),
            );
          }

          if (produce > 0 && boms.length > 0) {
            const matIds = boms.map((b) => b.materialId);
            const stockMap = await getMaterialInboundTotalsByIds(tx, matIds);
            const bomLines: InhouseBackfillLine[] = [];
            for (const b of boms) {
              const need = bomNeedForShort(b.usageQty, produce);
              if (need <= 0) continue;
              const stock = stockMap.get(b.materialId) ?? 0;
              const matCode = b.material.code?.trim() || b.materialId;
              if (stock < need) {
                throw new Error(
                  JSON.stringify({
                    kind: "MATERIAL_SHORT" as const,
                    productModel,
                    materialPart: shipmentMaterialPartLabel(b.material),
                    have: stock,
                    need,
                  }),
                );
              }
              bomLines.push({ materialCode: matCode, qty: need });
            }

            for (const b of boms) {
              const need = bomNeedForShort(b.usageQty, produce);
              if (need <= 0) continue;
              await tx.materialInbound.create({
                data: {
                  materialId: b.materialId,
                  quantity: -need,
                  receivedAt: at,
                  purchaseOrderNo: order.customerOrderNo?.trim() || null,
                  partDescription: `自加工扣料·出货（${label}×${produce}）`,
                  operatorUserId: auth.user.id,
                },
              });
            }

            await tx.productInbound.create({
              data: {
                productId: pid,
                quantity: produce,
                receivedAt: at,
                purchaseOrderNo: order.customerOrderNo?.trim() || null,
                partDescription:
                  produce > defaultProduce
                    ? `自加工完工入库（本批 ${produce}，默认 ${defaultProduce}，补产 ${produce - defaultProduce}）`
                    : `自加工完工入库（本批 ${produce}）`,
                remark: `销售单 ${order.customerOrderNo?.trim() || id}`,
                operatorUserId: auth.user.id,
              },
            });
            if (produce > defaultProduce) {
              inhouseBackfills.push({
                productLabel: productModel,
                shortQty: produce - defaultProduce,
                bomLines,
              });
            }
          } else if (defaultProduce > 0) {
            throw new Error(
              JSON.stringify({
                kind: "INVENTORY_SHORT" as const,
                productModel,
                have,
                need: shipQty,
                processingMode: prod.processingMode,
              }),
            );
          }

          continue;
        }

        const agg = await tx.productInbound.aggregate({
          where: { productId: pid },
          _sum: { quantity: true },
        });
        const have = Number(agg._sum.quantity ?? 0);
        const short = Math.max(0, inc.add - have);
        if (short > 0) {
          throw new Error(
            JSON.stringify({
              kind: "INVENTORY_SHORT" as const,
              productModel,
              have,
              need: inc.add,
              processingMode: prod.processingMode,
            }),
          );
        }
      }

      for (const inc of increments) {
        const ln = lineById.get(inc.lineId)!;
        const pid = (ln as { productId: string }).productId;
        const prodMode = (ln.product as { processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE" }).processingMode;
        if (prodMode === "OUTSOURCE_INHOUSE") continue;
        const aggCheck = await tx.productInbound.aggregate({
          where: { productId: pid },
          _sum: { quantity: true },
        });
        const haveNow = Number(aggCheck._sum.quantity ?? 0);
        if (haveNow < inc.add) {
          throw new Error("出货前商品库存校验失败，请重试或联系管理员");
        }
      }

      for (const inc of increments) {
        await tx.salesOrderLine.update({
          where: { id: inc.lineId },
          data: { quantityShipped: { increment: inc.add } } as object,
        });
        await (tx as unknown as { salesOrderLineShipLog: { create: (a: { data: object }) => Promise<unknown> } }).salesOrderLineShipLog.create({
          data: {
            salesOrderLineId: inc.lineId,
            quantity: inc.add,
            spareQty: inc.spare,
            batchDeliveredAt: at,
            ...(logDeliveryNoteNo != null
              ? { deliveryNoteNo: logDeliveryNoteNo }
              : {}),
          },
        });
        const ln = lineById.get(inc.lineId)!;
        const pid = (ln as { productId: string }).productId;
        const prodMode = (ln.product as { processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE" }).processingMode;
        const shipPartDescription =
          prodMode === "OUTSOURCE_INHOUSE"
            ? "销售出货（外发+自加工）"
            : "销售出货";
        await tx.productInbound.create({
          data: {
            productId: pid,
            quantity: -inc.add,
            receivedAt: at,
            purchaseOrderNo: order.customerOrderNo?.trim() || null,
            partDescription: shipPartDescription,
            remark: `送货单 · ${order.customerOrderNo?.trim() || id}`,
            operatorUserId: auth.user.id,
          },
        });
      }

      const fresh = await tx.salesOrder.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!fresh) throw new Error("订单不存在");

      const allClear = fresh.lines.every(
        (l) => storedQuantityShipped(l) >= l.quantity,
      );

      let closedAt: string | null = null;
      if (allClear) {
        const updated = await tx.salesOrder.update({
          where: { id },
          data: { actualDeliveredAt: at },
        });
        closedAt = updated.actualDeliveredAt?.toISOString() ?? at.toISOString();
      }

      return {
        fullyDelivered: allClear,
        actualDeliveredAt: closedAt,
        inhouseBackfills,
      };
    });

    return NextResponse.json({
      ok: true,
      fullyDelivered: result.fullyDelivered,
      actualDeliveredAt: result.actualDeliveredAt,
      inhouseBackfills: result.inhouseBackfills,
    });
  } catch (e) {
    console.error("[POST /api/warehouse/sales-orders/[id]/deliver]", e);
    const msg = e instanceof Error ? e.message : "";
    try {
      const parsed = JSON.parse(msg) as {
        kind?: string;
        label?: string;
        have?: number;
        need?: number;
      };
      if (parsed.kind === "INVENTORY_SHORT") {
        const p = parsed as {
          productModel?: string;
          label?: string;
          have?: number;
          need?: number;
          processingMode?: "OUTSOURCE" | "OUTSOURCE_INHOUSE";
        };
        const tail =
          p.processingMode === "OUTSOURCE_INHOUSE"
            ? "外发+自加工商品不支持出货补产，请先办理成品入库后再出货。"
            : "外发加工商品不支持出货补产，请先办理成品入库后再出货。";
        return NextResponse.json(
          {
            error: `「${p.productModel ?? p.label ?? "商品"}」商品库存不足（当前 ${p.have ?? 0}，本次出货 ${p.need ?? 0}）。${tail}`,
          },
          { status: 400 },
        );
      }
      if (parsed.kind === "NO_BOM") {
        const p = parsed as { productModel?: string; label?: string; short?: number };
        const model = p.productModel ?? p.label ?? "商品";
        const shortN = p.short ?? 0;
        if (shortN > 0 && model !== "商品") {
          return NextResponse.json(
            {
              error: `外发+自加工商品「${model}」未维护自加工侧 BOM，无法按出货扣减自加工物料。请先维护 BOM。`,
            },
            { status: 400 },
          );
        }
        return NextResponse.json(
          {
            error: `自加工商品「${model}」库存不足（缺 ${shortN}），且未维护 BOM，无法自动扣料投产。请在商品信息中维护 BOM 或先办理成品入库。`,
          },
          { status: 400 },
        );
      }
      if (parsed.kind === "MATERIAL_SHORT") {
        const p = parsed as {
          productModel?: string;
          productLabel?: string;
          materialPart?: string;
          materialCode?: string;
          shipQty?: number;
          have?: number;
          need?: number;
        };
        const model = p.productModel ?? p.productLabel ?? "商品";
        const mat =
          p.materialPart ?? p.materialCode ?? "—";
        if (p.shipQty != null && p.shipQty > 0) {
          return NextResponse.json(
            {
              error: `外发+自加工出货「${model}」时自加工物料「${mat}」库存不足（当前 ${p.have ?? 0}，需 ${p.need ?? 0}，按出货 ${p.shipQty} 件测算）。`,
            },
            { status: 400 },
          );
        }
        return NextResponse.json(
          {
            error: `自加工补产「${model}」时物料「${mat}」库存不足（当前 ${p.have ?? 0}，需 ${p.need ?? 0}）。`,
          },
          { status: 400 },
        );
      }
      if (parsed.kind === "RECOVERY_SHORT") {
        const p = parsed as {
          productModel?: string;
          recoveryLabel?: string;
          label?: string;
          have?: number;
          need?: number;
        };
        const model = p.productModel ?? p.label ?? "商品";
        const rec = p.recoveryLabel?.trim();
        const head = rec ? `「${rec} / ${model}」` : `「${model}」`;
        return NextResponse.json(
          {
            error: `${head}外发回收库库存不足（当前 ${p.have ?? 0}，本批自加工完工 ${p.need ?? 0}）。请先在“物料外发 → 外发回收库”补充库存。`,
          },
          { status: 400 },
        );
      }
      if (parsed.kind === "PRODUCE_SHORT") {
        const p = parsed as { productModel?: string; label?: string };
        return NextResponse.json(
          {
            error: inhouseProduceTooLowToShipMessage(
              p.productModel ?? p.label ?? "商品",
            ),
          },
          { status: 400 },
        );
      }
    } catch {
      /* not JSON */
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "更新失败" },
      { status: 500 },
    );
  }
}
