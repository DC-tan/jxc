import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  formatDeliveryDocumentNo,
  previewNextDeliveryNoteSerial,
} from "@/lib/delivery-note-sequence";

const bodySchema = z
  .object({
    orderId: z.string().min(1).optional(),
    customerId: z.string().min(1).optional(),
    atIso: z.string().optional(),
  })
  .refine((d) => d.orderId || d.customerId, {
    message: "请提供销售订单或客户",
  });

/** 预览下一送货单号（不占用流水；点「完成」时 POST allocate 才正式生效） */
export async function POST(req: Request) {
  const auth = await requirePermission("warehouse.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    /* */
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const at = parsed.data.atIso ? new Date(parsed.data.atIso) : new Date();
  if (Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: "时间无效" }, { status: 400 });
  }

  const year = at.getFullYear();

  try {
    const customerIdInput = parsed.data.customerId?.trim();
    const customer =
      customerIdInput != null
        ? await prisma.customer.findUnique({
            where: { id: customerIdInput },
            select: { id: true, code: true, name: true, shortName: true },
          })
        : null;
    const order =
      parsed.data.orderId != null
        ? await prisma.salesOrder.findUnique({
            where: { id: parsed.data.orderId.trim() },
            select: {
              customerId: true,
              customer: {
                select: { id: true, code: true, name: true, shortName: true },
              },
            },
          })
        : null;

    const c = order?.customer ?? customer;
    const customerId = order?.customerId ?? customer?.id;
    if (!c || !customerId) {
      return NextResponse.json(
        { error: order ? "销售订单不存在" : "客户不存在" },
        { status: 404 },
      );
    }

    const seq = await previewNextDeliveryNoteSerial(prisma, customerId, year);
    const documentNo = formatDeliveryDocumentNo(c, at, seq);

    return NextResponse.json({
      documentNo,
      year,
      customerId,
      seq,
      preview: true as const,
    });
  } catch (e) {
    console.error("[POST /api/delivery-note-sequence/preview]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "预览单号失败" },
      { status: 500 },
    );
  }
}
