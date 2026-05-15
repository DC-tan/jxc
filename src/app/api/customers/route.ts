import { NextResponse } from "next/server";
import { z } from "zod";
import { CustomerQuality } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const bodySchema = z.object({
  code: z.string().min(1, "请填写客户编号"),
  name: z.string().min(1, "请填写客户全称"),
  shortName: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  mainProduct: z.string().optional().nullable(),
  quality: z.nativeEnum(CustomerQuality),
});

export async function GET() {
  const auth = await requirePermission("customer.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const list = await prisma.customer.findMany({ orderBy: { updatedAt: "desc" } });
  return NextResponse.json({ list });
}

export async function POST(req: Request) {
  const auth = await requirePermission("customer.create");
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

  const dup = await prisma.customer.findUnique({
    where: { code: parsed.data.code },
  });
  if (dup) {
    return NextResponse.json({ error: "客户编号已存在" }, { status: 400 });
  }

  const d = parsed.data;
  const row = await prisma.customer.create({
    data: {
      code: d.code.trim(),
      name: d.name.trim(),
      shortName: d.shortName?.trim() || null,
      contactPerson: d.contactPerson?.trim() || null,
      phone: d.phone?.trim() || null,
      address: d.address?.trim() || null,
      mainProduct: d.mainProduct?.trim() || null,
      quality: d.quality,
    },
  });
  return NextResponse.json({ id: row.id });
}
