import type { WarehouseDeliveryDraft } from "@/lib/warehouse-delivery-draft";
import {
  buildLineOrderIdMap,
  draftLinesForOrder,
  isMergedDeliveryDraft,
} from "@/lib/warehouse-delivery-draft";

type DeliverPreviewBody = {
  lines: { lineId: string; shipQty: number }[];
  inhouseProduceByLineId?: Record<string, number>;
  hybridInhouseProduceByLineId?: Record<string, number>;
};

type DeliverPreviewResult = {
  needsInhouseStep: boolean;
  lines: unknown[];
};

export async function runMergedDeliverPreview(
  draft: WarehouseDeliveryDraft,
  fetchPreview: (
    orderId: string,
    body: DeliverPreviewBody,
  ) => Promise<DeliverPreviewResult>,
): Promise<DeliverPreviewResult> {
  if (!isMergedDeliveryDraft(draft)) {
    throw new Error("非合并出货草稿");
  }
  const orderIds = draft.orderIds ?? [];
  const mergedLines: unknown[] = [];
  let needsInhouseStep = false;
  for (const orderId of orderIds) {
    const lines = draftLinesForOrder(draft, orderId).map((l) => ({
      lineId: l.lineId,
      shipQty: l.shipQty,
    }));
    if (lines.length === 0) continue;
    const inhouseProduceByLineId: Record<string, number> = {};
    const hybridInhouseProduceByLineId: Record<string, number> = {};
    for (const l of lines) {
      const inh = draft.inhouseProduceByLineId?.[l.lineId];
      if (inh != null) inhouseProduceByLineId[l.lineId] = inh;
      const hyb = draft.hybridInhouseProduceByLineId?.[l.lineId];
      if (hyb != null) hybridInhouseProduceByLineId[l.lineId] = hyb;
    }
    const res = await fetchPreview(orderId, {
      lines,
      ...(Object.keys(inhouseProduceByLineId).length
        ? { inhouseProduceByLineId }
        : {}),
      ...(Object.keys(hybridInhouseProduceByLineId).length
        ? { hybridInhouseProduceByLineId }
        : {}),
    });
    if (res.needsInhouseStep) needsInhouseStep = true;
    mergedLines.push(...res.lines);
  }
  return { needsInhouseStep, lines: mergedLines };
}

export function buildMergedDeliveryDraft(input: {
  orders: { id: string; lines: { id: string }[] }[];
  actualDeliveredAt: string;
  lines: WarehouseDeliveryDraft["lines"];
  inhouseProduceByLineId?: Record<string, number>;
  hybridInhouseProduceByLineId?: Record<string, number>;
  needsInhouseStep?: boolean;
}): WarehouseDeliveryDraft {
  const orderIds = input.orders.map((o) => o.id);
  return {
    orderId: orderIds[0]!,
    mergedShip: orderIds.length > 1,
    orderIds,
    lineOrderIdByLineId: buildLineOrderIdMap(input.orders),
    actualDeliveredAt: input.actualDeliveredAt,
    lines: input.lines,
    inhouseProduceByLineId: input.inhouseProduceByLineId,
    hybridInhouseProduceByLineId: input.hybridInhouseProduceByLineId,
    needsInhouseStep: input.needsInhouseStep,
  };
}

export function pickInhouseMapsForOrder(
  draft: WarehouseDeliveryDraft,
  orderId: string,
): {
  inhouseProduceByLineId?: Record<string, number>;
  hybridInhouseProduceByLineId?: Record<string, number>;
} {
  const lineIds = new Set(
    draftLinesForOrder(draft, orderId).map((l) => l.lineId),
  );
  const inhouseProduceByLineId: Record<string, number> = {};
  const hybridInhouseProduceByLineId: Record<string, number> = {};
  for (const id of lineIds) {
    const inh = draft.inhouseProduceByLineId?.[id];
    if (inh != null) inhouseProduceByLineId[id] = inh;
    const hyb = draft.hybridInhouseProduceByLineId?.[id];
    if (hyb != null) hybridInhouseProduceByLineId[id] = hyb;
  }
  return {
    ...(Object.keys(inhouseProduceByLineId).length
      ? { inhouseProduceByLineId }
      : {}),
    ...(Object.keys(hybridInhouseProduceByLineId).length
      ? { hybridInhouseProduceByLineId }
      : {}),
  };
}
