import { NextResponse } from "next/server";
import { z } from "zod";
import { requireLogin } from "@/lib/api-auth";
import { yearMonthOf } from "@/lib/reconcile-calendar";
import { prisma } from "@/lib/prisma";
import {
  parseStoredWorkbenchSettings,
  type WorkbenchSettings,
} from "@/lib/workbench-settings";

const bodySchema = z.object({
  type: z.enum(["supplier", "customer", "other"]),
});

/**
 * 标记本自然月对帐提醒已处理；下月起可再次从设置的起始日起提示。
 */
export async function POST(req: Request) {
  const auth = await requireLogin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "type 须为 supplier、customer 或 other" },
      { status: 400 },
    );
  }
  try {
    const u = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { workbenchSettings: true },
    });
    const current = parseStoredWorkbenchSettings(u?.workbenchSettings ?? null);
    const ym = yearMonthOf(new Date());
    const key = parsed.data.type;
    const nextAck: WorkbenchSettings["reconcileAck"] = {
      ...current.reconcileAck,
      [key]: ym,
    };
    /* 全系统交期/对账日改存 SystemWorkbenchSettings，此处只保留本账号「对帐完成」记录 */
    await prisma.user.update({
      where: { id: auth.user.id },
      data: { workbenchSettings: { reconcileAck: nextAck } },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/me/reconcile-ack]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 500 },
    );
  }
}
