import { computeOutsourceLinesFromBom } from "@/lib/outsource-lines";

export type InhouseBomLineInput = {
  materialId: string;
  usageQty: string | number;
  /** 物料当前库存合计（与物料库存列表一致） */
  materialStock?: number;
  material: {
    code: string;
    name: string;
    unit: string;
    partDescription?: string | null;
  };
};

export type InhouseMaterialDisplayRow = {
  /** 物料名称-部件描述（不含系统物料编号） */
  label: string;
  unit: string;
  quantity: number;
};

/** 出货类错误提示：商品侧展示商品型号 */
export function shipmentProductModelLabel(prod: {
  model?: string | null;
}): string {
  return prod.model?.trim() || "—";
}

/** 出货类错误提示：物料侧展示部件描述（无则回退物料名称） */
export function shipmentMaterialPartLabel(material: {
  partDescription?: string | null;
  name?: string | null;
}): string {
  const part = material.partDescription?.trim();
  if (part) return part;
  return material.name?.trim() || "—";
}

/** 展示用：物料名称与部件描述以「-」连接，不含物料编号 */
export function formatInhouseMaterialLabel(
  name: string | null | undefined,
  partDescription: string | null | undefined,
): string {
  const n = (name ?? "").trim();
  const p = (partDescription ?? "").trim();
  if (n && p) return `${n}-${p}`;
  return n || p || "—";
}

/** 自加工侧：按成品套数/件数折算需扣数量（与 BOM 外发单用量取整规则一致） */
export function inhouseMaterialRowsForProductSets(
  inhouse: InhouseBomLineInput[] | undefined,
  productSets: number,
): InhouseMaterialDisplayRow[] {
  if (!inhouse?.length) return [];
  const sets = Math.max(0, Math.trunc(Number(productSets)) || 0);
  if (sets <= 0) return [];
  const computed = computeOutsourceLinesFromBom(
    inhouse.map((b) => ({
      materialId: b.materialId,
      usageQty: b.usageQty,
    })),
    sets,
  );
  return computed.map((row) => {
    const b = inhouse.find((x) => x.materialId === row.materialId);
    if (!b) {
      return {
        label: "—",
        unit: "—",
        quantity: row.quantity,
        stockQuantity: 0,
      };
    }
    return {
      label: formatInhouseMaterialLabel(
        b.material.name,
        b.material.partDescription,
      ),
      unit: b.material.unit,
      quantity: row.quantity,
      stockQuantity: Math.trunc(Number(b.materialStock ?? 0)),
    };
  });
}
