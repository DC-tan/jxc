/** 与 Prisma `MaterialKind` 枚举值保持一致 */
export const MATERIAL_KIND_LABEL = {
  ELECTRONIC: "电子料",
  FPC: "FPC",
  PCB: "PCB",
  DOME: "DOME",
  AUXILIARY: "辅料",
  OTHER: "其它",
} as const;

export type MaterialKind = keyof typeof MATERIAL_KIND_LABEL;
