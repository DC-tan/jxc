import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireLogin } from "@/lib/api-auth";
import { ensurePermissionMatrixDefinitions } from "@/lib/ensure-permission-matrix";
import { STAFF_ROLE_KEYS, type StaffRole } from "@/lib/permissions";

const querySchema = z.object({
  role: z
    .string()
    .refine((v): v is StaffRole =>
      (STAFF_ROLE_KEYS as readonly string[]).includes(v),
    ),
});

/** 根据角色返回「权限管理」矩阵中已启用的权限，用于员工档案勾选 */
export async function GET(req: Request) {
  const auth = await requireLogin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    role: searchParams.get("role") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "缺少或无效的角色参数" }, { status: 400 });
  }

  const { role } = parsed.data;
  await ensurePermissionMatrixDefinitions();

  const rows = await prisma.rolePermissionMatrix.findMany({
    where: {
      role,
      enabled: true,
      permission: { code: { startsWith: "tab." } },
    },
    include: { permission: true },
    orderBy: { permission: { sortOrder: "asc" } },
  });

  return NextResponse.json({
    permissions: rows.map((r) => ({
      id: r.permission.id,
      code: r.permission.code,
      name: r.permission.name,
      module: r.permission.module,
    })),
  });
}
