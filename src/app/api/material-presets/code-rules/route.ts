import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const createSchema = z.object({
  presetKindId: z.string().min(1),
  presetNameId: z.string().min(1),
  namePrefix: z.string().min(1, "名称前缀不能为空"),
  startNumber: z.number().int().min(1).optional().default(1),
});

export async function POST(req: Request) {
  const auth = await requirePermission("material.edit");
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

  const { presetKindId, presetNameId, namePrefix, startNumber } = parsed.data;
  const np = namePrefix.trim();

  const [k, n] = await Promise.all([
    prisma.materialPresetKind.findUnique({ where: { id: presetKindId } }),
    prisma.materialPresetName.findUnique({ where: { id: presetNameId } }),
  ]);
  if (!k || !n) {
    return NextResponse.json({ error: "种类或物料名称不存在" }, { status: 400 });
  }

  try {
    const row = await prisma.materialCodeRule.create({
      data: {
        presetKindId,
        presetNameId,
        namePrefix: np,
        startNumber,
        nextNumber: startNumber,
      },
      include: {
        presetKind: { select: { id: true, name: true, prefix: true } },
        presetName: { select: { id: true, name: true, namePrefix: true } },
      },
    });
    return NextResponse.json(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique")) {
      return NextResponse.json(
        { error: "该种类与物料名称的编号规则已存在" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: msg || "创建失败" }, { status: 500 });
  }
}
