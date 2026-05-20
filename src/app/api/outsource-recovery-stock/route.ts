import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  formatOutsourceRecoveryMaterialCode,
  normalizeOutsourceRecoverySearchKeyword,
  outsourceRecoveryStockSearchText,
} from "@/lib/outsource-recovery-display";

type Row = {
  productId: string;
  customerCode: string;
  customerName: string;
  customerMaterialCode: string;
  /** 展示用：WF- + 客户物料编号 */
  recoveryMaterialCode: string;
  model: string;
  unit: string;
  quantity: number;
  lastReceivedAt: string | null;
};

export async function GET(req: Request) {
  const auth = await requirePermission("outsource.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const keywordRaw = searchParams.get("keyword")?.trim() ?? "";
  const keyword = normalizeOutsourceRecoverySearchKeyword(keywordRaw).toLowerCase();

  try {
    const entries = await prisma.outsourceRecoveryInbound.findMany({
      where: { quantity: { not: 0 } },
      orderBy: [{ receivedAt: "desc" }],
      take: 5000,
      select: {
        productId: true,
        quantity: true,
        receivedAt: true,
        product: {
          select: {
            customerMaterialCode: true,
            model: true,
            unit: true,
            customer: { select: { code: true, name: true } },
          },
        },
      },
    });

    const byProduct = new Map<string, Row>();
    for (const e of entries) {
      const prev = byProduct.get(e.productId);
      if (!prev) {
        byProduct.set(e.productId, {
          productId: e.productId,
          customerCode: e.product.customer.code,
          customerName: e.product.customer.name,
          customerMaterialCode: e.product.customerMaterialCode,
          recoveryMaterialCode: formatOutsourceRecoveryMaterialCode(
            e.product.customerMaterialCode,
          ),
          model: e.product.model,
          unit: e.product.unit,
          quantity: e.quantity,
          lastReceivedAt: e.receivedAt.toISOString(),
        });
      } else {
        prev.quantity += e.quantity;
        if (
          !prev.lastReceivedAt ||
          e.receivedAt.getTime() > new Date(prev.lastReceivedAt).getTime()
        ) {
          prev.lastReceivedAt = e.receivedAt.toISOString();
        }
      }
    }

    let list = Array.from(byProduct.values()).filter((x) => x.quantity > 0);
    if (keyword) {
      list = list.filter((x) =>
        outsourceRecoveryStockSearchText(x).includes(keyword),
      );
    }

    list.sort((a, b) => {
      const ca = a.customerCode.localeCompare(b.customerCode, "zh-Hans-CN");
      if (ca !== 0) return ca;
      return a.customerMaterialCode.localeCompare(
        b.customerMaterialCode,
        "zh-Hans-CN",
      );
    });

    return NextResponse.json({ list });
  } catch (e) {
    console.error("[GET /api/outsource-recovery-stock]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载外发回收库失败" },
      { status: 500 },
    );
  }
}
