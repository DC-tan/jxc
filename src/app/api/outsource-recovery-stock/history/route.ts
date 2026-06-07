import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { getOutsourceRecoveryPoolByProductId } from "@/lib/outsource-recovery-stock";

type HistoryDirection = "IN" | "OUT";

type HistoryRow = {
  id: string;
  receivedAt: string;
  quantity: number;
  direction: HistoryDirection;
  orderNo: string;
  partDescription: string;
  operatorName: string;
};

function resolveDirection(
  entryType: "RECOVERY" | "MANUAL_STOCK_ADJUST" | "SHIP_CONSUME",
  qty: number,
  partDescription: string,
): HistoryDirection {
  const desc = (partDescription ?? "").trim();
  if (desc.startsWith("外发加工回收库入库（")) return "IN";
  if (desc.startsWith("销售出货消耗外发回收库（")) return "OUT";
  if (entryType === "RECOVERY") return "IN";
  if (entryType === "SHIP_CONSUME") return "OUT";
  return qty >= 0 ? "IN" : "OUT";
}

export async function GET(req: Request) {
  const auth = await requirePermission("outsource.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId")?.trim();
  if (!productId) {
    return NextResponse.json({ error: "productId 必填" }, { status: 400 });
  }

  try {
    const pool = await getOutsourceRecoveryPoolByProductId(prisma, productId);
    const productIds = pool.productIds.length > 0 ? pool.productIds : [productId];
    const rows = await prisma.outsourceRecoveryInbound.findMany({
      where: {
        productId: { in: productIds },
        quantity: { not: 0 },
      },
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      include: {
        operator: {
          select: { name: true, loginName: true },
        },
      },
      take: 3000,
    });

    const list: HistoryRow[] = rows.map((r) => ({
      id: r.id,
      receivedAt: r.receivedAt.toISOString(),
      quantity: Math.abs(Math.trunc(Number(r.quantity) || 0)),
      direction: resolveDirection(
        r.entryType,
        Number(r.quantity ?? 0),
        r.partDescription ?? "",
      ),
      orderNo: r.outsourceOrderNo?.trim() || r.remark?.trim() || "",
      partDescription: r.partDescription?.trim() || "",
      operatorName: r.operator?.name?.trim() || r.operator?.loginName?.trim() || "",
    }));

    return NextResponse.json({ list });
  } catch (e) {
    console.error("[GET /api/outsource-recovery-stock/history]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载回收库明细失败" },
      { status: 500 },
    );
  }
}
