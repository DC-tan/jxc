import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

function buildDeliveredTimeRange(
  deliveredFrom: string | undefined,
  deliveredTo: string | undefined,
): { ad: Prisma.DateTimeNullableFilter; batch: Prisma.DateTimeFilter } {
  const ad: Prisma.DateTimeNullableFilter = { not: null };
  const batch: Prisma.DateTimeFilter = {};
  if (deliveredFrom) {
    const a = new Date(deliveredFrom);
    if (!Number.isNaN(a.getTime())) {
      ad.gte = a;
      batch.gte = a;
    }
  }
  if (deliveredTo) {
    const b = new Date(deliveredTo);
    if (!Number.isNaN(b.getTime())) {
      b.setHours(23, 59, 59, 999);
      ad.lte = b;
      batch.lte = b;
    }
  }
  return { ad, batch };
}

function latestBatchIso(p: {
  lines: { shipLogs: { batchDeliveredAt: Date }[] }[];
}): string | null {
  const times: number[] = [];
  for (const l of p.lines) {
    for (const s of l.shipLogs) {
      times.push(s.batchDeliveredAt.getTime());
    }
  }
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
}

/**
 * 仓库出货：待出货 / 已出货销售订单列表（与「销售订单」数据同源，权限走 warehouse.view）
 * `includePartialInquiry=1` 且 `tab=delivered`：含整单已交清 + 仅分批出货且整单未结单，按「实际交货 / 分批时间」区间筛选。
 */
export async function GET(req: Request) {
  const auth = await requirePermission("warehouse.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const tab = searchParams.get("tab")?.trim().toLowerCase();
  const keyword = searchParams.get("keyword")?.trim() || "";
  const createdFrom = searchParams.get("createdFrom")?.trim();
  const createdTo = searchParams.get("createdTo")?.trim();
  const deliveredFrom = searchParams.get("deliveredFrom")?.trim();
  const deliveredTo = searchParams.get("deliveredTo")?.trim();
  const includePartialInquiry =
    searchParams.get("includePartialInquiry") === "1" ||
    searchParams.get("includePartialInquiry") === "true";

  const andParts: Prisma.SalesOrderWhereInput[] = [];

  if (tab === "pending") {
    andParts.push({ actualDeliveredAt: null });
    if (createdFrom || createdTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (createdFrom) {
        const a = new Date(createdFrom);
        if (!Number.isNaN(a.getTime())) createdAt.gte = a;
      }
      if (createdTo) {
        const b = new Date(createdTo);
        if (!Number.isNaN(b.getTime())) {
          b.setHours(23, 59, 59, 999);
          createdAt.lte = b;
        }
      }
      if (Object.keys(createdAt).length > 0) andParts.push({ createdAt });
    }
  } else if (tab === "delivered") {
    const { ad, batch } = buildDeliveredTimeRange(
      deliveredFrom,
      deliveredTo,
    );
    const hasBatchTimeFilter = Object.keys(batch).length > 0;
    if (includePartialInquiry) {
      const shipLogSome: Prisma.SalesOrderLineShipLogWhereInput =
        hasBatchTimeFilter ? { batchDeliveredAt: batch } : {};
      andParts.push({
        OR: [
          { actualDeliveredAt: ad },
          {
            actualDeliveredAt: null,
            lines: {
              some: {
                shipLogs: { some: shipLogSome },
              },
            },
          },
        ],
      });
    } else {
      andParts.push({ actualDeliveredAt: ad });
    }
  } else {
    return NextResponse.json(
      { error: "请指定 tab=pending 或 tab=delivered" },
      { status: 400 },
    );
  }

  if (keyword) {
    andParts.push({
      OR: [
        { customerOrderNo: { contains: keyword, mode: "insensitive" } },
        { customerModel: { contains: keyword, mode: "insensitive" } },
        {
          customer: {
            name: { contains: keyword, mode: "insensitive" },
          },
        },
        {
          customer: {
            code: { contains: keyword, mode: "insensitive" },
          },
        },
      ],
    });
  }

  const where: Prisma.SalesOrderWhereInput =
    andParts.length === 1 ? andParts[0]! : { AND: andParts };

  const orderBy: Prisma.SalesOrderOrderByWithRelationInput =
    tab === "delivered" && includePartialInquiry
      ? { updatedAt: "desc" }
      : tab === "delivered"
        ? { actualDeliveredAt: "desc" }
        : { createdAt: "desc" };

  try {
    const list = await prisma.salesOrder.findMany({
      where,
      orderBy,
      take: 400,
      include: {
        customer: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
        ...(includePartialInquiry && tab === "delivered"
          ? {
              lines: {
                select: {
                  shipLogs: { select: { batchDeliveredAt: true } },
                },
              },
            }
          : {}),
      },
    });

    return NextResponse.json({
      list: list.map((p) => {
        const pWithLines = p as typeof p & {
          lines?: { shipLogs: { batchDeliveredAt: Date }[] }[];
        };
        const latestBatchDeliveredAt =
          includePartialInquiry && tab === "delivered" && pWithLines.lines
            ? latestBatchIso(pWithLines)
            : null;
        return {
          id: p.id,
          customerOrderNo: p.customerOrderNo,
          customerModel: p.customerModel,
          deliveryDueAt: p.deliveryDueAt?.toISOString() ?? null,
          actualDeliveredAt: p.actualDeliveredAt?.toISOString() ?? null,
          latestBatchDeliveredAt,
          totalAmount: p.totalAmount.toString(),
          remark: p.remark,
          customer: p.customer,
          lineCount: p._count.lines,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        };
      }),
    });
  } catch (e) {
    console.error("[GET /api/warehouse/sales-orders]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 500 },
    );
  }
}
