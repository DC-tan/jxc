import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission, requirePermissionSome } from "@/lib/api-auth";

const bodySchema = z.object({
  code: z.string().min(1, "请填写供应商编号"),
  name: z.string().min(1, "请填写供应商名称"),
  shortName: z.string().optional().nullable(),
  materialType: z.string().optional().nullable(),
  level: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  bankAccount: z.string().optional().nullable(),
  taxRegistrationNo: z.string().optional().nullable(),
  deliveryLeadDays: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === "") return null;
      const n = Math.trunc(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > 3650) return null;
      return n;
    }),
  attrProduction: z.boolean().optional().default(true),
  attrProcessing: z.boolean().optional().default(false),
  priceIncludesTax: z.boolean().optional().default(false),
});

export async function GET(req: Request) {
  try {
    // 物料库存/新增物料等页的供应商筛选需要列表；已有 material.view 即可（不必开通供应商模块）
    const auth = await requirePermissionSome(["supplier.view", "material.view"]);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const { searchParams } = new URL(req.url);
    const outsourceOnly =
      searchParams.get("outsourceOnly") === "1" ||
      searchParams.get("outsourceOnly") === "true";

    const list = await prisma.supplier.findMany({
      where: outsourceOnly ? { attrProcessing: true } : undefined,
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ list });
  } catch (e) {
    console.error("[GET /api/suppliers]", e);
    const msg = e instanceof Error ? e.message : "加载供应商失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePermission("supplier.create");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const dup = await prisma.supplier.findUnique({
      where: { code: parsed.data.code },
    });
    if (dup) {
      return NextResponse.json({ error: "供应商编号已存在" }, { status: 400 });
    }

    const d = parsed.data;
    const row = await prisma.supplier.create({
      data: {
        code: d.code.trim(),
        name: d.name.trim(),
        shortName: d.shortName?.trim() || null,
        materialType: d.materialType?.trim() || null,
        level: d.level?.trim() || null,
        contactPerson: d.contactPerson?.trim() || null,
        phone: d.phone?.trim() || null,
        address: d.address?.trim() || null,
        bankName: d.bankName?.trim() || null,
        bankAccount: d.bankAccount?.trim() || null,
        taxRegistrationNo: d.taxRegistrationNo?.trim() || null,
        deliveryLeadDays: d.deliveryLeadDays ?? null,
        attrProduction: parsed.data.attrProduction,
        attrProcessing: parsed.data.attrProcessing,
        priceIncludesTax: parsed.data.priceIncludesTax,
      },
    });
    return NextResponse.json({ id: row.id });
  } catch (e) {
    console.error("[POST /api/suppliers]", e);
    const msg = e instanceof Error ? e.message : "创建供应商失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
