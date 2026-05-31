import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { allocateMaterialCode } from "@/lib/materialCodeAllocation";
import { resolveMaterialNaming } from "@/lib/materialCreateNaming";
import { MATERIAL_KIND_LABEL } from "@/lib/materialLabels";
import { resolveMaterialPurchaseChannelByKindName } from "@/lib/material-purchase-channel";
import { ensureCustomerSupplySupplier } from "@/lib/customer-supply";

const createSchema = z.object({
  code: z.string().optional(),
  kindId: z.string().min(1, "请选择物料种类"),
  presetNameId: z.string().optional(),
  customName: z.string().optional(),
  customNamePrefix: z.string().optional(),
  partDescription: z.string().optional().nullable(),
  brand: z.string().optional().nullable(),
  unit: z.string().min(1, "请选择单位"),
  unitPrice: z.union([z.number(), z.string()]).transform((v) => String(v)).optional(),
  safetyStock: z.union([z.number(), z.string()]).optional(),
  maxStock: z.union([z.number(), z.string()]).optional(),
  supplierId: z.string().optional(),
  isCustomerSupplied: z.boolean().optional(),
  customerId: z.string().optional().nullable(),
  inspectionNotes: z.string().optional().nullable(),
  sampleImageUrls: z.array(z.string()).max(3).optional(),
});

function toNonNegativeInteger(
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
  // 业务约定：0 视为未设置，不参与库存预警
  if (n === 0) return { ok: true, value: null };
  return { ok: true, value: n };
}

function parseSampleUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string").slice(0, 3);
}

function kindDisplay(
  m: {
    kind: import("@prisma/client").MaterialKind | null;
    presetKind: { name: string } | null;
  },
): string {
  if (m.presetKind) return m.presetKind.name;
  if (m.kind) return MATERIAL_KIND_LABEL[m.kind];
  return "—";
}

export async function GET(req: Request) {
  try {
    const auth = await requirePermission("material.view");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const { searchParams } = new URL(req.url);
    const createdFrom = searchParams.get("createdFrom");
    const createdTo = searchParams.get("createdTo");
    const deprecatedRaw = (searchParams.get("deprecated") ?? "0").trim();

    const where: Prisma.MaterialWhereInput = {};
    if (deprecatedRaw === "1") {
      where.isDeprecated = true;
    } else if (deprecatedRaw === "all") {
      // no-op
    } else {
      where.isDeprecated = false;
    }
    if (createdFrom && createdTo) {
      const a = new Date(createdFrom);
      const b = new Date(createdTo);
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
        where.createdAt = { gte: a, lte: b };
      }
    }

    const list = await prisma.material.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        customer: { select: { id: true, code: true, name: true } },
        inbounds: { select: { quantity: true } },
        presetKind: { select: { id: true, name: true, prefix: true } },
      },
    });

    const rows = list.map((m) => {
      const totalQty = m.inbounds.reduce(
        (s, i) => s + Number(i.quantity),
        0,
      );
      return {
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
        kindId: m.kindId,
        kindName: kindDisplay(m),
        kind: m.kind,
        isCustomerSupplied: m.isCustomerSupplied,
        customerId: m.customerId,
        customer: m.customer,
        supplierId: m.supplierId,
        supplier: m.supplier,
        presetKind: m.presetKind,
        inspectionNotes: m.inspectionNotes,
        sampleImageUrls: parseSampleUrls(m.sampleImageUrls),
        totalQty,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({ list: rows });
  } catch (e) {
    console.error("[GET /api/materials]", e);
    const msg =
      e instanceof Error ? e.message : "加载物料列表失败";
    return NextResponse.json(
      {
        error:
          msg.includes("does not exist") || msg.includes("Unknown table")
            ? "数据库未同步物料表，请在服务器执行：npx prisma db push"
            : msg,
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const auth = await requirePermission("material.create");
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
    const err = parsed.error.flatten();
    return NextResponse.json(
      { error: err.fieldErrors, formErrors: err.formErrors },
      { status: 400 },
    );
  }

  const urls = (parsed.data.sampleImageUrls ?? []).slice(0, 3);
  const manualCode = parsed.data.code?.trim();
  const safetyStockParsed = toNonNegativeInteger(
    parsed.data.safetyStock,
    "安全库存",
  );
  if (!safetyStockParsed.ok) {
    return NextResponse.json({ error: safetyStockParsed.error }, { status: 400 });
  }
  const maxStockParsed = toNonNegativeInteger(parsed.data.maxStock, "最大库存");
  if (!maxStockParsed.ok) {
    return NextResponse.json({ error: maxStockParsed.error }, { status: 400 });
  }

  const isCustomerSupplied = Boolean(parsed.data.isCustomerSupplied);
  const customerId = parsed.data.customerId?.trim() || null;
  let manualSupplierId: string | null = null;
  if (isCustomerSupplied && !customerId) {
    return NextResponse.json({ error: "客供料必须选择客供客户" }, { status: 400 });
  }
  if (customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      return NextResponse.json({ error: "客供客户不存在" }, { status: 400 });
    }
  }
  if (!isCustomerSupplied) {
    const supplierId = parsed.data.supplierId?.trim();
    if (!supplierId) {
      return NextResponse.json({ error: "请选择供应商" }, { status: 400 });
    }
    manualSupplierId = supplierId;
    const sup = await prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!sup) {
      return NextResponse.json({ error: "供应商不存在" }, { status: 400 });
    }
  }

  const kind = await prisma.materialPresetKind.findUnique({
    where: { id: parsed.data.kindId },
  });
  if (!kind) {
    return NextResponse.json({ error: "物料种类不存在" }, { status: 400 });
  }
  const materialCustomerId = isCustomerSupplied
    ? customerId
    : kind.namingMode === "CUSTOM"
      ? customerId
      : null;
  const presetNames = await prisma.materialPresetName.findMany({
    select: { id: true, name: true, namePrefix: true },
  });
  let namingResolved: ReturnType<typeof resolveMaterialNaming>;
  if (kind.namingMode === "CUSTOM") {
    namingResolved = resolveMaterialNaming(
      kind,
      {
        materialName: parsed.data.customName?.trim() ?? "",
        customNamePrefix: parsed.data.customNamePrefix,
      },
      presetNames,
    );
  } else {
    const presetNameId = parsed.data.presetNameId?.trim() ?? "";
    if (!presetNameId) {
      return NextResponse.json({ error: "请选择物料名称" }, { status: 400 });
    }
    const presetName = presetNames.find((n) => n.id === presetNameId);
    if (!presetName) {
      return NextResponse.json({ error: "物料名称预设不存在" }, { status: 400 });
    }
    namingResolved = resolveMaterialNaming(
      kind,
      { materialName: presetName.name },
      presetNames,
    );
  }
  if (!namingResolved.ok) {
    return NextResponse.json({ error: namingResolved.error }, { status: 400 });
  }
  const { materialName, allocNamePrefix, sequencePadLength } = namingResolved;
  const purchaseChannel = resolveMaterialPurchaseChannelByKindName(kind.name);

  try {
    const row = await prisma.$transaction(async (tx) => {
      let code: string;
      if (manualCode && manualCode.length > 0) {
        code = manualCode;
        const dup = await tx.material.findUnique({ where: { code } });
        if (dup) {
          throw new Error("DUPLICATE_CODE");
        }
      } else {
        const alloc = await allocateMaterialCode(
          tx,
          {
            kindId: parsed.data.kindId,
            namePrefix: allocNamePrefix,
            sequencePadLength,
          },
        );
        if (!alloc.ok) {
          throw new Error(alloc.error);
        }
        code = alloc.code;
      }

      return tx.material.create({
        data: {
          code,
          name: materialName,
          partDescription: parsed.data.partDescription?.trim() || null,
          brand: parsed.data.brand?.trim() || null,
          unit: parsed.data.unit.trim(),
          unitPrice: isCustomerSupplied ? "0" : (parsed.data.unitPrice ?? "0"),
          safetyStock: safetyStockParsed.value,
          maxStock: maxStockParsed.value,
          kindId: parsed.data.kindId,
          kind: null,
          purchaseChannel,
          isCustomerSupplied,
          customerId: materialCustomerId,
          supplierId: isCustomerSupplied
            ? (await ensureCustomerSupplySupplier(tx)).id
            : String(manualSupplierId),
          inspectionNotes: parsed.data.inspectionNotes?.trim() || null,
          sampleImageUrls: urls,
        },
      });
    });

    return NextResponse.json({ id: row.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "创建失败";
    if (msg === "DUPLICATE_CODE") {
      return NextResponse.json({ error: "物料编号已存在" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
