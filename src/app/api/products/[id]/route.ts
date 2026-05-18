import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { parseProductImageUrls } from "@/lib/productImageUrls";
import { MATERIAL_KIND_LABEL } from "@/lib/materialLabels";
import type { ProductBomLineScope } from "@prisma/client";

const materialLineSchema = z.object({
  materialId: z.string().min(1),
  usageQty: z.union([z.number(), z.string()]).transform((v) => String(v)),
  scope: z.enum(["DEFAULT", "OUTSOURCE", "INHOUSE"]).optional(),
});

const patchSchema = z.object({
  customerId: z.string().min(1).optional(),
  customerMaterialCode: z.string().min(1).optional(),
  processingMode: z
    .enum(["INHOUSE", "OUTSOURCE", "OUTSOURCE_INHOUSE"])
    .optional(),
  machineModel: z.string().optional(),
  model: z.string().optional(),
  spec: z.string().optional(),
  unit: z.string().min(1).optional(),
  price: z.union([z.number(), z.string()]).optional(),
  processingCost: z.union([z.number(), z.string()]).optional(),
  safetyStock: z.union([z.number(), z.string()]).optional(),
  maxStock: z.union([z.number(), z.string()]).optional(),
  inspectionNotes: z.string().optional().nullable(),
  productRemark: z.string().optional().nullable(),
  imageUrls: z.array(z.string()).max(5).optional(),
  materials: z.array(materialLineSchema).optional(),
});

function toDecimal(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) return undefined;
  return String(v);
}

function toOptionalPositiveIntegerString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return undefined;
  if (n === 0) return null;
  return String(n);
}

function parseSampleUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string").slice(0, 3);
}

function kindNameForMaterial(m: {
  kind: import("@prisma/client").MaterialKind | null;
  presetKind: { name: string } | null;
}): string {
  if (m.presetKind) return m.presetKind.name;
  if (m.kind) return MATERIAL_KIND_LABEL[m.kind];
  return "—";
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePermission("product.view");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const { id } = await ctx.params;
    const p = await prisma.product.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        inbounds: {
          orderBy: { receivedAt: "desc" },
          include: {
            operator: {
              select: {
                id: true,
                name: true,
                loginName: true,
                employeeNo: true,
              },
            },
          },
        },
        productMaterials: {
          orderBy: { sortOrder: "asc" },
          include: {
            material: {
              include: {
                supplier: { select: { id: true, code: true, name: true } },
                presetKind: { select: { id: true, name: true, prefix: true } },
                inbounds: { select: { quantity: true } },
              },
            },
          },
        },
      },
    });

    if (!p) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }

    const totalQty = p.inbounds.reduce((s, i) => s + Number(i.quantity), 0);
    const lastPositive = p.inbounds.find((i) => Number(i.quantity) > 0);
    const lastReceivedAt = lastPositive?.receivedAt ?? null;

    return NextResponse.json({
      id: p.id,
      isDeprecated: p.isDeprecated,
      deprecatedAt: p.deprecatedAt?.toISOString() ?? null,
      deprecatedReason: p.deprecatedReason,
      customerId: p.customerId,
      customer: p.customer,
      customerMaterialCode: p.customerMaterialCode,
      processingMode: p.processingMode,
      machineModel: p.machineModel,
      model: p.model,
      spec: p.spec,
      unit: p.unit,
      price: p.price.toString(),
      processingCost: p.processingCost.toString(),
      safetyStock: p.safetyStock?.toString() ?? null,
      maxStock: p.maxStock?.toString() ?? null,
      inspectionNotes: p.inspectionNotes,
      productRemark: p.productRemark,
      imageUrls: parseProductImageUrls(p.imageUrls),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      totalQty,
      lastReceivedAt: lastReceivedAt?.toISOString() ?? null,
      inbounds: p.inbounds.map((i) => ({
        id: i.id,
        quantity: i.quantity.toString(),
        entryType: i.entryType,
        receivedAt: i.receivedAt.toISOString(),
        purchaseOrderNo: i.purchaseOrderNo,
        partDescription: i.partDescription,
        remark: i.remark,
        operatorName: i.operator?.name ?? null,
        operatorEmployeeNo: i.operator?.employeeNo ?? null,
      })),
      productMaterials: p.productMaterials.map((pm) => {
        const m = pm.material;
        const totalQty = m.inbounds.reduce((s, i) => s + Number(i.quantity), 0);
        return {
          id: pm.id,
          scope: pm.scope,
          usageQty: pm.usageQty.toString(),
          material: {
            id: m.id,
            code: m.code,
            name: m.name,
            partDescription: m.partDescription,
            brand: m.brand,
            unit: m.unit,
            unitPrice: m.unitPrice.toString(),
            kindName: kindNameForMaterial(m),
            supplier: m.supplier,
            inspectionNotes: m.inspectionNotes,
            sampleImageUrls: parseSampleUrls(m.sampleImageUrls),
            totalQty,
            createdAt: m.createdAt.toISOString(),
            updatedAt: m.updatedAt.toISOString(),
          },
        };
      }),
    });
  } catch (e) {
    console.error("[GET /api/products/[id]]", e);
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
  const auth = await requirePermission("product.edit");
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

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const exists = await prisma.product.findUnique({ where: { id } });
  if (!exists) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  }

  const data = parsed.data;
  if (data.customerId) {
    const c = await prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!c) return NextResponse.json({ error: "客户不存在" }, { status: 400 });
  }

  const update: Prisma.ProductUpdateInput = {};
  if (data.customerId !== undefined) {
    update.customer = { connect: { id: data.customerId } };
  }
  if (data.customerMaterialCode !== undefined) {
    update.customerMaterialCode = data.customerMaterialCode.trim();
  }
  if (data.processingMode !== undefined) {
    update.processingMode = data.processingMode;
  }
  if (data.machineModel !== undefined) {
    update.machineModel = data.machineModel.trim();
  }
  if (data.model !== undefined) update.model = data.model.trim();
  if (data.spec !== undefined) update.spec = data.spec.trim();
  if (data.unit !== undefined) update.unit = data.unit.trim();
  if (data.price !== undefined) {
    const p = toDecimal(data.price);
    if (p !== undefined) update.price = p;
  }
  if (data.processingCost !== undefined) {
    const p = toDecimal(data.processingCost);
    if (p !== undefined) update.processingCost = p;
  }
  if (data.safetyStock !== undefined) {
    const p = toOptionalPositiveIntegerString(data.safetyStock);
    if (p === undefined) {
      return NextResponse.json(
        { error: "安全库存必须为非负整数" },
        { status: 400 },
      );
    }
    update.safetyStock = p;
  }
  if (data.maxStock !== undefined) {
    const p = toOptionalPositiveIntegerString(data.maxStock);
    if (p === undefined) {
      return NextResponse.json(
        { error: "最大库存必须为非负整数" },
        { status: 400 },
      );
    }
    update.maxStock = p;
  }
  if (data.inspectionNotes !== undefined) {
    update.inspectionNotes = data.inspectionNotes?.trim() || null;
  }
  if (data.productRemark !== undefined) {
    update.productRemark = data.productRemark?.trim() || null;
  }
  if (data.imageUrls !== undefined) {
    update.imageUrls = data.imageUrls as Prisma.InputJsonValue;
  }

  if (data.materials !== undefined) {
    const nextMode = data.processingMode ?? exists.processingMode;
    const lineKeys = data.materials.map((m) => {
      const sc: ProductBomLineScope =
        (m.scope as ProductBomLineScope | undefined) ?? "DEFAULT";
      return `${m.materialId}\t${sc}`;
    });
    if (new Set(lineKeys).size !== lineKeys.length) {
      return NextResponse.json(
        { error: "物料不能重复添加（同物料、同归属下不可重复）" },
        { status: 400 },
      );
    }
    if (nextMode === "OUTSOURCE_INHOUSE") {
      const hasO = data.materials.some(
        (m) => (m.scope ?? "DEFAULT") === "OUTSOURCE",
      );
      const hasI = data.materials.some(
        (m) => (m.scope ?? "DEFAULT") === "INHOUSE",
      );
      if (data.materials.length > 0 && (!hasO || !hasI)) {
        return NextResponse.json(
          { error: "外发+自加工 商品需在外发物料、自加工物料中各至少维护一条" },
          { status: 400 },
        );
      }
      for (const m of data.materials) {
        if ((m.scope ?? "DEFAULT") === "DEFAULT" && m.materialId) {
          return NextResponse.json(
            { error: "外发+自加工 时每条 BOM 须指定归属为外发或自加工" },
            { status: 400 },
          );
        }
      }
    } else {
      for (const m of data.materials) {
        if ((m.scope ?? "DEFAULT") !== "DEFAULT") {
          return NextResponse.json(
            { error: "非「外发+自加工」商品时 BOM 行不要指定外发/自加工归属" },
            { status: 400 },
          );
        }
      }
    }
    const matIds = [...new Set(data.materials.map((m) => m.materialId))];
    const mats = await prisma.material.findMany({
      where: { id: { in: matIds } },
      select: { id: true },
    });
    if (mats.length !== matIds.length) {
      return NextResponse.json({ error: "存在无效的物料" }, { status: 400 });
    }
  }

  const hasMaterialPatch = data.materials !== undefined;
  const hasProductPatch = Object.keys(update).length > 0;

  if (hasMaterialPatch || hasProductPatch) {
    await prisma.$transaction(async (tx) => {
      if (hasMaterialPatch) {
        await tx.productMaterial.deleteMany({ where: { productId: id } });
        if (data.materials!.length > 0) {
          await tx.productMaterial.createMany({
            data: data.materials!.map((m, i) => ({
              productId: id,
              materialId: m.materialId,
              scope: (m.scope as ProductBomLineScope | undefined) ?? "DEFAULT",
              usageQty: toDecimal(m.usageQty) ?? "1",
              sortOrder: i,
            })),
          });
        }
      }
      if (hasProductPatch) {
        await tx.product.update({
          where: { id },
          data: update,
        });
      }
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("product.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;
  try {
    await prisma.product.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return NextResponse.json(
        { error: "该商品已被业务单据引用，不能直接删除，请改为弃用商品" },
        { status: 400 },
      );
    }
    console.error("[DELETE /api/products/[id]]", e);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
