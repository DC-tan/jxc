import { prisma } from "@/lib/prisma";
import { getSessionFromCookies } from "@/lib/auth";
import { expandAssignedPermissionCodes } from "@/lib/permissions";

export type AuthedUser = {
  id: string;
  loginName: string;
  employeeNo: string;
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  role: import("@/lib/permissions").StaffRole;
  /** 从 tab.* 等展开后，与 API requirePermission(legacy) 及菜单等一致 */
  permissionCodes: Set<string>;
  /** 用户权限表中的原始 code，不展开。首页分块、工作台等用 */
  rawPermissionCodes: Set<string>;
};

export async function getAuthedUser(): Promise<AuthedUser | null> {
  const session = await getSessionFromCookies();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    include: {
      permissions: { include: { permission: true } },
    },
  });

  if (!user || !user.active) return null;

  const rawAssigned = user.permissions.map((p) => p.permission.code);
  const enabledMatrixRows = await prisma.rolePermissionMatrix.findMany({
    where: {
      role: user.role,
      enabled: true,
      permission: { code: { startsWith: "tab." } },
    },
    include: { permission: true },
  });
  const enabledMatrixCodes = new Set(
    enabledMatrixRows.map((r) => r.permission.code),
  );
  const raw = rawAssigned.filter(
    (code) => !code.startsWith("tab.") || enabledMatrixCodes.has(code),
  );
  const rawPermissionCodes = new Set(raw);
  const permissionCodes = expandAssignedPermissionCodes(raw);

  return {
    id: user.id,
    loginName: user.loginName,
    employeeNo: user.employeeNo,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isAdmin: user.isAdmin,
    role: user.role,
    permissionCodes,
    rawPermissionCodes,
  };
}

export async function requireLogin(): Promise<
  { ok: true; user: AuthedUser } | { ok: false; status: number; message: string }
> {
  const user = await getAuthedUser();
  if (!user) {
    return { ok: false, status: 401, message: "未登录或会话已过期" };
  }
  return { ok: true, user };
}

export async function requirePermission(
  code: string,
): Promise<
  | { ok: true; user: AuthedUser }
  | { ok: false; status: number; message: string }
> {
  const r = await requireLogin();
  if (!r.ok) return r;
  if (r.user.isAdmin || r.user.permissionCodes.has(code)) {
    return { ok: true, user: r.user };
  }
  return { ok: false, status: 403, message: "没有操作权限" };
}

/** 满足任一权限即可（用于物料页加载供应商下拉等与 supplier.view 重叠的场景） */
export async function requirePermissionSome(
  codes: readonly string[],
): Promise<
  | { ok: true; user: AuthedUser }
  | { ok: false; status: number; message: string }
> {
  const r = await requireLogin();
  if (!r.ok) return r;
  if (r.user.isAdmin) return { ok: true, user: r.user };
  if (codes.some((c) => r.user.permissionCodes.has(c))) {
    return { ok: true, user: r.user };
  }
  return { ok: false, status: 403, message: "没有操作权限" };
}
