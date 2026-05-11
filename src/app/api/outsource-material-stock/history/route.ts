import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { ceilOutsourceMaterialQty } from "@/lib/outsource-lines";
import { productBomForOutsource } from "@/lib/product-bom-scope";

export async function GET(req: Request) {
  const auth = await requirePermission("outsource.view");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const materialId = searchParams.get("materialId")?.trim();
  const supplierIdRaw = searchParams.get("supplierId")?.trim();
  const supplierId = !supplierIdRaw || supplierIdRaw === "NONE" ? null : supplierIdRaw;
  if (!materialId) {
    return NextResponse.json({ error: "materialId 必填" }, { status: 400 });
  }

  try {
    const orderLinks = await prisma.outsourceOrderLine.findMany({
      where: {
        materialId,
        outsourceOrder: {
          supplierId,
        },
      },
      select: {
        outsourceOrder: {
          select: { orderNo: true },
        },
      },
      distinct: ["outsourceOrderId"],
      take: 2000,
    });

    const orderNos = orderLinks
      .map((x) => x.outsourceOrder.orderNo)
      .filter((x) => typeof x === "string" && x.length > 0);
    if (orderNos.length === 0) {
      return NextResponse.json({ list: [] });
    }

    const flows = await prisma.materialInbound.findMany({
      where: {
        materialId,
        OR: [
          {
            purchaseOrderNo: { in: orderNos },
            OR: [
              { partDescription: { startsWith: "外发出库（" } },
              { partDescription: { startsWith: "外发结单退回（" } },
            ],
          },
          {
            // 按需求：外发库存退料可不绑定外发单号，按物料+描述归集展示
            partDescription: { startsWith: "外发库存退料（" },
          },
        ],
      },
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      include: {
        operator: { select: { id: true, name: true, loginName: true } },
      },
      take: 2000,
    });

    const [orders, productFlows] = await Promise.all([
      prisma.outsourceOrder.findMany({
        where: { orderNo: { in: orderNos } },
        select: {
          orderNo: true,
          product: {
            select: {
              processingMode: true,
              model: true,
              customerMaterialCode: true,
              productMaterials: {
                select: { materialId: true, usageQty: true, scope: true },
              },
            },
          },
        },
        take: 2000,
      }),
      prisma.productInbound.findMany({
        where: {
          purchaseOrderNo: { in: orderNos },
          quantity: { gt: 0 },
          OR: [
            { partDescription: { startsWith: "外发加工回收入库（" } },
            { partDescription: { startsWith: "外发加工回收入库补差（" } },
          ],
        },
        orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
        include: {
          operator: { select: { id: true, name: true, loginName: true } },
        },
        take: 2000,
      }),
    ]);

    const perSetByOrderNo = new Map<string, number>();
    const productLabelByOrderNo = new Map<string, string>();
    for (const o of orders) {
      const outsourceBom = productBomForOutsource(
        o.product.processingMode,
        o.product.productMaterials ?? [],
      );
      const line = outsourceBom.find((x) => x.materialId === materialId);
      if (!line) continue;
      const perSet = ceilOutsourceMaterialQty(Number(line.usageQty) * 1);
      if (perSet <= 0) continue;
      perSetByOrderNo.set(o.orderNo, perSet);
      productLabelByOrderNo.set(
        o.orderNo,
        o.product.model?.trim() || o.product.customerMaterialCode?.trim() || "—",
      );
    }

    const receiveConsumeFlows = productFlows
      .map((p) => {
        const orderNo = p.purchaseOrderNo?.trim() ?? "";
        const perSet = perSetByOrderNo.get(orderNo);
        if (!perSet) return null;
        const consumeQty = Math.max(0, Math.trunc(Number(p.quantity) || 0) * perSet);
        if (consumeQty <= 0) return null;
        const productLabel = productLabelByOrderNo.get(orderNo) ?? "—";
        return {
          id: `recv-consume-${p.id}`,
          receivedAt: p.receivedAt.toISOString(),
          orderNo,
          quantity: -consumeQty,
          direction: "OUT" as const,
          partDescription: `外发加工回收消耗（${productLabel}×${p.quantity}）`,
          operatorName:
            p.operator?.name?.trim() || p.operator?.loginName?.trim() || "",
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    return NextResponse.json({
      list: [
        ...flows.map((f) => ({
          ...(() => {
            const desc = f.partDescription ?? "";
            const absQty = Math.abs(f.quantity);
            const isOutsourceIssue = desc.startsWith("外发出库（");
            const qtyInOutsourceStock = isOutsourceIssue ? absQty : -absQty;
            return {
              quantity: qtyInOutsourceStock,
              direction: qtyInOutsourceStock >= 0 ? ("IN" as const) : ("OUT" as const),
            };
          })(),
          id: f.id,
          receivedAt: f.receivedAt.toISOString(),
          orderNo: f.purchaseOrderNo ?? "",
          partDescription: f.partDescription ?? "",
          operatorName:
            f.operator?.name?.trim() || f.operator?.loginName?.trim() || "",
        })),
        ...receiveConsumeFlows,
      ].sort(
        (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
      ),
    });
  } catch (e) {
    console.error("[GET /api/outsource-material-stock/history]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载明细失败" },
      { status: 500 },
    );
  }
}

