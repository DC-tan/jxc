import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  deliveryNoteVoucherSnapshotSchema,
  parseDeliveryNoteVoucherSnapshot,
  voucherSnapshotToLiveSlip,
} from "@/lib/delivery-note-voucher";
import { buildLiveSlipFromDeliveryNoteNo } from "@/lib/delivery-note-voucher-fallback";

const createSchema = z.object({
  documentNo: z.string().min(1).max(64),
  customerId: z.string().min(1),
  deliveredAt: z.string(),
  mergedShip: z.boolean().optional(),
  snapshot: deliveryNoteVoucherSnapshotSchema,
});

/** 确认出货后写入送货单凭证（仅创建，不可更新内容） */
export async function POST(req: Request) {
  const auth = await requirePermission("warehouse.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const documentNo = parsed.data.documentNo.trim();
  const deliveredAt = new Date(parsed.data.deliveredAt);
  if (Number.isNaN(deliveredAt.getTime())) {
    return NextResponse.json({ error: "交货时间无效" }, { status: 400 });
  }

  if (parsed.data.snapshot.documentNo.trim() !== documentNo) {
    return NextResponse.json({ error: "快照单号与 documentNo 不一致" }, { status: 400 });
  }

  try {
    const existing = await prisma.deliveryNoteVoucher.findUnique({
      where: { documentNo },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "该送货单号已存档，不可重复写入或修改" },
        { status: 409 },
      );
    }

    const customer = await prisma.customer.findUnique({
      where: { id: parsed.data.customerId.trim() },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "客户不存在" }, { status: 404 });
    }

    const row = await prisma.deliveryNoteVoucher.create({
      data: {
        documentNo,
        customerId: customer.id,
        deliveredAt,
        mergedShip: parsed.data.mergedShip ?? false,
        snapshot: parsed.data.snapshot,
      },
    });

    return NextResponse.json({ ok: true, id: row.id, documentNo: row.documentNo });
  } catch (e) {
    console.error("[POST /api/warehouse/delivery-notes/voucher]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "存档失败" },
      { status: 500 },
    );
  }
}

/** 按送货单号读取凭证（只读预览） */
export async function GET(req: Request) {
  const auth = await requirePermission("warehouse.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const documentNo = new URL(req.url).searchParams.get("documentNo")?.trim();
  if (!documentNo) {
    return NextResponse.json({ error: "请提供 documentNo" }, { status: 400 });
  }

  try {
    const row = await prisma.deliveryNoteVoucher.findUnique({
      where: { documentNo },
    });
    if (row) {
      const snapshot = parseDeliveryNoteVoucherSnapshot(row.snapshot);
      if (!snapshot) {
        return NextResponse.json({ error: "凭证数据损坏" }, { status: 500 });
      }

      return NextResponse.json({
        documentNo: row.documentNo,
        customerId: row.customerId,
        deliveredAt: row.deliveredAt.toISOString(),
        mergedShip: row.mergedShip,
        voidedAt: row.voidedAt?.toISOString() ?? null,
        liveSlip: voucherSnapshotToLiveSlip(snapshot),
        orderIds: snapshot.orderIds ?? [],
        source: "voucher" as const,
      });
    }

    const fallback = await buildLiveSlipFromDeliveryNoteNo(prisma, documentNo);
    if (!fallback) {
      return NextResponse.json(
        {
          error: `未找到送货单「${documentNo}」的存档凭证或出货记录；若刚完成出货，请确认已点「完成」并成功存档`,
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      documentNo,
      customerId: fallback.customerId,
      deliveredAt: fallback.deliveredAt.toISOString(),
      mergedShip: fallback.mergedShip,
      voidedAt: null,
      liveSlip: fallback.liveSlip,
      orderIds: fallback.orderIds,
      source: fallback.source,
    });
  } catch (e) {
    console.error("[GET /api/warehouse/delivery-notes/voucher]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取失败" },
      { status: 500 },
    );
  }
}
