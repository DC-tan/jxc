import { z } from "zod";

export type DeliveryNoteLiveSlipLine = {
  orderNo: string;
  materialCode: string;
  nameSpec: string;
  unit: string;
  quantity: string;
  remark: string;
};

export type DeliveryNoteLiveSlip = {
  customerName: string;
  dateStr: string;
  documentNo: string;
  issuerName: string;
  lines: DeliveryNoteLiveSlipLine[];
};

export const deliveryNoteVoucherLineSchema = z.object({
  orderNo: z.string(),
  materialCode: z.string(),
  nameSpec: z.string(),
  unit: z.string(),
  quantity: z.string(),
  remark: z.string(),
});

export const deliveryNoteVoucherSnapshotSchema = z.object({
  customerName: z.string(),
  dateStr: z.string(),
  documentNo: z.string(),
  issuerName: z.string(),
  lines: z.array(deliveryNoteVoucherLineSchema).min(1),
  orderIds: z.array(z.string()).optional(),
});

export type DeliveryNoteVoucherSnapshot = z.infer<
  typeof deliveryNoteVoucherSnapshotSchema
>;

export function liveSlipToVoucherSnapshot(
  slip: DeliveryNoteLiveSlip,
  orderIds?: string[],
): DeliveryNoteVoucherSnapshot {
  return {
    customerName: slip.customerName,
    dateStr: slip.dateStr,
    documentNo: slip.documentNo,
    issuerName: slip.issuerName,
    lines: slip.lines.map((l) => ({
      orderNo: l.orderNo,
      materialCode: l.materialCode,
      nameSpec: l.nameSpec,
      unit: l.unit,
      quantity: l.quantity,
      remark: l.remark,
    })),
    ...(orderIds?.length ? { orderIds } : {}),
  };
}

export function voucherSnapshotToLiveSlip(
  snapshot: DeliveryNoteVoucherSnapshot,
): DeliveryNoteLiveSlip {
  return {
    customerName: snapshot.customerName,
    dateStr: snapshot.dateStr,
    documentNo: snapshot.documentNo,
    issuerName: snapshot.issuerName,
    lines: snapshot.lines.map((l) => ({ ...l })),
  };
}

export function parseDeliveryNoteVoucherSnapshot(
  raw: unknown,
): DeliveryNoteVoucherSnapshot | null {
  const parsed = deliveryNoteVoucherSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
