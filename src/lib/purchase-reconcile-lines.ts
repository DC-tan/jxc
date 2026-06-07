import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PURCHASE_SPARE_PART_DESC_PREFIX } from "@/lib/purchase-receipt";

export type PurchaseReconcileMaterialInfo = {
  name: string;
  partDescription: string | null;
  customerId: string | null;
  isCustomerSupplied: boolean;
  presetKind: { namingMode: string } | null;
};

export type PurchaseReconcileLineSource = {
  materialId: string;
  orderQty: number;
  unitPrice: number;
  material: PurchaseReconcileMaterialInfo;
};

type PoLineRow = {
  materialId: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  material: PurchaseReconcileMaterialInfo;
};

function sumReceivedByMaterial(
  inbounds: { materialId: string; quantity: number }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const b of inbounds) {
    if (b.quantity <= 0) continue;
    map.set(b.materialId, (map.get(b.materialId) ?? 0) + b.quantity);
  }
  return map;
}

/**
 * 收料确认后采购明细行可能已从库中删除，对账须结合剩余明细 + 该单全部入库流水还原。
 */
export async function buildPurchaseReconcileLineMap(
  poLines: PoLineRow[],
  orderNo: string,
): Promise<Map<string, PurchaseReconcileLineSource>> {
  const allInbounds = await prisma.materialInbound.findMany({
    where: {
      purchaseOrderNo: orderNo,
      quantity: { gt: 0 },
      OR: [
        { partDescription: null },
        {
          NOT: {
            partDescription: { startsWith: PURCHASE_SPARE_PART_DESC_PREFIX },
          },
        },
      ],
    },
    select: { materialId: true, quantity: true },
  });
  const receivedByMaterial = sumReceivedByMaterial(allInbounds);
  const map = new Map<string, PurchaseReconcileLineSource>();

  for (const l of poLines) {
    const received = receivedByMaterial.get(l.materialId) ?? 0;
    map.set(l.materialId, {
      materialId: l.materialId,
      orderQty: l.quantity + received,
      unitPrice: Number(l.unitPrice),
      material: l.material,
    });
  }

  const missingIds = [...receivedByMaterial.keys()].filter((id) => !map.has(id));
  if (missingIds.length > 0) {
    const mats = await prisma.material.findMany({
      where: { id: { in: missingIds } },
      select: {
        id: true,
        name: true,
        partDescription: true,
        unitPrice: true,
        customerId: true,
        isCustomerSupplied: true,
        presetKind: { select: { namingMode: true } },
      },
    });
    for (const m of mats) {
      const received = receivedByMaterial.get(m.id) ?? 0;
      map.set(m.id, {
        materialId: m.id,
        orderQty: received,
        unitPrice: Number(m.unitPrice),
        material: {
          name: m.name,
          partDescription: m.partDescription,
          customerId: m.customerId,
          isCustomerSupplied: m.isCustomerSupplied,
          presetKind: m.presetKind,
        },
      });
    }
  }

  return map;
}
