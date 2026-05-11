import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/api-auth";
import { ROLE_LABELS } from "@/lib/permissions";

export async function GET() {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  return NextResponse.json({
    id: user.id,
    name: user.name,
    loginName: user.loginName,
    employeeNo: user.employeeNo,
    avatarUrl: user.avatarUrl,
    isAdmin: user.isAdmin,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role],
    permissions: Array.from(user.permissionCodes),
    rawPermissions: Array.from(user.rawPermissionCodes),
  });
}
