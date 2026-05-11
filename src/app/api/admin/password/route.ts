import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const bodySchema = z.object({
  currentPassword: z.string().min(1, "请输入当前管理员密码"),
  newPassword: z.string().min(6, "新密码至少6位"),
});

export async function POST(req: Request) {
  const auth = await requirePermission("permission.manage");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("；");
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { currentPassword, newPassword } = parsed.data;

  if (currentPassword === newPassword) {
    return NextResponse.json({ error: "新密码不能与当前密码相同" }, { status: 400 });
  }

  const admin = await prisma.user.findFirst({
    where: { loginName: "admin", active: true, isAdmin: true },
  });

  if (!admin) {
    return NextResponse.json({ error: "管理员账户不存在或未初始化，请先执行数据库种子" }, { status: 500 });
  }

  const ok = await bcrypt.compare(currentPassword, admin.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "当前管理员密码不正确" }, { status: 401 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: admin.id },
    data: { passwordHash },
  });

  return NextResponse.json({ ok: true });
}
