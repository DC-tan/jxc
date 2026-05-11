import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { StaffRole } from "@/lib/permissions";

const COOKIE_NAME = "jxc_session";

export type SessionPayload = {
  sub: string;
  isAdmin: boolean;
  role: StaffRole;
  loginName: string;
};

function getSecret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("请在环境变量 AUTH_SECRET 中配置至少16位随机密钥");
  }
  return new TextEncoder().encode(s);
}

export async function signSession(payload: SessionPayload, maxAgeSec = 60 * 60 * 24 * 7) {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSec}s`)
    .sign(getSecret());
  return token;
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const sub = String(payload.sub ?? "");
    const isAdmin = Boolean(payload.isAdmin);
    const role = payload.role as StaffRole;
    const loginName = String(payload.loginName ?? "");
    if (!sub || !role || !loginName) return null;
    return { sub, isAdmin, role, loginName };
  } catch {
    return null;
  }
}

export async function getSessionFromCookies(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return verifySession(raw);
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export { COOKIE_NAME };
