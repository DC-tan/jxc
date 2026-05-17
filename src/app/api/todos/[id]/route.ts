import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const patchSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "请填写待办内容")
    .max(500, "待办内容最多 500 字")
    .optional(),
  status: z.enum(["TODO", "DEFERRED", "DONE"]).optional(),
});

function mapTodo(row: {
  id: string;
  serialNo: number;
  content: string;
  status: "TODO" | "DEFERRED" | "DONE";
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    serialNo: row.serialNo,
    content: row.content,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    const fe = parsed.error.flatten();
    return NextResponse.json(
      { error: fe.fieldErrors, formErrors: fe.formErrors },
      { status: 400 },
    );
  }
  const { id } = await ctx.params;
  const payload = parsed.data;
  const needContent = payload.content !== undefined;
  const needStatus = payload.status !== undefined;
  if (!needContent && !needStatus) {
    return NextResponse.json({ error: "缺少更新内容" }, { status: 400 });
  }

  const auth = await requirePermission(needStatus ? "todo.complete" : "todo.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const existing = await prisma.todoItem.findFirst({
      where: { id, userId: auth.user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "待办不存在" }, { status: 404 });
    }
    const row = await prisma.todoItem.update({
      where: { id },
      data: {
        ...(needContent ? { content: payload.content } : {}),
        ...(needStatus ? { status: payload.status } : {}),
      },
    });
    return NextResponse.json(mapTodo(row));
  } catch (e) {
    console.error("[PATCH /api/todos/:id]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "更新待办失败" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("todo.delete");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const { id } = await ctx.params;
  try {
    const existing = await prisma.todoItem.findFirst({
      where: { id, userId: auth.user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "待办不存在" }, { status: 404 });
    }
    await prisma.todoItem.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/todos/:id]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "删除待办失败" },
      { status: 500 },
    );
  }
}
