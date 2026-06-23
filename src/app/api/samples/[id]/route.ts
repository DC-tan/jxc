import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const patchSchema = z.object({
  customerId: z.string().min(1).optional(),
  supplierInfo: z.string().optional().nullable(),
  model: z.string().min(1).optional(),
  materialNames: z.string().min(1).optional(),
  quantity: z.union([z.number(), z.string()]).optional(),
  sampleDueAt: z.string().optional(),
  remark: z.string().optional().nullable(),
});

function toPositiveInt(v: unknown, fallback = 1): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("sample.edit");
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

  const exists = await prisma.sampleOrder.findUnique({ where: { id } });
  if (!exists) {
    return NextResponse.json({ error: "样品记录不存在" }, { status: 404 });
  }

  const d = parsed.data;
  if (d.customerId) {
    const c = await prisma.customer.findUnique({
      where: { id: d.customerId },
      select: { id: true },
    });
    if (!c) return NextResponse.json({ error: "客户不存在" }, { status: 400 });
  }
  let sampleDueAt: Date | undefined;
  if (d.sampleDueAt) {
    sampleDueAt = new Date(d.sampleDueAt);
    if (Number.isNaN(sampleDueAt.getTime())) {
      return NextResponse.json({ error: "交样日期无效" }, { status: 400 });
    }
  }

  await prisma.sampleOrder.update({
    where: { id },
    data: {
      ...(d.customerId !== undefined ? { customerId: d.customerId } : {}),
      ...(d.supplierInfo !== undefined ? { supplierInfo: d.supplierInfo?.trim() || null } : {}),
      ...(d.model !== undefined ? { model: d.model.trim() } : {}),
      ...(d.materialNames !== undefined
        ? { materialNames: d.materialNames.trim() }
        : {}),
      ...(d.quantity !== undefined
        ? { quantity: toPositiveInt(d.quantity, exists.quantity) }
        : {}),
      ...(sampleDueAt !== undefined ? { sampleDueAt } : {}),
      ...(d.remark !== undefined ? { remark: d.remark?.trim() || null } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("sample.delete");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;
  try {
    await prisma.sampleOrder.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "样品记录不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
