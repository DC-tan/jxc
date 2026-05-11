import { NextResponse } from "next/server";
import { z } from "zod";
import dayjs from "dayjs";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const bodySchema = z.object({
  orderId: z.string().min(1),
  /** 以该时间所在自然年作流水年；与送货单日期一致 */
  atIso: z.string().optional(),
});

/**
 * 分配送货单号：{客户简称}{YYYYMMDD}{三位年流水}
 * 无连字符；年流水按自然年重置，自 001 起每单 +1（如 APS20260424001）
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
    const order = await prisma.salesOrder.findUnique({
      where: { id: parsed.data.orderId },
      include: { customer: { select: { code: true, name: true, shortName: true } } },
    });
    if (!order) {
      return NextResponse.json({ error: "销售订单不存在" }, { status: 404 });
    }

    const row = await prisma.deliveryNoteSerial.upsert({
      where: { year },
      create: { year, lastSeq: 1 },
      update: { lastSeq: { increment: 1 } },
    });

    const seqPadded = String(row.lastSeq).padStart(3, "0");
    const c = order.customer;
    const rawLabel =
      c.shortName?.trim() ||
      c.name?.trim().replace(/\s+/g, "").slice(0, 4) ||
      c.code?.trim() ||
      "K";
    /** 单号内不用连字符等分隔符，避免与流水、日期混淆 */
    const shortLabel = rawLabel.replace(/[-\s_/\\]+/g, "") || "K";

    const documentNo = `${shortLabel}${d.format("YYYYMMDD")}${seqPadded}`;

    return NextResponse.json({ documentNo, year, seq: row.lastSeq });
  } catch (e) {
    console.error("[POST /api/delivery-note-sequence/allocate]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "分配单号失败" },
      { status: 500 },
    );
  }
}
