import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { MATERIAL_KIND_LABEL } from "@/lib/materialLabels";
import { ensureCustomerSupplySupplier } from "@/lib/customer-supply";

function parseSampleUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string").slice(0, 3);
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  partDescription: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  unit: z.string().min(1).optional(),
  unitPrice: z.union([z.number(), z.string()]).transform((v) => String(v)).optional(),
  safetyStock: z.union([z.number(), z.string()]).optional(),
  maxStock: z.union([z.number(), z.string()]).optional(),
  kindId: z.string().min(1).optional(),
  supplierId: z.string().optional(),
  isCustomerSupplied: z.boolean().optional(),
  customerId: z.string().optional().nullable(),
  inspectionNotes: z.string().optional().nullable(),
  sampleImageUrls: z.array(z.string()).max(3).optional(),
});

function toOptionalPositiveInteger(
  v: unknown,
  fieldLabel: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (v === undefined || v === null || String(v).trim() === "") {
    return { ok: true, value: null };
  }
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return { ok: false, error: `${fieldLabel}必须为非负整数` };
  }
  if (n === 0) return { ok: true, value: null };
  return { ok: true, value: n };
}

function kindDisplay(m: {
  kind: import("@prisma/client").MaterialKind | null;
  presetKind: { id: string; name: string; prefix: string } | null;
}): { kindId: string | null; kindName: string; presetKind: typeof m.presetKind } {
  if (m.presetKind) {
    return {
      kindId: m.presetKind.id,
      kindName: m.presetKind.name,
      presetKind: m.presetKind,
    };
  }
  return {
    kindId: null,
    kindName: m.kind ? MATERIAL_KIND_LABEL[m.kind] : "—",
    presetKind: null,
  };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePermission("material.view");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const { id } = await ctx.params;
    const m = await prisma.material.findUnique({
      where: { id },
      include: {
        supplier: true,
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
        presetKind: { select: { id: true, name: true, prefix: true } },
      },
    });

    if (!m) {
      return NextResponse.json({ error: "物料不存在" }, { status: 404 });
    }

    const totalQty = m.inbounds.reduce((s, i) => s + Number(i.quantity), 0);
    const kd = kindDisplay(m);

    return NextResponse.json({
      id: m.id,
      code: m.code,
      name: m.name,
      isDeprecated: m.isDeprecated,
      deprecatedAt: m.deprecatedAt?.toISOString() ?? null,
      deprecatedReason: m.deprecatedReason,
      partDescription: m.partDescription,
      brand: m.brand,
      unit: m.unit,
      unitPrice: m.unitPrice.toString(),
      safetyStock: m.safetyStock,
      maxStock: m.maxStock,
      kindId: m.kindId ?? kd.kindId,
      kindName: kd.kindName,
      kind: m.kind,
      presetKind: m.presetKind,
      isCustomerSupplied: m.isCustomerSupplied,
      customer: m.customer,
      supplier: m.supplier,
      inspectionNotes: m.inspectionNotes,
      sampleImageUrls: parseSampleUrls(m.sampleImageUrls),
      totalQty,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      inbounds: m.inbounds.map((i) => ({
        id: i.id,
        quantity: i.quantity.toString(),
        entryType: i.entryType,
        receivedAt: i.receivedAt.toISOString(),
        purchaseOrderNo: i.purchaseOrderNo,
        partDescription: i.partDescription,
        operatorName: i.operator?.name ?? null,
        operatorEmployeeNo: i.operator?.employeeNo ?? null,
      })),
    });
  } catch (e) {
    console.error("[GET /api/materials/[id]]", e);
    const msg = e instanceof Error ? e.message : "加载物料失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("material.edit");
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

  const exists = await prisma.material.findUnique({
    where: { id },
    include: { presetKind: { select: { namingMode: true } } },
  });
  if (!exists) {
    return NextResponse.json({ error: "物料不存在" }, { status: 404 });
  }

  if (parsed.data.supplierId) {
    const sup = await prisma.supplier.findUnique({
      where: { id: parsed.data.supplierId },
    });
    if (!sup) {
      return NextResponse.json({ error: "供应商不存在" }, { status: 400 });
    }
  }

  let nextKindNamingMode = exists.presetKind?.namingMode ?? null;
  if (parsed.data.kindId) {
    const k = await prisma.materialPresetKind.findUnique({
      where: { id: parsed.data.kindId },
    });
    if (!k) {
      return NextResponse.json({ error: "物料种类不存在" }, { status: 400 });
    }
    nextKindNamingMode = k.namingMode;
  }
  const data = parsed.data;
  const safetyStockParsed =
    data.safetyStock !== undefined
      ? toOptionalPositiveInteger(data.safetyStock, "安全库存")
      : null;
  if (safetyStockParsed && !safetyStockParsed.ok) {
    return NextResponse.json({ error: safetyStockParsed.error }, { status: 400 });
  }
  const maxStockParsed =
    data.maxStock !== undefined
      ? toOptionalPositiveInteger(data.maxStock, "最大库存")
      : null;
  if (maxStockParsed && !maxStockParsed.ok) {
    return NextResponse.json({ error: maxStockParsed.error }, { status: 400 });
  }
  const nextIsCustomerSupplied = data.isCustomerSupplied ?? exists.isCustomerSupplied;
  const nextCustomerId =
    data.customerId !== undefined
      ? data.customerId?.trim() || null
      : exists.customerId;
  if (nextIsCustomerSupplied && !nextCustomerId) {
    return NextResponse.json({ error: "客供料必须选择客供客户" }, { status: 400 });
  }
  if (nextCustomerId) {
    const customer = await prisma.customer.findUnique({ where: { id: nextCustomerId } });
    if (!customer) {
      return NextResponse.json({ error: "客供客户不存在" }, { status: 400 });
    }
  }
  const materialCustomerId = nextIsCustomerSupplied
    ? nextCustomerId
    : nextKindNamingMode === "CUSTOM"
      ? nextCustomerId
      : null;

  if (!nextIsCustomerSupplied && data.supplierId !== undefined) {
    const supplierId = data.supplierId.trim();
    if (!supplierId) {
      return NextResponse.json({ error: "请选择供应商" }, { status: 400 });
    }
  }
  if (!nextIsCustomerSupplied && exists.isCustomerSupplied && data.supplierId === undefined) {
    return NextResponse.json(
      { error: "取消客供料时，请重新选择供应商" },
      { status: 400 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.material.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.partDescription !== undefined
          ? { partDescription: data.partDescription?.trim() || null }
          : {}),
        ...(data.brand !== undefined
          ? { brand: data.brand?.trim() || null }
          : {}),
        ...(data.unit !== undefined ? { unit: data.unit.trim() } : {}),
        ...(nextIsCustomerSupplied
          ? { unitPrice: "0" }
          : data.unitPrice !== undefined
            ? { unitPrice: data.unitPrice }
            : {}),
        ...(data.safetyStock !== undefined
          ? {
              safetyStock: safetyStockParsed!.value,
            }
          : {}),
        ...(data.maxStock !== undefined
          ? {
              maxStock: maxStockParsed!.value,
            }
          : {}),
        ...(data.kindId !== undefined
          ? { kindId: data.kindId, kind: null }
          : {}),
        isCustomerSupplied: nextIsCustomerSupplied,
        customerId: materialCustomerId,
        ...(nextIsCustomerSupplied
          ? { supplierId: (await ensureCustomerSupplySupplier(tx)).id }
          : data.supplierId !== undefined
            ? { supplierId: data.supplierId.trim() }
            : {}),
        ...(data.inspectionNotes !== undefined
          ? { inspectionNotes: data.inspectionNotes?.trim() || null }
          : {}),
        ...(data.sampleImageUrls !== undefined
          ? { sampleImageUrls: data.sampleImageUrls.slice(0, 3) }
          : {}),
      },
    });
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("material.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;
  try {
    await prisma.material.delete({ where: { id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return NextResponse.json({ error: "物料不存在" }, { status: 404 });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return NextResponse.json(
        { error: "该物料已被业务单据或BOM引用，不能直接删除，请改为弃用物料" },
        { status: 400 },
      );
    }
    console.error("[DELETE /api/materials/[id]]", e);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
