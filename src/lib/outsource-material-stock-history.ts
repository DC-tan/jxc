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

type HistoryBalanceInput = {
  id: string;
  receivedAt: string;
  direction: OutsourceStockHistoryDirection;
  quantity: number;
};

/**
 * 按时间正序累加出入库，得到每条记录发生后的结余；返回顺序与入参一致（通常为时间倒序展示）。
 */
export function withOutsourceStockHistoryBalance<T extends HistoryBalanceInput>(
  rows: T[],
): (T & { balanceAfter: number })[] {
  const chrono = [...rows].sort((a, b) => {
    const ta = new Date(a.receivedAt).getTime();
    const tb = new Date(b.receivedAt).getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
  let bal = 0;
  const byId = new Map<string, number>();
  for (const r of chrono) {
    const qty = Math.max(0, Math.trunc(Number(r.quantity) || 0));
    bal += r.direction === "IN" ? qty : -qty;
    byId.set(r.id, bal);
  }
  return rows.map((r) => ({
    ...r,
    balanceAfter: byId.get(r.id) ?? 0,
  }));
}
