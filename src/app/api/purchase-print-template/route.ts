import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  mergePurchasePrintConfig,
  parsePurchasePrintConfigForSave,
} from "@/lib/purchase-print-template";

const SINGLETON_ID = "singleton";

export async function GET() {
  const auth = await requirePermission("purchase.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const row = await prisma.purchasePrintTemplate.findUnique({
      where: { id: SINGLETON_ID },
    });
    const config = mergePurchasePrintConfig(row?.config ?? {});
    return NextResponse.json({
      config,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    });
  } catch (e) {
    console.error("[GET /api/purchase-print-template]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  const auth = await requirePermission("purchase.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const body = json as { config?: unknown };
  if (!body || typeof body.config !== "object") {
    return NextResponse.json({ error: "缺少 config" }, { status: 400 });
  }

  const parsed = parsePurchasePrintConfigForSave(body.config);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    await prisma.purchasePrintTemplate.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, config: parsed.config as object },
      update: { config: parsed.config as object },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[PUT /api/purchase-print-template]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 500 },
    );
  }
}
