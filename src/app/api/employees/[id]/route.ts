import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { StaffRole } from "@prisma/client";

const patchSchema = z.object({
  employeeNo: z.string().min(1).optional(),
  loginName: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  password: z.string().min(6).optional().nullable(),
  role: z.nativeEnum(StaffRole).optional(),
  active: z.boolean().optional(),
  permissionIds: z.array(z.string()).optional(),
  avatarUrl: z.string().optional().nullable(),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("employee.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;
  const user = await prisma.user.findFirst({
    where: { id, isAdmin: false },
    include: { permissions: { include: { permission: true } } },
  });
  if (!user) {
    return NextResponse.json({ error: "员工不存在" }, { status: 404 });
  }

  return NextResponse.json({
    id: user.id,
    employeeNo: user.employeeNo,
    loginName: user.loginName,
    name: user.name,
    phone: user.phone,
    role: user.role,
    active: user.active,
    avatarUrl: user.avatarUrl,
    permissionIds: user.permissions
      .filter((p) => p.permission.code.startsWith("tab."))
      .map((p) => p.permissionId),
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("employee.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;
  const existing = await prisma.user.findFirst({ where: { id, isAdmin: false } });
  if (!existing) {
    return NextResponse.json({ error: "员工不存在" }, { status: 404 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const role = data.role ?? existing.role;

  if (data.employeeNo || data.loginName) {
    const conflict = await prisma.user.findFirst({
      where: {
        NOT: { id },
        OR: [
          ...(data.employeeNo ? [{ employeeNo: data.employeeNo }] : []),
          ...(data.loginName ? [{ loginName: data.loginName }] : []),
        ],
      },
    });
    if (conflict) {
      return NextResponse.json(
        { error: "员工编号或登录名与其他人重复" },
        { status: 400 },
      );
    }
  }

  if (data.permissionIds) {
    const valid = await validatePermissionsForRole(role, data.permissionIds);
    if (!valid.ok) {
      return NextResponse.json({ error: valid.message }, { status: 400 });
    }
  }

  let passwordHash: string | undefined;
  if (data.password) {
    passwordHash = await bcrypt.hash(data.password, 10);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        employeeNo: data.employeeNo,
        loginName: data.loginName,
        name: data.name,
        phone: data.phone === undefined ? undefined : data.phone,
        role: data.role,
        active: data.active,
        avatarUrl: data.avatarUrl === undefined ? undefined : data.avatarUrl,
        ...(passwordHash ? { passwordHash } : {}),
      },
    });

    if (data.permissionIds) {
      await tx.userPermission.deleteMany({ where: { userId: id } });
      if (data.permissionIds.length > 0) {
        await tx.userPermission.createMany({
          data: data.permissionIds.map((permissionId) => ({
            userId: id,
            permissionId,
          })),
        });
      }
    }
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("employee.delete");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;
  const existing = await prisma.user.findFirst({ where: { id, isAdmin: false } });
  if (!existing) {
    return NextResponse.json({ error: "员工不存在" }, { status: 404 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

async function validatePermissionsForRole(
  role: StaffRole,
  permissionIds: string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (permissionIds.length === 0) return { ok: true };
  const rows = await prisma.rolePermissionMatrix.findMany({
    where: {
      role,
      enabled: true,
      permissionId: { in: permissionIds },
    },
  });
  if (rows.length !== permissionIds.length) {
    return { ok: false, message: "权限与角色不匹配或未在角色矩阵中开放" };
  }
  return { ok: true };
}
