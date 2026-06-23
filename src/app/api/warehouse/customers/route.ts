import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

/** 仓库出货：客户下拉（仅需 warehouse.view，不依赖 customer.view） */
export async function GET() {
  const auth = await requirePermission("warehouse.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const list = await prisma.customer.findMany({
    orderBy: [{ code: "asc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      shortName: true,
    },
  });

  return NextResponse.json({ list });
}
