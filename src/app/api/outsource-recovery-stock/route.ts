import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  formatOutsourceRecoveryMaterialCode,
  normalizeOutsourceRecoverySearchKeyword,
} from "@/lib/outsource-recovery-display";
import { outsourceBomSignatureOfProduct } from "@/lib/outsource-recovery-stock";

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
  /** 共享池内商品数（外发BOM一致） */
  sharedProductCount?: number;
  sharedProducts?: {
    productId: string;
    customerCode: string;
    customerName: string;
    customerMaterialCode: string;
    recoveryMaterialCode: string;
    model: string;
    unit: string;
  }[];
};

type SharedProductMeta = {
  productId: string;
  customerCode: string;
  customerName: string;
  customerMaterialCode: string;
  recoveryMaterialCode: string;
  model: string;
  unit: string;
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
    const [entries, allHybridProducts] = await Promise.all([
      prisma.outsourceRecoveryInbound.findMany({
        where: { quantity: { not: 0 } },
        orderBy: [{ receivedAt: "desc" }],
        take: 5000,
        select: {
          productId: true,
          quantity: true,
          receivedAt: true,
          product: {
            select: {
              id: true,
              processingMode: true,
              customerMaterialCode: true,
              model: true,
              unit: true,
              customer: { select: { code: true, name: true } },
              productMaterials: {
                select: { scope: true, materialId: true, usageQty: true },
              },
            },
          },
        },
      }),
      prisma.product.findMany({
        where: { processingMode: "OUTSOURCE_INHOUSE" },
        select: {
          id: true,
          processingMode: true,
          customerMaterialCode: true,
          model: true,
          unit: true,
          customer: { select: { code: true, name: true } },
          productMaterials: {
            select: { scope: true, materialId: true, usageQty: true },
          },
        },
      }),
    ]);

    const sharedProductsBySig = new Map<string, SharedProductMeta[]>();
    for (const p of allHybridProducts) {
      const sig = outsourceBomSignatureOfProduct(p);
      if (!sig) continue;
      const rows = sharedProductsBySig.get(sig) ?? [];
      rows.push({
        productId: p.id,
        customerCode: p.customer.code,
        customerName: p.customer.name,
        customerMaterialCode: p.customerMaterialCode,
        recoveryMaterialCode: formatOutsourceRecoveryMaterialCode(
          p.customerMaterialCode,
        ),
        model: p.model,
        unit: p.unit,
      });
      sharedProductsBySig.set(sig, rows);
    }

    const pools = new Map<
      string,
      {
        representativeProductId: string;
        customerCodes: Set<string>;
        customerNames: Set<string>;
        customerMaterialCodes: Set<string>;
        models: Set<string>;
        units: Set<string>;
        quantity: number;
        lastReceivedAt: string | null;
        productIds: Set<string>;
        products: Map<
          string,
          {
            productId: string;
            customerCode: string;
            customerName: string;
            customerMaterialCode: string;
            recoveryMaterialCode: string;
            model: string;
            unit: string;
          }
        >;
      }
    >();
    for (const e of entries) {
      const sig = outsourceBomSignatureOfProduct(e.product);
      const poolKey = sig ?? `single:${e.productId}`;
      const existing = pools.get(poolKey);
      if (!existing) {
        pools.set(poolKey, {
          representativeProductId: e.productId,
          customerCodes: new Set([e.product.customer.code]),
          customerNames: new Set([e.product.customer.name]),
          customerMaterialCodes: new Set([e.product.customerMaterialCode]),
          models: new Set([e.product.model]),
          units: new Set([e.product.unit]),
          quantity: e.quantity,
          lastReceivedAt: e.receivedAt.toISOString(),
          productIds: new Set([e.productId]),
          products: new Map([
            [
              e.productId,
              {
                productId: e.productId,
                customerCode: e.product.customer.code,
                customerName: e.product.customer.name,
                customerMaterialCode: e.product.customerMaterialCode,
                recoveryMaterialCode: formatOutsourceRecoveryMaterialCode(
                  e.product.customerMaterialCode,
                ),
                model: e.product.model,
                unit: e.product.unit,
              },
            ],
          ]),
        });
      } else {
        existing.customerCodes.add(e.product.customer.code);
        existing.customerNames.add(e.product.customer.name);
        existing.customerMaterialCodes.add(e.product.customerMaterialCode);
        existing.models.add(e.product.model);
        existing.units.add(e.product.unit);
        existing.productIds.add(e.productId);
        if (!existing.products.has(e.productId)) {
          existing.products.set(e.productId, {
            productId: e.productId,
            customerCode: e.product.customer.code,
            customerName: e.product.customer.name,
            customerMaterialCode: e.product.customerMaterialCode,
            recoveryMaterialCode: formatOutsourceRecoveryMaterialCode(
              e.product.customerMaterialCode,
            ),
            model: e.product.model,
            unit: e.product.unit,
          });
        }
        existing.quantity += e.quantity;
        if (
          !existing.lastReceivedAt ||
          e.receivedAt.getTime() > new Date(existing.lastReceivedAt).getTime()
        ) {
          existing.lastReceivedAt = e.receivedAt.toISOString();
        }
      }
    }

    for (const [poolKey, pool] of pools) {
      const shared = sharedProductsBySig.get(poolKey);
      if (!shared || shared.length === 0) continue;
      for (const prod of shared) {
        pool.customerCodes.add(prod.customerCode);
        pool.customerNames.add(prod.customerName);
        pool.customerMaterialCodes.add(prod.customerMaterialCode);
        pool.models.add(prod.model);
        pool.units.add(prod.unit);
        pool.productIds.add(prod.productId);
        if (!pool.products.has(prod.productId)) {
          pool.products.set(prod.productId, prod);
        }
      }
    }

    let list: Row[] = Array.from(pools.values())
      .map((p) => {
        const customerCodes = Array.from(p.customerCodes).filter(Boolean);
        const customerNames = Array.from(p.customerNames).filter(Boolean);
        const customerMaterialCodes = Array.from(p.customerMaterialCodes).filter(Boolean);
        const models = Array.from(p.models).filter(Boolean);
        const units = Array.from(p.units).filter(Boolean);
        const customerMaterialCode = customerMaterialCodes[0] ?? "—";
        const model = models[0] ?? "—";
        const unit = units[0] ?? "PCS";
        return {
          productId: p.representativeProductId,
          customerCode:
            customerCodes.length <= 1
              ? (customerCodes[0] ?? "—")
              : `${customerCodes[0]} 等${customerCodes.length}个客户`,
          customerName:
            customerNames.length <= 1
              ? (customerNames[0] ?? "—")
              : `${customerNames[0]} 等${customerNames.length}个客户`,
          customerMaterialCode,
          recoveryMaterialCode: formatOutsourceRecoveryMaterialCode(
            customerMaterialCode,
          ),
          model:
            models.length <= 1 ? model : `${model} 等${models.length}款商品`,
          unit,
          quantity: p.quantity,
          lastReceivedAt: p.lastReceivedAt,
          sharedProductCount: p.productIds.size,
          sharedProducts: Array.from(p.products.values()).sort((a, b) =>
            `${a.customerCode} ${a.customerMaterialCode} ${a.model}`.localeCompare(
              `${b.customerCode} ${b.customerMaterialCode} ${b.model}`,
              "zh-Hans-CN",
            ),
          ),
        };
      })
      .filter((x) => x.quantity > 0);

    if (keyword) {
      list = list.filter((x) => {
        const text = [
          x.customerCode,
          x.customerName,
          x.customerMaterialCode,
          x.recoveryMaterialCode,
          x.model,
        ]
          .join(" ")
          .toLowerCase();
        return text.includes(keyword);
      });
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
