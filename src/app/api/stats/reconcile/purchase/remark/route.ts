import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const singleSchema = z.object({
  lineKey: z.string().min(1).max(200),
  remark: z.string().max(2000).optional().nullable(),
});

const batchSchema = z.object({
  lineKeys: z.array(z.string().min(1).max(200)).min(1).max(500),
  remark: z.string().max(2000).optional().nullable(),
});

function isValidLineKey(lineKey: string): boolean {
  return lineKey.startsWith("split:") || lineKey.startsWith("whole:");
}

async function saveRemarkForLine(
  lineKey: string,
  remark: string,
  userId: string,
): Promise<void> {
  if (!remark) {
    await prisma.purchaseReconcileRemark.deleteMany({ where: { lineKey } });
    return;
  }
  await prisma.purchaseReconcileRemark.upsert({
    where: { lineKey },
    create: { lineKey, remark, updatedByUserId: userId },
    update: { remark, updatedByUserId: userId },
  });
}

export async function PUT(req: Request) {
  const auth = await requirePermission("stats.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const batchTry = batchSchema.safeParse(json);
  if (batchTry.success) {
    const remark = batchTry.data.remark?.trim() ?? "";
    const lineKeys = [...new Set(batchTry.data.lineKeys.map((k) => k.trim()))];
    for (const k of lineKeys) {
      if (!isValidLineKey(k)) {
        return NextResponse.json({ error: "无效的对帐行标识" }, { status: 400 });
      }
    }
    try {
      await prisma.$transaction(async (tx) => {
        for (const lineKey of lineKeys) {
          if (!remark) {
            await tx.purchaseReconcileRemark.deleteMany({ where: { lineKey } });
          } else {
            await tx.purchaseReconcileRemark.upsert({
              where: { lineKey },
              create: {
                lineKey,
                remark,
                updatedByUserId: auth.user.id,
              },
              update: {
                remark,
                updatedByUserId: auth.user.id,
              },
            });
          }
        }
      });
      return NextResponse.json({ ok: true, remark, count: lineKeys.length });
    } catch (e) {
      console.error("[PUT batch /api/stats/reconcile/purchase/remark]", e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "保存备注失败" },
        { status: 500 },
      );
    }
  }

  const parsed = singleSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  const lineKey = parsed.data.lineKey.trim();
  const remark = parsed.data.remark?.trim() ?? "";

  if (!isValidLineKey(lineKey)) {
    return NextResponse.json({ error: "无效的对帐行标识" }, { status: 400 });
  }

  try {
    await saveRemarkForLine(lineKey, remark, auth.user.id);
    return NextResponse.json({ ok: true, remark });
  } catch (e) {
    console.error("[PUT /api/stats/reconcile/purchase/remark]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存备注失败" },
      { status: 500 },
    );
  }
}
