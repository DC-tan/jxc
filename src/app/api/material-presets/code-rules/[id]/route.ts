import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const patchSchema = z.object({
  namePrefix: z.string().min(1).optional(),
  startNumber: z.number().int().min(1).optional(),
  nextNumber: z.number().int().min(1).optional(),
});

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

  const exists = await prisma.materialCodeRule.findUnique({ where: { id } });
  if (!exists) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  }

  const data = parsed.data;
  try {
    const row = await prisma.materialCodeRule.update({
      where: { id },
      data: {
        ...(data.namePrefix !== undefined
          ? { namePrefix: data.namePrefix.trim() }
          : {}),
        ...(data.startNumber !== undefined ? { startNumber: data.startNumber } : {}),
        ...(data.nextNumber !== undefined ? { nextNumber: data.nextNumber } : {}),
      },
      include: {
        presetKind: { select: { id: true, name: true, prefix: true } },
        presetName: { select: { id: true, name: true, namePrefix: true } },
      },
    });
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "更新失败" },
      { status: 500 },
    );
  }
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
    await prisma.materialCodeRule.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
