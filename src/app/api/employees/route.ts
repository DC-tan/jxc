import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { StaffRole } from "@prisma/client";

const createSchema = z.object({
  employeeNo: z.string().min(1, "请填写员工编号"),
  loginName: z.string().min(1, "请填写登录名"),
  name: z.string().min(1, "请填写姓名"),
  phone: z.string().optional().nullable(),
  password: z.string().min(6, "密码至少6位"),
  role: z.nativeEnum(StaffRole),
  permissionIds: z.array(z.string()).default([]),
  avatarUrl: z.string().optional().nullable(),
});

export async function GET() {
  const auth = await requirePermission("employee.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const users = await prisma.user.findMany({
    where: { isAdmin: false },
    orderBy: { createdAt: "desc" },
    include: {
      permissions: { include: { permission: true } },
    },
  });

  return NextResponse.json({
    list: users.map((u) => ({
      id: u.id,
      employeeNo: u.employeeNo,
      loginName: u.loginName,
      name: u.name,
      phone: u.phone,
      role: u.role,
      active: u.active,
      avatarUrl: u.avatarUrl,
      permissions: u.permissions.map((p) => ({
        id: p.permission.id,
        code: p.permission.code,
        name: p.permission.name,
      })),
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requirePermission("employee.create");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const {
    employeeNo,
    loginName,
    name,
    phone,
    password,
    role,
    permissionIds,
    avatarUrl,
  } = parsed.data;

  const exists = await prisma.user.findFirst({
    where: {
      OR: [{ employeeNo }, { loginName }],
    },
  });
  if (exists) {
    return NextResponse.json(
      { error: "员工编号或登录名已存在" },
      { status: 400 },
    );
  }

  const valid = await validatePermissionsForRole(role, permissionIds);
  if (!valid.ok) {
    return NextResponse.json({ error: valid.message }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      employeeNo,
      loginName,
      name,
      phone: phone ?? null,
      passwordHash,
      role,
      isAdmin: false,
      active: true,
      avatarUrl: avatarUrl ?? null,
      permissions: {
        create: permissionIds.map((permissionId) => ({ permissionId })),
      },
    },
  });

  return NextResponse.json({ id: user.id });
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
