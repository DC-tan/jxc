import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { setSessionCookie, signSession } from "@/lib/auth";

export async function POST(req: Request) {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const password = body.password ?? "";
  if (!password) {
    return NextResponse.json({ error: "请输入密码" }, { status: 400 });
  }

  const user = await prisma.user.findFirst({
    where: { loginName: "admin", active: true, isAdmin: true },
  });

  if (!user) {
    return NextResponse.json({ error: "管理员账户未初始化，请先执行数据库种子" }, { status: 500 });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }

  const token = await signSession({
    sub: user.id,
    isAdmin: true,
    role: user.role,
    loginName: user.loginName,
  });
  await setSessionCookie(token);

  return NextResponse.json({
    ok: true,
    user: { name: user.name, loginName: user.loginName, isAdmin: true },
  });
}
