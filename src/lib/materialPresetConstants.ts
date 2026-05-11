/** 与 prisma seed / 数据迁移中的预设种类 id 一致 */
export const DEFAULT_MATERIAL_KIND_IDS = {
  ELECTRONIC: "mk_preset_electronic",
  FPC: "mk_preset_fpc",
  PCB: "mk_preset_pcb",
  DOME: "mk_preset_dome",
  AUXILIARY: "mk_preset_auxiliary",
  OTHER: "mk_preset_other",
} as const;
