import type {
  ProductBomLineScope,
  ProductProcessingMode,
} from "@prisma/client";

type Scoped = { scope: ProductBomLineScope };

/** 外发建单、外发单回收等：仅外发相关 BOM 行 */
export function productBomForOutsource<T extends Scoped>(mode: ProductProcessingMode, materials: T[]): T[] {
  if (mode === "OUTSOURCE") {
    return materials.filter((m) => m.scope === "DEFAULT");
  }
  if (mode === "OUTSOURCE_INHOUSE") {
    return materials.filter((m) => m.scope === "OUTSOURCE");
  }
  return [];
}

/** 销售出货时自加工扣料 / 完工入库：仅厂内自加工相关 BOM 行 */
export function productBomForInhouseProduction<T extends Scoped>(
  mode: ProductProcessingMode,
  materials: T[],
): T[] {
  if (mode === "INHOUSE") {
    return materials.filter((m) => m.scope === "DEFAULT");
  }
  if (mode === "OUTSOURCE_INHOUSE") {
    return materials.filter((m) => m.scope === "INHOUSE");
  }
  return [];
}
