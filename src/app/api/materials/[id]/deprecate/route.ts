import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const bodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("material.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await ctx.params;

  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    json = {};
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const existing = await prisma.material.findUnique({
    where: { id },
    select: { id: true, isDeprecated: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "物料不存在" }, { status: 404 });
  }
  if (existing.isDeprecated) {
    return NextResponse.json({ error: "该物料已弃用" }, { status: 400 });
  }

  await prisma.material.update({
    where: { id },
    data: {
      isDeprecated: true,
      deprecatedAt: new Date(),
      deprecatedReason: parsed.data.reason?.trim() || null,
    },
  });

  return NextResponse.json({ ok: true });
}
