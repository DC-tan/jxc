import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  prefix: z.string().optional(),
  namingMode: z.enum(["STANDARD", "CUSTOM"]).optional(),
  sortOrder: z.number().int().optional(),
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

  const exists = await prisma.materialPresetKind.findUnique({ where: { id } });
  if (!exists) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  }

  const data = parsed.data;
  try {
    const row = await prisma.materialPresetKind.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.prefix !== undefined ? { prefix: data.prefix.trim() } : {}),
        ...(data.namingMode !== undefined ? { namingMode: data.namingMode } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });
    return NextResponse.json(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique")) {
      return NextResponse.json({ error: "种类名称已存在" }, { status: 400 });
    }
    return NextResponse.json({ error: msg || "更新失败" }, { status: 500 });
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

  const matCount = await prisma.material.count({ where: { kindId: id } });

  if (matCount > 0) {
    return NextResponse.json(
      {
        error: `无法删除：已有 ${matCount} 条物料引用该种类`,
      },
      { status: 400 },
    );
  }

  try {
    await prisma.$transaction([
      prisma.materialCodeRule.deleteMany({ where: { presetKindId: id } }),
      prisma.materialPresetKind.delete({ where: { id } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
