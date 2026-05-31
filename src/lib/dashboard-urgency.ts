/**
 * 距「约定交货日」的天数：可为负（已逾期），按自然日 0 点起算。
 */
export function daysUntilCalendarDue(due: Date, now = new Date()): number {
  const n = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  return Math.round((d.getTime() - n.getTime()) / 86400000);
}

/**
 * 四档分色（距交期天数界）：逾期/紧急(深红) ≤A；浅红 (A,B]；黄 (B,C]；蓝 >C。
 * 与默认工作台设一致时：1 / 3 / 5 天为界（含已逾期在「≤A」中）。
 */
export type UrgencyThresholds = {
  urgentRedMaxDays: number;
  lightRedMaxDays: number;
  yellowMaxDays: number;
};

export const DEFAULT_URGENCY_THRESHOLDS: UrgencyThresholds = {
  urgentRedMaxDays: 1,
  lightRedMaxDays: 3,
  yellowMaxDays: 5,
};

export type UrgencyBucket = "deepRed" | "lightRed" | "yellow" | "blue" | "gray";

/** 行底色为固定样式，不随个人设置；灰档用于无交期等 */
export const ROW_BACKGROUND: Record<Exclude<UrgencyBucket, never>, string> = {
  deepRed: "#ffd4d4",
  lightRed: "#fff1f0",
  yellow: "#feffe6",
  blue: "#e6f7ff",
  gray: "#fafafa",
};

/**
 * 看板行紧急度分档。`days` 为距约定日/交期的自然日差（可负=已逾期）。
 */
export function urgencyBucket(
  days: number,
  t: UrgencyThresholds = DEFAULT_URGENCY_THRESHOLDS,
): "deepRed" | "lightRed" | "yellow" | "blue" {
  if (days <= t.urgentRedMaxDays) return "deepRed";
  if (days <= t.lightRedMaxDays) return "lightRed";
  if (days <= t.yellowMaxDays) return "yellow";
  return "blue";
}

/**
 * 与「从销售建采购」向导一致：无有效采购、或存在未收料确认的有效采购时，仍可从本单建采购或跟进。
 */
export function salesOrderStillNeedsPurchase(
  purchaseStatuses: { status: string }[],
): boolean {
  const active = purchaseStatuses
    .map((p) => p.status)
    .filter((s) => s !== "CANCELLED");
  if (active.length === 0) return true;
  return active.some((s) => s !== "CONFIRMED");
}

