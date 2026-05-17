import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const createSchema = z.object({
  content: z.string().trim().min(1, "请填写待办内容").max(500, "待办内容最多 500 字"),
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

export async function GET() {
  const auth = await requirePermission("todo.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  try {
    const list = await prisma.todoItem.findMany({
      where: { userId: auth.user.id },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ list: list.map(mapTodo) });
  } catch (e) {
    console.error("[GET /api/todos]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载待办失败" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const auth = await requirePermission("todo.create");
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
    const fe = parsed.error.flatten();
    return NextResponse.json(
      { error: fe.fieldErrors, formErrors: fe.formErrors },
      { status: 400 },
    );
  }
  try {
    const row = await prisma.todoItem.create({
      data: {
        userId: auth.user.id,
        content: parsed.data.content,
        status: "TODO",
      },
    });
    return NextResponse.json(mapTodo(row));
  } catch (e) {
    console.error("[POST /api/todos]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "创建待办失败" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const auth = await requirePermission("todo.delete");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  try {
    const { searchParams } = new URL(req.url);
    const fromRaw = searchParams.get("from");
    const toRaw = searchParams.get("to");
    if (!fromRaw || !toRaw) {
      return NextResponse.json({ error: "请选择时间范围" }, { status: 400 });
    }
    const from = new Date(fromRaw);
    const to = new Date(toRaw);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return NextResponse.json({ error: "时间格式无效" }, { status: 400 });
    }
    if (from > to) {
      return NextResponse.json({ error: "开始时间不能晚于结束时间" }, { status: 400 });
    }
    const deleted = await prisma.todoItem.deleteMany({
      where: {
        userId: auth.user.id,
        status: "DONE",
        updatedAt: {
          gte: from,
          lte: to,
        },
      },
    });
    return NextResponse.json({ ok: true, deletedCount: deleted.count });
  } catch (e) {
    console.error("[DELETE /api/todos]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "删除失败" },
      { status: 500 },
    );
  }
}
