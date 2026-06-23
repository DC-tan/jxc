import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  WarehouseProductShipOutError,
  attachNoOrderShipOutDeliveryNote,
} from "@/lib/warehouse-product-ship-out";

const bodySchema = z.object({
  inboundIds: z.array(z.string().min(1)).min(1),
  documentNo: z.string().min(1),
});

/** 无单出货：送货单打印完成后回写送货单号到出库流水 */
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
    const updated = await attachNoOrderShipOutDeliveryNote(
      prisma,
      parsed.data.inboundIds,
      parsed.data.documentNo.trim(),
    );
    return NextResponse.json({ ok: true, updated });
  } catch (e) {
    if (e instanceof WarehouseProductShipOutError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[POST /api/warehouse/product-ship-out/attach-delivery-note]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "回写失败" },
      { status: 500 },
    );
  }
}
