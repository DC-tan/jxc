/** 与 Prisma `CustomerQuality` 枚举值保持一致 */
export const CUSTOMER_QUALITY_LABEL = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
  POOR: "差",
} as const;

export type CustomerQuality = keyof typeof CUSTOMER_QUALITY_LABEL;
