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

/** 仅「自加工」商品可经出货预检进入补产/扣料；外发、外发+自加工须先办成品入库 */
export function productAllowsShipmentInhouseBackfill(mode: ProductProcessingMode): boolean {
  return mode === "INHOUSE";
}

/** 销售出货时自加工补产 / 扣料：仅厂内自加工相关 BOM 行 */
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
