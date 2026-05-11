import { prisma } from "@/lib/prisma";
import {
  applyWorkbenchFormToStored,
  defaultWorkbenchSettings,
  parseStoredWorkbenchSettings,
  parseWorkbenchSettingsFormBody,
  toWorkbenchJsonValue,
  type WorkbenchSettings,
} from "@/lib/workbench-settings";

const SYSTEM_ID = "default";

/**
 * 系统级阈值/对账起始日 + 当前用户「对帐完成」记录，供首页与设置弹窗使用
 */
export async function getWorkbenchSettingsForUser(
  userId: string,
): Promise<WorkbenchSettings> {
  const [sys, u] = await Promise.all([
    prisma.systemWorkbenchSettings.findUnique({ where: { id: SYSTEM_ID } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { workbenchSettings: true },
    }),
  ]);
  const global = parseStoredWorkbenchSettings(sys?.data ?? null);
  const userPart = parseStoredWorkbenchSettings(u?.workbenchSettings ?? null);
  return {
    ...global,
    reconcileAck: { ...global.reconcileAck, ...userPart.reconcileAck },
  };
}

/**
 * 仅更新全系统工作台（交期档位、对账起始日）；不修改各用户「对帐完成」记录
 */
export async function saveGlobalWorkbenchFromFormBody(
  body: unknown,
): Promise<
  | { ok: true; settings: WorkbenchSettings }
  | { ok: false; error: string }
> {
  const parsed = parseWorkbenchSettingsFormBody(body);
  if (!parsed.ok) return parsed;
  const row = await prisma.systemWorkbenchSettings.findUnique({
    where: { id: SYSTEM_ID },
  });
  const current = parseStoredWorkbenchSettings(row?.data ?? null);
  const base: WorkbenchSettings = {
    ...defaultWorkbenchSettings(),
    ...current,
    reconcileAck: {},
  };
  const next = applyWorkbenchFormToStored(base, parsed.value);
  const data = toWorkbenchJsonValue({
    ...next,
    reconcileAck: {},
  });
  await prisma.systemWorkbenchSettings.upsert({
    where: { id: SYSTEM_ID },
    create: { id: SYSTEM_ID, data },
    update: { data },
  });
  return { ok: true, settings: next };
}
