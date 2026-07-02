import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  WarehouseProductShipOutError,
  voidNoOrderShipOutByDeliveryNote,
} from "@/lib/warehouse-product-ship-out";

const bodySchema = z.object({
  deliveryNoteNo: z.string().min(1),
});

/** 无单出货：按送货单号作废本批，回退库存 */
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

  try {
    const result = await voidNoOrderShipOutByDeliveryNote(
      prisma,
      parsed.data.deliveryNoteNo.trim(),
      auth.user.id,
    );
    return NextResponse.json({ ok: true, revertedQty: result.revertedQty });
  } catch (e) {
    if (e instanceof WarehouseProductShipOutError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[POST /api/warehouse/product-ship-out/void-batch]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "作废失败" },
      { status: 500 },
    );
  }
}
