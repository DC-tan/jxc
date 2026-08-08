import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createArchiveChangeRecord,
  kindSchema,
  listArchiveChangeRecords,
} from "@/lib/archive-change-records";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const kindRaw = new URL(req.url).searchParams.get("kind")?.trim() ?? "";
    const kindParsed = kindSchema.safeParse(kindRaw);
    if (!kindParsed.success) {
      return NextResponse.json(
        { error: "请指定 kind=VERSION 或 PRICE" },
        { status: 400 },
      );
    }
    const exists = await prisma.material.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      return NextResponse.json({ error: "物料不存在" }, { status: 404 });
    }
    return listArchiveChangeRecords({
      targetType: "MATERIAL",
      targetId: id,
      kind: kindParsed.data,
      viewPermission: "material.view",
    });
  } catch (e) {
    console.error("[GET /api/materials/[id]/change-records]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }
    const exists = await prisma.material.findUnique({
      where: { id },
      select: { id: true },
    });
    return createArchiveChangeRecord({
      targetType: "MATERIAL",
      targetId: id,
      exists: !!exists,
      editPermission: "material.edit",
      body: json,
    });
  } catch (e) {
    console.error("[POST /api/materials/[id]/change-records]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 500 },
    );
  }
}
