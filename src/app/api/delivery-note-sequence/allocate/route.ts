import { NextResponse } from "next/server";
import { z } from "zod";
import dayjs from "dayjs";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  allocateDeliveryNoteSerial,
  resolveCustomerShortLabel,
} from "@/lib/delivery-note-sequence";

const bodySchema = z.object({
  orderId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  /** 以该时间所在自然年作流水年；与送货单日期一致 */
  atIso: z.string().optional(),
}).refine((d) => d.orderId || d.customerId, {
  message: "请提供销售订单或客户",
});

/**
 * 分配送货单号：{客户简称}{YYYYMMDD}{三位年流水}
 * 无连字符；年流水按客户 + 自然年重置；有历史出货单从最大流水续编（如已有 005 则下一张 006）
 */
export async function POST(req: Request) {
  const auth = await requirePermission("warehouse.edit");
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

  const at = parsed.data.atIso
    ? new Date(parsed.data.atIso)
    : new Date();
  if (Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: "时间无效" }, { status: 400 });
  }

  const year = at.getFullYear();
  const d = dayjs(at);

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

    const seq = await allocateDeliveryNoteSerial(prisma, customerId, year);

    const seqPadded = String(seq).padStart(3, "0");
    const shortLabel = resolveCustomerShortLabel(c);

    const documentNo = `${shortLabel}${d.format("YYYYMMDD")}${seqPadded}`;

    return NextResponse.json({
      documentNo,
      year,
      customerId,
      seq,
    });
  } catch (e) {
    console.error("[POST /api/delivery-note-sequence/allocate]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "分配单号失败" },
      { status: 500 },
    );
  }
}
