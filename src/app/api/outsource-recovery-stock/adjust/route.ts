import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { formatOutsourceRecoveryMaterialCode } from "@/lib/outsource-recovery-display";
import { getOutsourceRecoveryQtyByProductId } from "@/lib/outsource-recovery-stock";

const bodySchema = z.object({
  productId: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),
  reason: z.string().trim().min(1, "请填写调整原因").max(300),
});

function toInt(v: unknown) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return 0;
  return n;
}

export async function POST(req: Request) {
  const auth = await requirePermission("outsource.recovery.adjust");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let json: unknown = {};
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

  const delta = toInt(parsed.data.quantity);
  if (delta === 0) {
    return NextResponse.json({ error: "调整数量不能为 0" }, { status: 400 });
  }

  try {
    const product = await prisma.product.findUnique({
      where: { id: parsed.data.productId },
      select: {
        id: true,
        processingMode: true,
        customerMaterialCode: true,
        model: true,
      },
    });
    if (!product) {
      return NextResponse.json({ error: "商品不存在" }, { status: 404 });
    }
    if (product.processingMode !== "OUTSOURCE_INHOUSE") {
      return NextResponse.json(
        { error: "仅外发+自加工商品支持外发回收库手动调整" },
        { status: 400 },
      );
    }

    const currentQty = await getOutsourceRecoveryQtyByProductId(
      prisma,
      parsed.data.productId,
    );
    if (currentQty + delta < 0) {
      return NextResponse.json(
        {
          error: `回收库库存不足，当前 ${currentQty}，无法调整 ${delta}`,
        },
        { status: 400 },
      );
    }

    await prisma.outsourceRecoveryInbound.create({
      data: {
        productId: parsed.data.productId,
        quantity: delta,
        entryType: "MANUAL_STOCK_ADJUST",
        partDescription: `回收库手动调整（${
          product.model?.trim() ||
          formatOutsourceRecoveryMaterialCode(product.customerMaterialCode)
        }）`,
        remark: parsed.data.reason.trim(),
        operatorUserId: auth.user.id,
      },
    });

    return NextResponse.json({ ok: true, currentQty: currentQty + delta });
  } catch (e) {
    console.error("[POST /api/outsource-recovery-stock/adjust]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "调整失败" },
      { status: 500 },
    );
  }
}
