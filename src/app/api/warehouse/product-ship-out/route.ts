import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  WarehouseProductShipOutError,
  executeProductShipOut,
} from "@/lib/warehouse-product-ship-out";

const lineSchema = z.object({
  productId: z.string().min(1),
  shipQty: z.union([z.number(), z.string()]),
});

const bodySchema = z.object({
  customerId: z.string().min(1, "请选择客户"),
  shippedAt: z.string().optional(),
  remark: z.string().optional().nullable(),
  deliveryNoteNo: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, "请至少添加一行商品"),
});

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

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  let shippedAt = new Date();
  if (parsed.data.shippedAt) {
    shippedAt = new Date(parsed.data.shippedAt);
    if (Number.isNaN(shippedAt.getTime())) {
      return NextResponse.json({ error: "出货时间无效" }, { status: 400 });
    }
  }

  try {
    const result = await executeProductShipOut(prisma, {
      customerId: parsed.data.customerId,
      lines: parsed.data.lines,
      shippedAt,
      operatorUserId: auth.user.id,
      remark: parsed.data.remark,
      deliveryNoteNo: parsed.data.deliveryNoteNo,
    });
    return NextResponse.json({
      ok: true,
      lines: result.lines,
      shippedAt: result.shippedAt,
      inboundIds: result.inboundIds,
    });
  } catch (e) {
    if (e instanceof WarehouseProductShipOutError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[POST /api/warehouse/product-ship-out]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "出货失败" },
      { status: 500 },
    );
  }
}
