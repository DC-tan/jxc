import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const deliverSchema = z.object({
  deliveredQuantity: z.union([z.number(), z.string()]),
  trackingNo: z.string().min(1, "请填写运单号"),
});

function toPositiveInt(v: unknown, fallback = 1): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("sample.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const parsed = deliverSchema.safeParse(json);
  if (!parsed.success) {
    const msg =
      parsed.error.issues[0]?.message ??
      parsed.error.flatten().fieldErrors.deliveredQuantity?.[0] ??
      parsed.error.flatten().fieldErrors.trackingNo?.[0] ??
      "参数无效";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const deliveredQuantity = toPositiveInt(parsed.data.deliveredQuantity, 1);
  const trackingNo = parsed.data.trackingNo.trim();
  if (!trackingNo) {
    return NextResponse.json({ error: "请填写运单号" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const row = await prisma.sampleOrder.findUnique({
    where: { id },
    select: { id: true, status: true, remark: true },
  });
  if (!row) {
    return NextResponse.json({ error: "样品记录不存在" }, { status: 404 });
  }
  if (row.status === "DELIVERED") {
    return NextResponse.json({ ok: true });
  }

  await prisma.sampleOrder.update({
    where: { id },
    data: {
      status: "DELIVERED",
      deliveredAt: new Date(),
      remark: [
        row.remark?.trim() || "",
        `交样记录：数量 ${deliveredQuantity}，运单号 ${trackingNo}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  });
  return NextResponse.json({ ok: true });
}
