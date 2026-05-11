import type { WarehouseDeliveryDraft, WarehouseDeliveryLineDraft } from "@/lib/warehouse-delivery-draft";

type LineForPreview = {
  id: string;
  quantity: number;
  quantityShipped: number;
  shipHistory?: {
    at: string;
    /** 本批总出库（实出+备品） */
    qty: number;
    /** 本批备品；与 qty 同时存在时，实出(表身数量)= qty - spareQty */
    spareQty?: number;
    deliveryNoteNo?: string | null;
  }[];
};

type OrderForPreview = {
  id: string;
  actualDeliveredAt: string | null;
  lines: LineForPreview[];
};

/** 从任一行本批 shipHistory 条目中取已存档的送货单号（各 line 同批应一致） */
export function getDeliveryNoteNoForBatchAt(
  order: OrderForPreview,
  batchAt: string,
): string | null {
  for (const line of order.lines) {
    for (const h of line.shipHistory ?? []) {
      if (h.at === batchAt) {
        const n = h.deliveryNoteNo?.trim();
        if (n) return n;
      }
    }
  }
  return null;
}

/** 全单去重、按时间升序的各批「出货时间 at」（同一波出货多行 at 相同） */
export function listUniqueShipmentBatchAts(order: OrderForPreview): string[] {
  const s = new Set<string>();
  for (const line of order.lines) {
    for (const h of line.shipHistory ?? []) {
      s.add(h.at);
    }
  }
  return Array.from(s).sort();
}

/**
 * 根据 URL `batch` 解析批次下标，限制在 0..len-1。
 * 无参或空串时默认可选「最早一批=0」或「最近一批=len-1」；出货查询未带 `batch` 时按最近一批打开。
 */
export function parseShipmentBatchIndex(
  batchAts: string[],
  batchParam: string | null,
  defaultToLatest: boolean = true,
): number {
  if (batchAts.length === 0) return 0;
  if (batchParam == null || batchParam === "") {
    return defaultToLatest ? batchAts.length - 1 : 0;
  }
  const raw = parseInt(batchParam, 10);
  const n = Number.isNaN(raw) ? (defaultToLatest ? batchAts.length - 1 : 0) : raw;
  return Math.min(Math.max(0, n), batchAts.length - 1);
}

/**
 * 按指定批次 `batchAt` 还原本批行数量与「本批前累计出货」（备注/超量用）。
 */
export function buildShipmentQueryPreviewForBatchAt(
  order: OrderForPreview,
  batchAt: string,
):
  | {
      draft: WarehouseDeliveryDraft;
      effShippedBeforeByLineId: Map<string, number>;
    }
  | null {
  const lineDrafts: WarehouseDeliveryLineDraft[] = [];
  const eff = new Map<string, number>();
  for (const line of order.lines) {
    let beforeMain = 0;
    for (const h of line.shipHistory ?? []) {
      if (h.at < batchAt) {
        const spare = Math.max(0, Math.trunc(h.spareQty ?? 0));
        const total = Math.max(0, Math.trunc(h.qty));
        beforeMain += total - Math.min(spare, total);
      }
    }
    let thisMain = 0;
    let thisSpare = 0;
    for (const h of line.shipHistory ?? []) {
      if (h.at === batchAt) {
        const spare = Math.max(0, Math.trunc(h.spareQty ?? 0));
        const total = Math.max(0, Math.trunc(h.qty));
        const s = Math.min(spare, total);
        thisMain += total - s;
        thisSpare += s;
      }
    }
    if (thisMain + thisSpare > 0) {
      lineDrafts.push({
        lineId: line.id,
        shipQty: thisMain,
        ...(thisSpare > 0 ? { spareQty: thisSpare } : {}),
      });
      eff.set(line.id, beforeMain);
    }
  }
  if (lineDrafts.length === 0) return null;
  return {
    draft: {
      orderId: order.id,
      actualDeliveredAt: batchAt,
      lines: lineDrafts,
    },
    effShippedBeforeByLineId: eff,
  };
}

/**
 * 无 shipHistory、仅有累计已交时整单一屏；无行可展示则 null。
 */
export function buildShipmentQueryPreviewWithoutShipLogs(
  order: OrderForPreview,
):
  | {
      draft: WarehouseDeliveryDraft;
      effShippedBeforeByLineId: Map<string, number>;
    }
  | null {
  const lineDrafts: WarehouseDeliveryLineDraft[] = [];
  const eff = new Map<string, number>();
  for (const line of order.lines) {
    if (line.quantityShipped > 0) {
      lineDrafts.push({ lineId: line.id, shipQty: line.quantityShipped });
      eff.set(line.id, 0);
    }
  }
  if (lineDrafts.length === 0) return null;
  const at = order.actualDeliveredAt?.trim() || new Date().toISOString();
  return {
    draft: {
      orderId: order.id,
      actualDeliveredAt: at,
      lines: lineDrafts,
    },
    effShippedBeforeByLineId: eff,
  };
}

/**
 * 根据有无分批记录选择构建方式；有记录时 `batchAts[batchIndex]` 必须有效。
 */
export function buildShipmentQueryPreview(
  order: OrderForPreview,
  batchAts: string[],
  batchIndex: number,
):
  | {
      draft: WarehouseDeliveryDraft;
      effShippedBeforeByLineId: Map<string, number>;
    }
  | null {
  if (batchAts.length > 0) {
    const at = batchAts[Math.min(Math.max(0, batchIndex), batchAts.length - 1)];
    return buildShipmentQueryPreviewForBatchAt(order, at);
  }
  return buildShipmentQueryPreviewWithoutShipLogs(order);
}
