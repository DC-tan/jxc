import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const createSchema = z.object({
  customerId: z.string().min(1, "请选择客供客户"),
  materialId: z.string().min(1, "请选择客供料"),
  quantity: z.union([z.number(), z.string()]).transform((v) => String(v)),
  receivedAt: z.string().optional(),
  partDescription: z.string().optional().nullable(),
  /** 来料批次等；存 purchaseOrderNo，与部件描述分开 */
  remark: z.string().optional().nullable(),
});

async function loadScopedCustomerIds(customerId?: string): Promise<string[] | null> {
  if (!customerId) return null;
  const relations = await prisma.customerRelation.findMany({
    where: {
      OR: [{ customerId }, { relatedCustomerId: customerId }],
    },
    select: { customerId: true, relatedCustomerId: true },
  });
  const ids = new Set<string>([customerId]);
  for (const r of relations) {
    ids.add(r.customerId);
    ids.add(r.relatedCustomerId);
  }
  return Array.from(ids);
}

export async function GET(req: Request) {
  const auth = await requirePermission("material.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId")?.trim() || undefined;
  const materialId = searchParams.get("materialId")?.trim() || undefined;
  const keyword = searchParams.get("keyword")?.trim() || undefined;

  const scopedCustomerIds = await loadScopedCustomerIds(customerId);

  const materials = await prisma.material.findMany({
    where: {
      isCustomerSupplied: true,
      ...(scopedCustomerIds ? { customerId: { in: scopedCustomerIds } } : {}),
    },
    orderBy: [{ code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      customerId: true,
      partDescription: true,
      customer: { select: { id: true, code: true, name: true } },
    },
  });

  const suggestionWhere = {
    isCustomerSupplied: true as const,
    partDescription: { not: null },
    ...(scopedCustomerIds ? { customerId: { in: scopedCustomerIds } } : {}),
    ...(materialId ? { id: materialId } : {}),
  };
  const [materialDescRows, inboundDescRows] = await Promise.all([
    prisma.material.findMany({
      where: suggestionWhere,
      select: { partDescription: true },
    }),
    prisma.materialInbound.findMany({
      where: {
        entryType: "CUSTOMER_SUPPLY_RECEIPT",
        partDescription: { not: null },
        material: {
          isCustomerSupplied: true,
          ...(scopedCustomerIds ? { customerId: { in: scopedCustomerIds } } : {}),
          ...(materialId ? { id: materialId } : {}),
        },
      },
      select: { partDescription: true },
      distinct: ["partDescription"],
      take: 80,
      orderBy: { receivedAt: "desc" },
    }),
  ]);
  const partDescriptionSuggestions = Array.from(
    new Set(
      [...materialDescRows, ...inboundDescRows]
        .map((r) => r.partDescription?.trim())
        .filter((s): s is string => Boolean(s)),
    ),
  ).sort((a, b) => a.localeCompare(b, "zh-CN"));

  const customers = Array.from(
    new Map(
      materials
        .map((m) => m.customer)
        .filter(
          (c): c is {
            id: string;
            code: string;
            name: string;
          } => Boolean(c),
        )
        .map((c) => [c.id, c]),
    ).values(),
  ).sort((a, b) => a.code.localeCompare(b.code, "zh-CN"));

  const list = await prisma.materialInbound.findMany({
    where: {
      entryType: "CUSTOMER_SUPPLY_RECEIPT",
      material: {
        isCustomerSupplied: true,
        ...(scopedCustomerIds ? { customerId: { in: scopedCustomerIds } } : {}),
      },
      ...(materialId ? { materialId } : {}),
      ...(keyword
        ? {
            OR: [
              { partDescription: { contains: keyword, mode: "insensitive" } },
              { purchaseOrderNo: { contains: keyword, mode: "insensitive" } },
              { material: { code: { contains: keyword, mode: "insensitive" } } },
              { material: { name: { contains: keyword, mode: "insensitive" } } },
              { material: { customer: { name: { contains: keyword, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    orderBy: { receivedAt: "desc" },
    include: {
      material: {
        select: {
          id: true,
          code: true,
          name: true,
          unit: true,
          customerId: true,
          customer: { select: { id: true, code: true, name: true } },
        },
      },
      operator: {
        select: {
          id: true,
          name: true,
          employeeNo: true,
        },
      },
    },
    take: 300,
  });

  return NextResponse.json({
    customers,
    materials: materials.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      customerId: m.customerId,
      partDescription: m.partDescription,
      customer: m.customer,
    })),
    partDescriptionSuggestions,
    list: list.map((r) => {
      const po = r.purchaseOrderNo?.trim() || null;
      const desc = r.partDescription?.trim() || null;
      const legacyRemarkOnly = !po && desc;
      return {
        id: r.id,
        quantity: r.quantity,
        receivedAt: r.receivedAt.toISOString(),
        partDescription: legacyRemarkOnly ? null : desc,
        remark: po ?? (legacyRemarkOnly ? desc : null),
        customer: r.material.customer,
        material: {
          id: r.material.id,
          code: r.material.code,
          name: r.material.name,
          unit: r.material.unit,
        },
        operatorName: r.operator?.name ?? null,
        operatorEmployeeNo: r.operator?.employeeNo ?? null,
      };
    }),
  });
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
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const qty = Math.trunc(Number(parsed.data.quantity));
  if (!Number.isFinite(qty) || qty < 1) {
    return NextResponse.json({ error: "收料数量须为正整数" }, { status: 400 });
  }

  const customer = await prisma.customer.findUnique({
    where: { id: parsed.data.customerId },
    select: { id: true },
  });
  if (!customer) {
    return NextResponse.json({ error: "客供客户不存在" }, { status: 400 });
  }
  const scopedCustomerIdsForPost =
    (await loadScopedCustomerIds(parsed.data.customerId)) ?? [parsed.data.customerId];

  const material = await prisma.material.findUnique({
    where: { id: parsed.data.materialId },
    select: {
      id: true,
      isCustomerSupplied: true,
      customerId: true,
    },
  });
  if (!material) {
    return NextResponse.json({ error: "客供料不存在" }, { status: 400 });
  }
  if (!material.isCustomerSupplied) {
    return NextResponse.json({ error: "所选物料不是客供料" }, { status: 400 });
  }
  if (!material.customerId || !scopedCustomerIdsForPost.includes(material.customerId)) {
    return NextResponse.json(
      { error: "客供客户与物料不匹配（不在关联客户范围内）" },
      { status: 400 },
    );
  }

  let receivedAt = new Date();
  if (parsed.data.receivedAt) {
    const d = new Date(parsed.data.receivedAt);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "入库时间无效" }, { status: 400 });
    }
    receivedAt = d;
  }

  const row = await prisma.materialInbound.create({
    data: {
      materialId: material.id,
      quantity: qty,
      receivedAt,
      purchaseOrderNo: parsed.data.remark?.trim() || null,
      partDescription: parsed.data.partDescription?.trim() || null,
      entryType: "CUSTOMER_SUPPLY_RECEIPT",
      operatorUserId: auth.user.id,
    },
  });

  return NextResponse.json({ id: row.id });
}
