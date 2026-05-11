import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const bodySchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1),
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

  const orderIds = [...new Set(parsed.data.orderIds)];

  try {
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.salesOrder.findMany({
        where: {
          id: { in: orderIds },
          actualDeliveredAt: null,
        },
        select: { id: true, customerOrderNo: true },
      });
      if (rows.length === 0) {
        return { closedCount: 0 };
      }
      await tx.salesOrder.updateMany({
        where: { id: { in: rows.map((x) => x.id) } },
        data: { actualDeliveredAt: now },
      });
      return { closedCount: rows.length };
    });

    return NextResponse.json({ ok: true, closedCount: result.closedCount });
  } catch (e) {
    console.error("[POST /api/warehouse/sales-orders/close]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "结单失败" },
      { status: 500 },
    );
  }
}

