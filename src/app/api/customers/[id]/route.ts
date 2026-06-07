import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { CustomerQuality } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const patchSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  shortName: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  mainProduct: z.string().optional().nullable(),
  quality: z.nativeEnum(CustomerQuality).optional(),
  priceIncludesTax: z.boolean().optional(),
  relatedCustomerIds: z.array(z.string().min(1)).optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("customer.edit");
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
  if (raw.shortName !== undefined) data.shortName = raw.shortName?.trim() || null;
  if (raw.contactPerson !== undefined)
    data.contactPerson = raw.contactPerson?.trim() || null;
  if (raw.phone !== undefined) data.phone = raw.phone?.trim() || null;
  if (raw.address !== undefined) data.address = raw.address?.trim() || null;
  if (raw.mainProduct !== undefined)
    data.mainProduct = raw.mainProduct?.trim() || null;
  if (raw.quality !== undefined) data.quality = raw.quality;
  if (raw.priceIncludesTax !== undefined)
    data.priceIncludesTax = raw.priceIncludesTax;
  const relatedCustomerIds =
    raw.relatedCustomerIds !== undefined
      ? Array.from(
          new Set(raw.relatedCustomerIds.map((x) => x.trim()).filter(Boolean)),
        )
      : undefined;
  if (relatedCustomerIds?.includes(id)) {
    return NextResponse.json(
      { error: "关联客户不能选择当前客户本身" },
      { status: 400 },
    );
  }
  if (relatedCustomerIds) {
    const related = await prisma.customer.findMany({
      where: { id: { in: relatedCustomerIds } },
      select: { id: true },
    });
    if (related.length !== relatedCustomerIds.length) {
      return NextResponse.json({ error: "存在无效的关联客户" }, { status: 400 });
    }
  }

  if (typeof data.code === "string") {
    const dup = await prisma.customer.findFirst({
      where: { code: data.code, NOT: { id } },
    });
    if (dup) {
      return NextResponse.json({ error: "客户编号已存在" }, { status: 400 });
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  await prisma.customer.update({
    where: { id },
    data: {
      ...(data as Prisma.CustomerUpdateInput),
      ...(relatedCustomerIds !== undefined
        ? {
            linkedCustomersAsSource: {
              deleteMany: {},
              create: relatedCustomerIds.map((relatedCustomerId) => ({
                relatedCustomerId,
              })),
            },
          }
        : {}),
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("customer.delete");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;
  await prisma.customer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
