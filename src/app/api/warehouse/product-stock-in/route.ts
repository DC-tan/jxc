import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  WarehouseProductStockInError,
  executeProductStockIn,
} from "@/lib/warehouse-product-stock-in";

const bodySchema = z.object({
  receivedAt: z.string().optional(),
  remark: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.union([z.number(), z.string()]),
      }),
    )
    .min(1, "请至少添加一行商品"),
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

  let receivedAt = new Date();
  if (parsed.data.receivedAt) {
    receivedAt = new Date(parsed.data.receivedAt);
    if (Number.isNaN(receivedAt.getTime())) {
      return NextResponse.json({ error: "入库时间无效" }, { status: 400 });
    }
  }

  try {
    const result = await executeProductStockIn(prisma, {
      lines: parsed.data.lines,
      receivedAt,
      operatorUserId: auth.user.id,
      remark: parsed.data.remark,
    });
    return NextResponse.json({
      ok: true,
      lines: result.lines,
      receivedAt: result.receivedAt,
    });
  } catch (e) {
    if (e instanceof WarehouseProductStockInError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[POST /api/warehouse/product-stock-in]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "入库失败" },
      { status: 500 },
    );
  }
}
