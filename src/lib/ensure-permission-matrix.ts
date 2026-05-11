import { prisma } from "@/lib/prisma";
import {
  MATRIX_ROLE_ORDER,
  PERMISSION_DEFINITIONS,
  defaultMatrixForRole,
  type StaffRole,
} from "@/lib/permissions";

/**
 * 代码新增 tab.* 权限后，自动补齐权限定义与角色矩阵缺失行。
 * 只创建缺失项，不覆盖管理员已调整过的 enabled 状态。
 */
export async function ensurePermissionMatrixDefinitions() {
  for (const p of PERMISSION_DEFINITIONS) {
    await prisma.permissionDef.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        name: p.name,
        module: p.module,
        sortOrder: p.sortOrder,
      },
      update: {
        name: p.name,
        module: p.module,
        sortOrder: p.sortOrder,
      },
    });
  }

  const defs = await prisma.permissionDef.findMany({
    where: { code: { startsWith: "tab." } },
  });
  for (const role of MATRIX_ROLE_ORDER as readonly StaffRole[]) {
    const defaults = defaultMatrixForRole(role);
    for (const def of defs) {
      await prisma.rolePermissionMatrix.upsert({
        where: {
          role_permissionId: {
            role,
            permissionId: def.id,
          },
        },
        create: {
          role,
          permissionId: def.id,
          enabled: defaults.has(def.code),
        },
        update: {},
      });
    }
  }
}
