import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    if (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth")) {
      return NextResponse.json(
        { error: "服务器未配置 AUTH_SECRET（至少16位）" },
        { status: 500 },
      );
    }
    if (pathname.startsWith("/dashboard")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next();
  }

  const key = new TextEncoder().encode(secret);

  if (pathname.startsWith("/api/")) {
    const token = request.cookies.get("jxc_session")?.value;
    if (!token) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    try {
      await jwtVerify(token, key);
    } catch {
      return NextResponse.json({ error: "会话无效或已过期" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/dashboard")) {
    const token = request.cookies.get("jxc_session")?.value;
    if (!token) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    try {
      await jwtVerify(token, key);
    } catch {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
