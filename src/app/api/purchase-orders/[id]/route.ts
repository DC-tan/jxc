import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { computePurchaseOrderDeliveryDue } from "@/lib/purchase-order-delivery";
import { PURCHASE_EXTRA_FEES_LOCKED_MSG } from "@/lib/purchase-extra-fees";

const lineSchema = z.object({
  materialId: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
  unitPrice: z.union([z.number(), z.string()]).optional(),
  remark: z.string().optional().nullable(),
});

const patchUpdateSchema = z.object({
  supplierId: z.string().min(1),
  remark: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1),
});

const patchExtraFeesOnlySchema = z.object({
  extraFees: z.array(z.unknown()),
});

const confirmReceiptLineSchema = z.object({
  lineId: z.string().min(1),
  receivedQty: z.number().int().min(0),
});

const patchConfirmSchema = z.object({
  confirmReceipt: z.literal(true),
  /** 若省略则按原逻辑整单一次收满；若提供则须覆盖全部明细行，可分批收料 */
  lines: z.array(confirmReceiptLineSchema).optional(),
});

function toDecimal(v: unknown, fallback = "0"): string {
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return String(v);
}

function toPositiveInt(v: unknown, fallback = 1): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("purchase.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;

  try {
    const row = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: {
          select: {
            id: true,
            code: true,
            name: true,
            shortName: true,
            contactPerson: true,
            phone: true,
            address: true,
            bankName: true,
            bankAccount: true,
            taxRegistrationNo: true,
            priceIncludesTax: true,
          },
        },
        salesOrder: {
          select: {
            customerOrderNo: true,
            customerModel: true,
            deliveryDueAt: true,
            customer: { select: { code: true, name: true } },
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
                unitPrice: true,
                partDescription: true,
                purchaseChannel: true,
              },
            },
          },
        },
        extraFees: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (!row) {
      return NextResponse.json({ error: "采购订单不存在" }, { status: 404 });
    }

    const receiptBatches = await prisma.materialInbound.findMany({
      where: { purchaseOrderNo: row.orderNo },
      select: {
        materialId: true,
        quantity: true,
        receivedAt: true,
      },
      orderBy: { receivedAt: "asc" },
    });

    type LineOut = {
      id: string;
      quantity: string;
      unitPrice: string;
      remark: string | null;
      material: {
        id: string;
        code: string;
        name: string;
        unit: string;
        unitPrice: string;
        partDescription: string | null;
        purchaseChannel: "STANDARD_PURCHASE" | "PROCESSING_CONTRACT";
      };
    };

    let linesPayload: LineOut[] = row.lines.map((l) => ({
      id: l.id,
      quantity: l.quantity.toString(),
      unitPrice: l.unitPrice.toString(),
      remark: l.remark,
      material: {
        ...l.material,
        unitPrice: l.material.unitPrice.toString(),
      },
    }));

    /** 分批收满后明细行已从库中删除，合同/预览需按入库流水还原数量与物料 */
    if (linesPayload.length === 0) {
      const receivedByMaterial = new Map<string, number>();
      for (const b of receiptBatches) {
        if (b.quantity <= 0) continue;
        receivedByMaterial.set(
          b.materialId,
          (receivedByMaterial.get(b.materialId) ?? 0) + b.quantity,
        );
      }
      if (receivedByMaterial.size > 0) {
        const matIds = [...receivedByMaterial.keys()];
        const mats = await prisma.material.findMany({
          where: { id: { in: matIds } },
          select: {
            id: true,
            code: true,
            name: true,
            unit: true,
            unitPrice: true,
            partDescription: true,
            purchaseChannel: true,
          },
        });
        mats.sort((a, b) => a.code.localeCompare(b.code, "zh-Hans-CN"));
        linesPayload = mats.map((m) => {
          const q = receivedByMaterial.get(m.id) ?? 0;
          return {
            id: `syn-${m.id}`,
            quantity: String(q),
            unitPrice: m.unitPrice.toString(),
            remark: null,
            material: {
              id: m.id,
              code: m.code,
              name: m.name,
              unit: m.unit,
              unitPrice: m.unitPrice.toString(),
              partDescription: m.partDescription,
              purchaseChannel: m.purchaseChannel,
            },
          };
        });
      }
    }

    return NextResponse.json({
      id: row.id,
      orderNo: row.orderNo,
      status: row.status,
      purchaseChannel: row.purchaseChannel,
      remark: row.remark,
      supplier: row.supplier,
      salesOrder: row.salesOrder
        ? {
            customerOrderNo: row.salesOrder.customerOrderNo,
            customerModel: row.salesOrder.customerModel,
            deliveryDueAt: row.salesOrder.deliveryDueAt?.toISOString() ?? null,
            customer: row.salesOrder.customer,
          }
        : null,
      deliveryDueAt: row.deliveryDueAt?.toISOString() ?? null,
      actualDeliveredAt: row.actualDeliveredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lines: linesPayload,
      receiptBatches: receiptBatches.map((b) => ({
        materialId: b.materialId,
        quantity: b.quantity,
        receivedAt: b.receivedAt.toISOString(),
      })),
      extraFees: row.extraFees.map((f) => ({
        id: f.id,
        amount: f.amount.toString(),
        purpose: f.purpose,
      })),
    });
  } catch (e) {
    console.error("[GET /api/purchase-orders/[id]]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const authView = await requirePermission("purchase.view");
  if (!authView.ok) {
    return NextResponse.json({ error: authView.message }, { status: authView.status });
  }

  const { id } = await ctx.params;
  const operatorUserId = authView.user.id;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const confirmTry = patchConfirmSchema.safeParse(json);
  if (confirmTry.success) {
    const authReceive = await requirePermission("purchase.receive");
    if (!authReceive.ok) {
      return NextResponse.json(
        { error: authReceive.message },
        { status: authReceive.status },
      );
    }
    try {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id },
        include: { lines: { orderBy: { sortOrder: "asc" } } },
      });
      if (!po) {
        return NextResponse.json({ error: "采购订单不存在" }, { status: 404 });
      }
      if (po.status !== "PENDING_RECEIPT") {
        return NextResponse.json(
          { error: "仅待收料状态的采购单可确认收料" },
          { status: 400 },
        );
      }
      if (po.lines.length === 0) {
        return NextResponse.json(
          { error: "采购单无明细，无法确认收料" },
          { status: 400 },
        );
      }
      const receivedAt = new Date();
      const bodyLines = confirmTry.data.lines;

      if (bodyLines === undefined) {
        await prisma.$transaction(async (tx) => {
          await tx.materialInbound.createMany({
            data: po.lines.map((l) => ({
              materialId: l.materialId,
              quantity: l.quantity,
              receivedAt,
              purchaseOrderNo: po.orderNo,
              partDescription: l.remark?.trim() || null,
              operatorUserId,
            })),
          });
          /** 与分批足额收完后一致：删明细仅存入库流水，预览/汇总由入库还原 */
          await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
          await tx.purchaseOrder.update({
            where: { id },
            data: {
              status: "CONFIRMED",
              actualDeliveredAt: receivedAt,
            },
          });
        });
        return NextResponse.json({ ok: true, fullyReceived: true });
      }

      const poLineIds = new Set(po.lines.map((l) => l.id));
      if (bodyLines.length !== poLineIds.size) {
        return NextResponse.json(
          { error: "lines 须包含本单全部明细行" },
          { status: 400 },
        );
      }
      const gotIds = new Set(bodyLines.map((x) => x.lineId));
      if (gotIds.size !== bodyLines.length) {
        return NextResponse.json(
          { error: "lines 中存在重复的 lineId" },
          { status: 400 },
        );
      }
      for (const lid of poLineIds) {
        if (!gotIds.has(lid)) {
          return NextResponse.json(
            { error: "lines 须包含本单全部明细行" },
            { status: 400 },
          );
        }
      }

      const lineById = new Map(po.lines.map((l) => [l.id, l]));
      let anyPositive = false;
      for (const row of bodyLines) {
        const line = lineById.get(row.lineId);
        if (!line) {
          return NextResponse.json({ error: "存在无效的明细行" }, { status: 400 });
        }
        if (row.receivedQty > line.quantity) {
          return NextResponse.json(
            { error: "本次收料数量不能超过该行待收数量" },
            { status: 400 },
          );
        }
        if (row.receivedQty > 0) anyPositive = true;
      }
      if (!anyPositive) {
        return NextResponse.json(
          { error: "至少一行本次收料数量须大于 0" },
          { status: 400 },
        );
      }

      const fullyReceived = await prisma.$transaction(async (tx) => {
        for (const row of bodyLines) {
          const line = await tx.purchaseOrderLine.findUnique({
            where: { id: row.lineId },
          });
          if (!line || line.purchaseOrderId !== id) {
            throw new Error("明细不存在或已变更");
          }
          if (row.receivedQty < 0 || row.receivedQty > line.quantity) {
            throw new Error("收料数量无效");
          }
          if (row.receivedQty > 0) {
            await tx.materialInbound.create({
              data: {
                materialId: line.materialId,
                quantity: row.receivedQty,
                receivedAt,
                purchaseOrderNo: po.orderNo,
                partDescription: line.remark?.trim() || null,
                operatorUserId,
              },
            });
          }
          if (row.receivedQty === line.quantity) {
            await tx.purchaseOrderLine.delete({ where: { id: line.id } });
          } else if (row.receivedQty > 0) {
            await tx.purchaseOrderLine.update({
              where: { id: line.id },
              data: { quantity: line.quantity - row.receivedQty },
            });
          }
        }
        const remaining = await tx.purchaseOrderLine.count({
          where: { purchaseOrderId: id },
        });
        if (remaining === 0) {
          await tx.purchaseOrder.update({
            where: { id },
            data: {
              status: "CONFIRMED",
              actualDeliveredAt: receivedAt,
            },
          });
          return true;
        }
        await tx.purchaseOrder.update({
          where: { id },
          data: {
            status: "PENDING_RECEIPT",
            actualDeliveredAt: null,
          },
        });
        return false;
      });

      return NextResponse.json({ ok: true, fullyReceived });
    } catch (e) {
      console.error("[PATCH confirm /api/purchase-orders/[id]]", e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "操作失败" },
        { status: 500 },
      );
    }
  }

  const extraOnlyTry = patchExtraFeesOnlySchema.safeParse(json);
  if (
    extraOnlyTry.success &&
    typeof json === "object" &&
    json !== null &&
    !("lines" in json) &&
    !("supplierId" in json)
  ) {
    return NextResponse.json({ error: PURCHASE_EXTRA_FEES_LOCKED_MSG }, { status: 400 });
  }

  const authEdit = await requirePermission("purchase.edit");
  if (!authEdit.ok) {
    return NextResponse.json({ error: authEdit.message }, { status: authEdit.status });
  }

  const parsed = patchUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const d = parsed.data;
  const hasExtraFeesField =
    typeof json === "object" && json !== null && "extraFees" in json;
  if (hasExtraFeesField) {
    return NextResponse.json({ error: PURCHASE_EXTRA_FEES_LOCKED_MSG }, { status: 400 });
  }

  const sup = await prisma.supplier.findUnique({
    where: { id: d.supplierId },
    select: { id: true, deliveryLeadDays: true },
  });
  if (!sup) {
    return NextResponse.json({ error: "供应商不存在" }, { status: 400 });
  }

  const matIds = d.lines.map((l) => l.materialId);
  if (new Set(matIds).size !== matIds.length) {
    return NextResponse.json({ error: "物料不能重复添加" }, { status: 400 });
  }

  const mats = await prisma.material.findMany({
    where: { id: { in: matIds } },
    select: {
      id: true,
      supplierId: true,
      isCustomerSupplied: true,
      purchaseChannel: true,
    },
  });
  if (mats.length !== matIds.length) {
    return NextResponse.json({ error: "存在无效的物料" }, { status: 400 });
  }
  if (mats.some((m) => m.isCustomerSupplied)) {
    return NextResponse.json(
      { error: "客供料不可加入采购单，请在“物料信息-客供料入口”中收料入库" },
      { status: 400 },
    );
  }
  for (const m of mats) {
    if (m.supplierId !== d.supplierId) {
      return NextResponse.json(
        { error: "存在物料与所选供应商不匹配" },
        { status: 400 },
      );
    }
  }
  const channels = new Set(mats.map((m) => m.purchaseChannel));
  if (channels.size !== 1) {
    return NextResponse.json(
      { error: "同一采购单不能混用常规采购与PCB加工合同物料" },
      { status: 400 },
    );
  }
  const purchaseChannel = Array.from(channels)[0];

  try {
    const existing = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, status: true, createdAt: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "采购订单不存在" }, { status: 404 });
    }
    if (existing.status !== "PENDING_RECEIPT" && existing.status !== "CONFIRMED") {
      return NextResponse.json(
        { error: "仅待收料或已收料状态的采购单可修改" },
        { status: 400 },
      );
    }

    const deliveryDueAt = computePurchaseOrderDeliveryDue(
      existing.createdAt,
      sup.deliveryLeadDays,
    );

    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: d.supplierId,
          purchaseChannel,
          remark: d.remark?.trim() || null,
          deliveryDueAt,
          lines: {
            create: d.lines.map((l, i) => ({
              materialId: l.materialId,
              quantity: toPositiveInt(l.quantity, 1),
              unitPrice: toDecimal(l.unitPrice ?? 0, "0"),
              remark: l.remark?.trim() || null,
              sortOrder: i,
            })),
          },
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[PATCH /api/purchase-orders/[id]]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("purchase.delete");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;

  try {
    const row = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, status: true, orderNo: true },
    });
    if (!row) {
      return NextResponse.json({ error: "采购订单不存在" }, { status: 404 });
    }
    if (row.status !== "PENDING_RECEIPT" && row.status !== "CONFIRMED") {
      return NextResponse.json(
        { error: "仅待收料或已收料状态的采购单可删除" },
        { status: 400 },
      );
    }
    await prisma.$transaction(async (tx) => {
      await tx.materialInbound.deleteMany({
        where: { purchaseOrderNo: row.orderNo },
      });
      await tx.purchaseOrder.delete({ where: { id } });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/purchase-orders/[id]]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "删除失败" },
      { status: 500 },
    );
  }
}
