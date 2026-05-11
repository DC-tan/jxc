import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const createSchema = z.object({
  customerId: z.string().min(1, "请选择客户"),
  model: z.string().min(1, "请填写型号"),
  materialNames: z.string().min(1, "请填写包含物料名称"),
  quantity: z.union([z.number(), z.string()]),
  sampleDueAt: z.string().min(1, "请选择交样日期"),
  remark: z.string().optional().nullable(),
});

function toPositiveInt(v: unknown, fallback = 1): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

function serializeSample(
  s: Prisma.SampleOrderGetPayload<{
    include: { customer: { select: { id: true; code: true; name: true } } };
  }>,
) {
  const trackingNoMatch = s.remark?.match(/运单号\s+([^\s，,。]+)/);
  return {
    id: s.id,
    customerId: s.customerId,
    customer: s.customer,
    model: s.model,
    materialNames: s.materialNames,
    quantity: s.quantity,
    sampleDueAt: s.sampleDueAt.toISOString(),
    status: s.status,
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
    trackingNo: trackingNoMatch?.[1] ?? null,
    remark: s.remark,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function GET(req: Request) {
  const auth = await requirePermission("sample.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status")?.trim().toUpperCase();
  const customerId = searchParams.get("customerId")?.trim() || undefined;
  const keyword = searchParams.get("keyword")?.trim() || undefined;
  const trackingNo = searchParams.get("trackingNo")?.trim() || undefined;
  const from = searchParams.get("from")?.trim();
  const to = searchParams.get("to")?.trim();

  const where: Prisma.SampleOrderWhereInput = {};
  if (status === "PENDING" || status === "DELIVERED") where.status = status;
  if (customerId) where.customerId = customerId;
  if (keyword) {
    where.OR = [
      { model: { contains: keyword, mode: "insensitive" } },
      { materialNames: { contains: keyword, mode: "insensitive" } },
      { remark: { contains: keyword, mode: "insensitive" } },
      { customer: { name: { contains: keyword, mode: "insensitive" } } },
      { customer: { code: { contains: keyword, mode: "insensitive" } } },
    ];
  }
  if (trackingNo) {
    where.remark = { contains: trackingNo, mode: "insensitive" };
  }
  if (from || to) {
    const sampleDueAt: Prisma.DateTimeFilter = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) sampleDueAt.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) sampleDueAt.lte = d;
    }
    if (Object.keys(sampleDueAt).length > 0) where.sampleDueAt = sampleDueAt;
  }

  try {
    const list = await prisma.sampleOrder.findMany({
      where,
      include: { customer: { select: { id: true, code: true, name: true } } },
      orderBy: [
        { status: "asc" },
        { sampleDueAt: "asc" },
        { createdAt: "desc" },
      ],
      take: 500,
    });
    return NextResponse.json({ list: list.map(serializeSample) });
  } catch (e) {
    console.error("[GET /api/samples]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载样品失败" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const auth = await requirePermission("sample.create");
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

  const d = parsed.data;
  const customer = await prisma.customer.findUnique({
    where: { id: d.customerId },
    select: { id: true },
  });
  if (!customer) {
    return NextResponse.json({ error: "客户不存在" }, { status: 400 });
  }
  const sampleDueAt = new Date(d.sampleDueAt);
  if (Number.isNaN(sampleDueAt.getTime())) {
    return NextResponse.json({ error: "交样日期无效" }, { status: 400 });
  }

  try {
    const row = await prisma.sampleOrder.create({
      data: {
        customerId: d.customerId,
        model: d.model.trim(),
        materialNames: d.materialNames.trim(),
        quantity: toPositiveInt(d.quantity, 1),
        sampleDueAt,
        remark: d.remark?.trim() || null,
      },
      include: { customer: { select: { id: true, code: true, name: true } } },
    });
    return NextResponse.json(serializeSample(row));
  } catch (e) {
    console.error("[POST /api/samples]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "创建样品失败" },
      { status: 500 },
    );
  }
}
