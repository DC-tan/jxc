import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/auth";

export async function POST(req: Request) {
  let body: { account?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const account = (body.account ?? "").trim();
  const password = body.password ?? "";
  if (!account || !password) {
    return NextResponse.json({ error: "请输入账号和密码" }, { status: 400 });
  }

  const user = await prisma.user.findFirst({
    where: {
      active: true,
      isAdmin: false,
      OR: [{ employeeNo: account }, { loginName: account }],
    },
  });

  if (!user) {
    return NextResponse.json(
      { error: "账号不存在或未开通，请联系管理员" },
      { status: 401 },
    );
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }

  const token = await signSession({
    sub: user.id,
    isAdmin: false,
    role: user.role,
    loginName: user.loginName,
  });

  // 直接设置 Cookie，不再调用 setSessionCookie
  const response = NextResponse.json({
    ok: true,
    user: {
      name: user.name,
      loginName: user.loginName,
      employeeNo: user.employeeNo,
      avatarUrl: user.avatarUrl,
      isAdmin: false,
    },
  });

  response.cookies.set("jxc_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}