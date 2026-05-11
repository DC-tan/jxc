import { MaterialKind, PrismaClient, StaffRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_MATERIAL_KIND_IDS } from "../src/lib/materialPresetConstants";
import {
  PERMISSION_DEFINITIONS,
  defaultMatrixForRole,
} from "../src/lib/permissions";
import {
  defaultWorkbenchSettings,
  toWorkbenchJsonValue,
} from "../src/lib/workbench-settings";

const prisma = new PrismaClient();

async function main() {
  const wbDefault = {
    ...defaultWorkbenchSettings(),
    reconcileAck: {} as const,
  };
  await prisma.systemWorkbenchSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      data: toWorkbenchJsonValue(wbDefault) as object,
    },
    update: {},
  });

  for (const p of PERMISSION_DEFINITIONS) {
    await prisma.permissionDef.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        name: p.name,
        module: p.module,
        sortOrder: p.sortOrder,
      },
      update: { name: p.name, module: p.module, sortOrder: p.sortOrder },
    });
  }
  // 保留库内旧细项码定义，新矩阵仅使用 code 为 tab. 的项

  const roles: StaffRole[] = [
    "ADMIN",
    "SALES",
    "PURCHASE",
    "MATERIAL",
    "OUTSOURCE",
    "WAREHOUSE",
  ];

  const defs = await prisma.permissionDef.findMany();

  for (const role of roles) {
    const allowed = defaultMatrixForRole(role);
    for (const def of defs) {
      const enabled = allowed.has(def.code);
      const row = await prisma.rolePermissionMatrix.findFirst({
        where: { role, permissionId: def.id },
      });
      if (row) {
        await prisma.rolePermissionMatrix.update({
          where: { id: row.id },
          data: { enabled },
        });
      } else {
        await prisma.rolePermissionMatrix.create({
          data: { role, permissionId: def.id, enabled },
        });
      }
    }
  }

  const hash = await bcrypt.hash("888888", 10);
  await prisma.user.upsert({
    where: { loginName: "admin" },
    create: {
      employeeNo: "ADMIN",
      loginName: "admin",
      name: "系统管理员",
      phone: null,
      passwordHash: hash,
      role: "ADMIN",
      isAdmin: true,
      active: true,
    },
    update: {
      passwordHash: hash,
      isAdmin: true,
      active: true,
      role: "ADMIN",
    },
  });

  const admin = await prisma.user.findUnique({ where: { loginName: "admin" } });
  if (admin) {
    const allIds = defs
      .filter((d) => d.code.startsWith("tab."))
      .map((d) => d.id);
    await prisma.userPermission.deleteMany({ where: { userId: admin.id } });
    await prisma.userPermission.createMany({
      data: allIds.map((permissionId) => ({ userId: admin.id, permissionId })),
    });
  }

  const kindSeeds: { id: string; name: string; sortOrder: number }[] = [
    { id: DEFAULT_MATERIAL_KIND_IDS.ELECTRONIC, name: "电子料", sortOrder: 0 },
    { id: DEFAULT_MATERIAL_KIND_IDS.FPC, name: "FPC", sortOrder: 1 },
    { id: DEFAULT_MATERIAL_KIND_IDS.PCB, name: "PCB", sortOrder: 2 },
    { id: DEFAULT_MATERIAL_KIND_IDS.DOME, name: "DOME", sortOrder: 3 },
    { id: DEFAULT_MATERIAL_KIND_IDS.AUXILIARY, name: "辅料", sortOrder: 4 },
    { id: DEFAULT_MATERIAL_KIND_IDS.OTHER, name: "其它", sortOrder: 5 },
  ];
  for (const k of kindSeeds) {
    await prisma.materialPresetKind.upsert({
      where: { id: k.id },
      create: { id: k.id, name: k.name, prefix: "", sortOrder: k.sortOrder },
      update: { name: k.name, sortOrder: k.sortOrder },
    });
  }

  await prisma.materialPresetUnit.upsert({
    where: { name: "PCS" },
    create: { name: "PCS", isDefault: true, sortOrder: 0 },
    update: { isDefault: true },
  });

  const mapLegacy: Record<MaterialKind, string> = {
    ELECTRONIC: DEFAULT_MATERIAL_KIND_IDS.ELECTRONIC,
    FPC: DEFAULT_MATERIAL_KIND_IDS.FPC,
    PCB: DEFAULT_MATERIAL_KIND_IDS.PCB,
    DOME: DEFAULT_MATERIAL_KIND_IDS.DOME,
    AUXILIARY: DEFAULT_MATERIAL_KIND_IDS.AUXILIARY,
    OTHER: DEFAULT_MATERIAL_KIND_IDS.OTHER,
  };

  const mats = await prisma.material.findMany({
    where: { kindId: null },
    select: { id: true, kind: true },
  });
  for (const m of mats) {
    if (m.kind == null) continue;
    const kid = mapLegacy[m.kind];
    await prisma.material.update({
      where: { id: m.id },
      data: { kindId: kid },
    });
  }

  console.log("Seed OK: 管理员 admin / 888888，权限矩阵与权限定义已写入。");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
