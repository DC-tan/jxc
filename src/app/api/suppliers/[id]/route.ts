import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const patchSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
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
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      const n = Math.trunc(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > 3650) return null;
      return n;
    }),
  attrProduction: z.boolean().optional(),
  attrProcessing: z.boolean().optional(),
  priceIncludesTax: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("supplier.edit");
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

  const raw = parsed.data;
  const data: Record<string, unknown> = {};
  if (raw.code !== undefined) data.code = raw.code.trim();
  if (raw.name !== undefined) data.name = raw.name.trim();
  if (raw.shortName !== undefined)
    data.shortName = raw.shortName?.trim() || null;
  if (raw.materialType !== undefined)
    data.materialType = raw.materialType?.trim() || null;
  if (raw.level !== undefined) data.level = raw.level?.trim() || null;
  if (raw.contactPerson !== undefined)
    data.contactPerson = raw.contactPerson?.trim() || null;
  if (raw.phone !== undefined) data.phone = raw.phone?.trim() || null;
  if (raw.address !== undefined) data.address = raw.address?.trim() || null;
  if (raw.bankName !== undefined) data.bankName = raw.bankName?.trim() || null;
  if (raw.bankAccount !== undefined)
    data.bankAccount = raw.bankAccount?.trim() || null;
  if (raw.taxRegistrationNo !== undefined)
    data.taxRegistrationNo = raw.taxRegistrationNo?.trim() || null;
  if (raw.deliveryLeadDays !== undefined)
    data.deliveryLeadDays = raw.deliveryLeadDays;
  if (raw.attrProduction !== undefined) data.attrProduction = raw.attrProduction;
  if (raw.attrProcessing !== undefined) data.attrProcessing = raw.attrProcessing;
  if (raw.priceIncludesTax !== undefined)
    data.priceIncludesTax = raw.priceIncludesTax;

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "没有可更新的字段，请检查表单是否填写完整" },
      { status: 400 },
    );
  }

  try {
    if (typeof data.code === "string") {
      const dup = await prisma.supplier.findFirst({
        where: { code: data.code, NOT: { id } },
      });
      if (dup) {
        return NextResponse.json({ error: "供应商编号已存在" }, { status: 400 });
      }
    }

    await prisma.supplier.update({
      where: { id },
      data: data as Prisma.SupplierUpdateInput,    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[PATCH /api/suppliers/[id]]", e);
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025") {
        return NextResponse.json({ error: "供应商不存在或已被删除" }, { status: 404 });
      }
    }
    const msg =
      e instanceof Error ? e.message : "保存失败";
    const hint =
      /shortName|deliveryLeadDays|does not exist|column/i.test(msg)
        ? `${msg}（若刚升级程序，请在服务器执行 npx prisma db push 同步数据库）`
        : msg;
    return NextResponse.json({ error: hint }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("supplier.delete");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;
  try {
    await prisma.supplier.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/suppliers/[id]]", e);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return NextResponse.json({ error: "供应商不存在或已被删除" }, { status: 404 });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return NextResponse.json(
        { error: "该供应商仍有关联物料或采购数据，无法删除" },
        { status: 400 },
      );
    }
    const msg = e instanceof Error ? e.message : "删除失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
