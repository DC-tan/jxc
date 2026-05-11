import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { ensurePermissionMatrixDefinitions } from "@/lib/ensure-permission-matrix";
import {
  MATRIX_ROLE_ORDER,
  ROLE_LABELS,
  isMatrixPermissionCode,
  type StaffRole,
} from "@/lib/permissions";

export async function GET() {
  const auth = await requirePermission("permission.manage");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  await ensurePermissionMatrixDefinitions();

  const [defs, matrix] = await Promise.all([
    prisma.permissionDef.findMany({
      where: { code: { startsWith: "tab." } },
      orderBy: [{ module: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.rolePermissionMatrix.findMany({
      where: { permission: { code: { startsWith: "tab." } } },
      include: { permission: true },
    }),
  ]);

  return NextResponse.json({
    permissions: defs.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      module: d.module,
      sortOrder: d.sortOrder,
    })),
    roles: MATRIX_ROLE_ORDER.map((r) => ({
      key: r,
      label: ROLE_LABELS[r as StaffRole],
    })),
    matrix: matrix
      .filter((m) => isMatrixPermissionCode(m.permission.code))
      .map((m) => ({
        id: m.id,
        role: m.role,
        permissionId: m.permissionId,
        enabled: m.enabled,
      })),
  });
}

export async function PUT(req: Request) {
  const auth = await requirePermission("permission.manage");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: { updates?: { id: string; enabled: boolean }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const updates = body.updates ?? [];
  await prisma.$transaction(async (tx) => {
    const rows = await tx.rolePermissionMatrix.findMany({
      where: { id: { in: updates.map((u) => u.id) } },
      select: { id: true, role: true, permissionId: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    for (const u of updates) {
      const row = byId.get(u.id);
      await tx.rolePermissionMatrix.update({
        where: { id: u.id },
        data: { enabled: u.enabled },
      });
      if (!u.enabled && row) {
        await tx.userPermission.deleteMany({
          where: {
            permissionId: row.permissionId,
            user: { role: row.role, isAdmin: false },
          },
        });
      }
    }
  });

  return NextResponse.json({ ok: true });
}
