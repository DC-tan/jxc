/**
 * 本月从「今天」到「本月自然末日」之间的天数（不含更晚）。例：1 月 30 日 → 1 天（仅 31 日还在本月）。
 * 与「还有几天到月底」的口语一致。
 */
export function daysFromTodayToEndOfCurrentMonth(today: Date = new Date()): number {
  const y = today.getFullYear();
  const m = today.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  return lastDay - today.getDate();
}

export function dayOfCurrentMonth(today: Date = new Date()): number {
  return today.getDate();
}

/** 自然月 YYYY-MM，用于对帐完成一次一清。 */
export function yearMonthOf(today: Date = new Date()): string {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  return `${y}-${m < 10 ? `0${m}` : m}`;
}

/**
 * 设置里「每月 X 号起」提示；若 X 大于本月天数（如 31 在 2 月），则视为从本月最后一天起。
 */
export function effectiveReconcileStartDay(startDay: number, today: Date = new Date()): number {
  const cap = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  ).getDate();
  return Math.min(Math.max(1, startDay), cap);
}

export function isOnOrAfterReconcileStartDay(
  startDay: number,
  today: Date = new Date(),
): boolean {
  return today.getDate() >= effectiveReconcileStartDay(startDay, today);
}
