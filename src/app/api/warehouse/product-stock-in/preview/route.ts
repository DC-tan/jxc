import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  WarehouseProductStockInError,
  previewProductStockIn,
} from "@/lib/warehouse-product-stock-in";

const bodySchema = z.object({
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
  const auth = await requirePermission("warehouse.view");
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
    const lines = await previewProductStockIn(prisma, parsed.data.lines);
    return NextResponse.json({ lines });
  } catch (e) {
    if (e instanceof WarehouseProductStockInError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[POST /api/warehouse/product-stock-in/preview]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "预检失败" },
      { status: 500 },
    );
  }
}
