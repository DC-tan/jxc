/** 外发物料库存出入库明细：方向与数量展示（数量恒为正，方向单独标识） */

export type OutsourceStockHistoryDirection = "IN" | "OUT";

/**
 * 外发物料库存视角：
 * - 入库：外发至加工方的料（外发出库）
 * - 出库：回收后加工消耗、结单损耗、退料等离开在外库存
 */
export function outsourceMaterialFlowDirection(
  partDescription: string,
): OutsourceStockHistoryDirection {
  const desc = partDescription.trim();
  if (
    desc.startsWith("外发出库（") ||
    desc.startsWith("外发出库调整（") ||
    desc.startsWith("外发结单退回（")
  ) {
    return "IN";
  }
  if (
    desc.startsWith("外发加工回收消耗（") ||
    desc.startsWith("外发结单损耗（") ||
    desc.startsWith("外发库存退料（")
  ) {
    return "OUT";
  }
  return "OUT";
}

export function outsourceMaterialFlowQuantity(rawQty: number): number {
  return Math.abs(Math.trunc(Number(rawQty) || 0));
}
