import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { parseProductImageUrls } from "@/lib/productImageUrls";
import type { ProductBomLineScope } from "@prisma/client";

const materialLineSchema = z.object({
  materialId: z.string().min(1),
  usageQty: z.union([z.number(), z.string()]).transform((v) => String(v)),
  /** 外发+自加工 时必填；否则省略为 DEFAULT */
  scope: z.enum(["DEFAULT", "OUTSOURCE", "INHOUSE"]).optional(),
});

const processingModeSchema = z.enum([
  "INHOUSE",
  "OUTSOURCE",
  "OUTSOURCE_INHOUSE",
]);

const createSchema = z.object({
  customerId: z.string().min(1, "请选择客户"),
  customerMaterialCode: z.string().min(1, "请填写客户物料编号"),
  processingMode: processingModeSchema.optional(),
  machineModel: z.string().optional(),
  model: z.string().optional(),
  spec: z.string().optional(),
  unit: z.string().min(1, "请选择单位"),
  price: z.union([z.number(), z.string()]).transform((v) => String(v)),
  processingCost: z.union([z.number(), z.string()]).optional(),
  safetyStock: z.union([z.number(), z.string()]).optional(),
  maxStock: z.union([z.number(), z.string()]).optional(),
  inspectionNotes: z.string().optional().nullable(),
  productRemark: z.string().optional().nullable(),
  imageUrls: z.array(z.string()).max(3).optional(),
  materials: z
    .array(materialLineSchema)
    .min(1, "请至少添加一条物料"),
});

function toDecimal(v: unknown, fallback = "0"): string {
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return fallback;
  return String(v);
}

function toOptionalPositiveIntegerString(
  v: unknown,
  fieldLabel: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === undefined || v === null || String(v).trim() === "") {
    return { ok: true, value: null };
  }
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return { ok: false, error: `${fieldLabel}必须为非负整数` };
  }
  // 业务约定：0 视为未设置，不参与库存预警
  if (n === 0) return { ok: true, value: null };
  return { ok: true, value: String(n) };
}

export async function GET(req: Request) {
  try {
    const auth = await requirePermission("product.view");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const { searchParams } = new URL(req.url);
    const createdFrom = searchParams.get("createdFrom");
    const createdTo = searchParams.get("createdTo");
    const deprecatedRaw = (searchParams.get("deprecated") ?? "0").trim();

    const where: Prisma.ProductWhereInput = {
      ...(deprecatedRaw === "1"
        ? { isDeprecated: true }
        : deprecatedRaw === "all"
          ? {}
          : { isDeprecated: false }),
    };
    if (createdFrom && createdTo) {
      const a = new Date(createdFrom);
      const b = new Date(createdTo);
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
        where.createdAt = { gte: a, lte: b };
      }
    }

    const list = await prisma.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        inbounds: { select: { quantity: true } },
      },
    });

    const rows = list.map((p) => {
      const totalQty = p.inbounds.reduce((s, i) => s + Number(i.quantity), 0);
      return {
        id: p.id,
        isDeprecated: p.isDeprecated,
        deprecatedAt: p.deprecatedAt?.toISOString() ?? null,
        deprecatedReason: p.deprecatedReason,
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
        totalQty,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({ list: rows });
  } catch (e) {
    console.error("[GET /api/products]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const auth = await requirePermission("product.create");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const d = parsed.data;
  const cust = await prisma.customer.findUnique({ where: { id: d.customerId } });
  if (!cust) {
    return NextResponse.json({ error: "客户不存在" }, { status: 400 });
  }

  const price = toDecimal(d.price, "0");
  const processingCost = toDecimal(d.processingCost, "0");
  const safetyStockParsed = toOptionalPositiveIntegerString(
    d.safetyStock,
    "安全库存",
  );
  if (!safetyStockParsed.ok) {
    return NextResponse.json({ error: safetyStockParsed.error }, { status: 400 });
  }
  const maxStockParsed = toOptionalPositiveIntegerString(d.maxStock, "最大库存");
  if (!maxStockParsed.ok) {
    return NextResponse.json({ error: maxStockParsed.error }, { status: 400 });
  }
  const safetyStock = safetyStockParsed.value;
  const maxStock = maxStockParsed.value;
  const customerMaterialCode = d.customerMaterialCode.trim();

  const mode = d.processingMode ?? "INHOUSE";
  const lineKeys = d.materials.map((m) => {
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
  if (mode === "OUTSOURCE_INHOUSE") {
    const hasO = d.materials.some(
      (m) => (m.scope ?? "DEFAULT") === "OUTSOURCE",
    );
    const hasI = d.materials.some((m) => (m.scope ?? "DEFAULT") === "INHOUSE");
    if (!hasO || !hasI) {
      return NextResponse.json(
        { error: "外发+自加工 商品需在外发物料、自加工物料中各至少维护一条" },
        { status: 400 },
      );
    }
    for (const m of d.materials) {
      if ((m.scope ?? "DEFAULT") === "DEFAULT") {
        return NextResponse.json(
          { error: "外发+自加工 时每条 BOM 须指定归属为外发或自加工" },
          { status: 400 },
        );
      }
    }
  } else {
    for (const m of d.materials) {
      if ((m.scope ?? "DEFAULT") !== "DEFAULT") {
        return NextResponse.json(
          { error: "非「外发+自加工」商品时 BOM 行不要指定外发/自加工归属" },
          { status: 400 },
        );
      }
    }
  }

  const matIds = [...new Set(d.materials.map((m) => m.materialId))];
  const mats = await prisma.material.findMany({
    where: { id: { in: matIds } },
    select: { id: true, isDeprecated: true },
  });
  if (mats.length !== matIds.length) {
    return NextResponse.json({ error: "存在无效的物料" }, { status: 400 });
  }
  if (mats.some((m) => m.isDeprecated)) {
    return NextResponse.json(
      { error: "不能向 BOM 添加已弃用的物料" },
      { status: 400 },
    );
  }

  try {
    const row = await prisma.product.create({
      data: {
        customerId: d.customerId,
        customerMaterialCode,
        processingMode: d.processingMode ?? "INHOUSE",
        machineModel: (d.machineModel ?? "").trim(),
        model: (d.model ?? "").trim(),
        spec: (d.spec ?? "").trim(),
        unit: d.unit.trim(),
        price,
        processingCost,
        safetyStock,
        maxStock,
        inspectionNotes: d.inspectionNotes?.trim() || null,
        productRemark: d.productRemark?.trim() || null,
        imageUrls: (d.imageUrls ?? []) as Prisma.InputJsonValue,
        productMaterials: {
          create: d.materials.map((m, i) => ({
            materialId: m.materialId,
            scope: (m.scope as ProductBomLineScope | undefined) ?? "DEFAULT",
            usageQty: toDecimal(m.usageQty, "1"),
            sortOrder: i,
          })),
        },
      },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        inbounds: { select: { quantity: true } },
      },
    });
    const totalQty = row.inbounds.reduce((s, i) => s + Number(i.quantity), 0);
    return NextResponse.json({
      id: row.id,
      customer: row.customer,
      customerMaterialCode: row.customerMaterialCode,
      processingMode: row.processingMode,
      machineModel: row.machineModel,
      model: row.model,
      spec: row.spec,
      unit: row.unit,
      price: row.price.toString(),
      processingCost: row.processingCost.toString(),
      safetyStock: row.safetyStock?.toString() ?? null,
      maxStock: row.maxStock?.toString() ?? null,
      inspectionNotes: row.inspectionNotes,
      productRemark: row.productRemark,
      imageUrls: parseProductImageUrls(row.imageUrls),
      totalQty,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (e) {
    console.error("[POST /api/products]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "创建失败" },
      { status: 500 },
    );
  }
}
