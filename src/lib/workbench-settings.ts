import { z } from "zod";
import {
  DEFAULT_URGENCY_THRESHOLDS,
  type UrgencyThresholds,
} from "@/lib/dashboard-urgency";

export type ReconcileAck = {
  /** 与供应商对帐：上次标记完成的自然月 "YYYY-MM" */
  supplier?: string;
  /** 客户/仓出货对帐 */
  customer?: string;
  /** 仅统计综合权限 */
  other?: string;
};

export type ReconcilePromptSettings = {
  /** 每月几号起对具备采购权限的账号显示对帐提醒（1～31） */
  supplierReconcileStartDay: number;
  customerReconcileStartDay: number;
  otherReconcileStartDay: number;
};

export type WorkbenchSettings = UrgencyThresholds &
  ReconcilePromptSettings & {
    reconcileAck: ReconcileAck;
  };

const DEFAULT_RECONCILE: ReconcilePromptSettings = {
  supplierReconcileStartDay: 8,
  customerReconcileStartDay: 25,
  otherReconcileStartDay: 1,
};

const formSchema = z
  .object({
    urgentRedMaxDays: z.number().int().min(0).max(365),
    lightRedMaxDays: z.number().int().min(0).max(365),
    yellowMaxDays: z.number().int().min(0).max(365),
    supplierReconcileStartDay: z.number().int().min(1).max(31),
    customerReconcileStartDay: z.number().int().min(1).max(31),
    otherReconcileStartDay: z.number().int().min(1).max(31),
  })
  .refine((v) => v.lightRedMaxDays >= v.urgentRedMaxDays, {
    message: "「浅红」上限须不小于「深红(逾期/紧急)」上限",
    path: ["lightRedMaxDays"],
  })
  .refine((v) => v.yellowMaxDays >= v.lightRedMaxDays, {
    message: "「黄档」上限须不小于「浅红」上限",
    path: ["yellowMaxDays"],
  });

function parseReconcileAck(raw: unknown): ReconcileAck {
  if (raw == null || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: ReconcileAck = {};
  for (const k of ["supplier", "customer", "other"] as const) {
    if (typeof o[k] === "string" && /^\d{4}-\d{2}$/.test(o[k] as string)) {
      out[k] = o[k] as string;
    }
  }
  return out;
}

export function defaultWorkbenchSettings(): WorkbenchSettings {
  return {
    ...DEFAULT_URGENCY_THRESHOLDS,
    ...DEFAULT_RECONCILE,
    reconcileAck: {},
  };
}

function mergePartials(
  base: WorkbenchSettings,
  raw: unknown,
): WorkbenchSettings {
  if (raw == null || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const next: WorkbenchSettings = { ...base };

  const hasNewUrgency = typeof o.urgentRedMaxDays === "number";
  if (
    !hasNewUrgency &&
    (typeof o.redMaxDays === "number" || typeof o.yellowMaxDays === "number")
  ) {
    const ur =
      typeof o.redMaxDays === "number"
        ? Math.round(o.redMaxDays as number)
        : next.urgentRedMaxDays;
    const oldY =
      typeof o.yellowMaxDays === "number"
        ? Math.round(o.yellowMaxDays as number)
        : 6;
    next.urgentRedMaxDays = ur;
    next.lightRedMaxDays = oldY;
    next.yellowMaxDays = Math.min(365, oldY + 2);
  } else {
    if (
      typeof o.urgentRedMaxDays === "number" &&
      Number.isFinite(o.urgentRedMaxDays)
    ) {
      next.urgentRedMaxDays = Math.round(o.urgentRedMaxDays);
    }
    if (
      typeof o.lightRedMaxDays === "number" &&
      Number.isFinite(o.lightRedMaxDays)
    ) {
      next.lightRedMaxDays = Math.round(o.lightRedMaxDays);
    }
    if (
      typeof o.yellowMaxDays === "number" &&
      Number.isFinite(o.yellowMaxDays)
    ) {
      next.yellowMaxDays = Math.round(o.yellowMaxDays);
    }
  }

  if (typeof o.supplierReconcileStartDay === "number" && Number.isFinite(o.supplierReconcileStartDay)) {
    next.supplierReconcileStartDay = Math.min(31, Math.max(1, Math.round(o.supplierReconcileStartDay)));
  }
  if (typeof o.customerReconcileStartDay === "number" && Number.isFinite(o.customerReconcileStartDay)) {
    next.customerReconcileStartDay = Math.min(31, Math.max(1, Math.round(o.customerReconcileStartDay)));
  }
  if (typeof o.otherReconcileStartDay === "number" && Number.isFinite(o.otherReconcileStartDay)) {
    next.otherReconcileStartDay = Math.min(31, Math.max(1, Math.round(o.otherReconcileStartDay)));
  }

  next.reconcileAck = {
    ...base.reconcileAck,
    ...parseReconcileAck(o.reconcileAck),
  };

  if (next.lightRedMaxDays < next.urgentRedMaxDays) {
    next.lightRedMaxDays = next.urgentRedMaxDays;
  }
  if (next.yellowMaxDays < next.lightRedMaxDays) {
    next.yellowMaxDays = next.lightRedMaxDays;
  }

  return next;
}

/**
 * 从数据库 JSON 与默认值合并。兼容仅含 `redMaxDays`/`yellowMaxDays` 的旧 data；
 * 对帐自「每月起始日 + 完成态」的字段在缺失时使用默认。
 */
export function parseStoredWorkbenchSettings(raw: unknown | null): WorkbenchSettings {
  return mergePartials(defaultWorkbenchSettings(), raw);
}

export function parseWorkbenchSettingsFormBody(
  raw: unknown,
):
  | { ok: true; value: UrgencyThresholds & ReconcilePromptSettings }
  | { ok: false; error: string } {
  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "参数无效";
    return { ok: false, error: msg };
  }
  return { ok: true, value: parsed.data };
}

/** 合并表单保存，保留对帐完成记录 `reconcileAck` */
export function applyWorkbenchFormToStored(
  current: WorkbenchSettings,
  form: UrgencyThresholds & ReconcilePromptSettings,
): WorkbenchSettings {
  return {
    ...current,
    ...form,
    reconcileAck: current.reconcileAck,
  };
}

export function toWorkbenchJsonValue(wb: WorkbenchSettings): object {
  return {
    urgentRedMaxDays: wb.urgentRedMaxDays,
    lightRedMaxDays: wb.lightRedMaxDays,
    yellowMaxDays: wb.yellowMaxDays,
    supplierReconcileStartDay: wb.supplierReconcileStartDay,
    customerReconcileStartDay: wb.customerReconcileStartDay,
    otherReconcileStartDay: wb.otherReconcileStartDay,
    reconcileAck: wb.reconcileAck,
  };
}
