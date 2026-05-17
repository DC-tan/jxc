import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const createSchema = z.object({
  name: z.string().min(1, "名称不能为空"),
  prefix: z.string().optional().default(""),
  namingMode: z.enum(["STANDARD", "CUSTOM"]).optional().default("STANDARD"),
  sortOrder: z.number().int().optional(),
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

  const name = parsed.data.name.trim();
  const prefix = parsed.data.prefix?.trim() ?? "";

  try {
    const row = await prisma.materialPresetKind.create({
      data: {
        name,
        prefix,
        namingMode: parsed.data.namingMode,
        sortOrder: parsed.data.sortOrder ?? 0,
      },
    });
    return NextResponse.json(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique")) {
      return NextResponse.json({ error: "种类名称已存在" }, { status: 400 });
    }
    return NextResponse.json({ error: msg || "创建失败" }, { status: 500 });
  }
}
