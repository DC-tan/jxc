import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MATERIAL_KIND_LABEL } from "@/lib/materialLabels";

function parseSampleUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string").slice(0, 3);
}

function kindName(m: {
  kind: import("@prisma/client").MaterialKind | null;
  presetKind: { name: string } | null;
}): string {
  if (m.presetKind) return m.presetKind.name;
  if (m.kind) return MATERIAL_KIND_LABEL[m.kind];
  return "—";
}

export type MaterialInventoryListRow = {
  id: string;
  code: string;
  name: string;
  isDeprecated: boolean;
  deprecatedAt: string | null;
  deprecatedReason: string | null;
  partDescription: string | null;
  brand: string | null;
  unit: string;
  unitPrice: string;
  safetyStock: number | null;
  maxStock: number | null;
  kindId: string | null;
  kindName: string;
  kind: import("@prisma/client").MaterialKind | null;
  presetKind: { id: string; name: string; prefix: string } | null;
  isCustomerSupplied: boolean;
  customer: { id: string; code: string; name: string } | null;
  supplier: { id: string; code: string; name: string };
  inspectionNotes: string | null;
  sampleImageUrls: string[];
  createdAt: string;
  totalQty: number;
  lastReceivedAt: string | null;
};

/** 与「物料信息 → 物料库存」相同的筛选与列表逻辑（供多入口复用） */
export async function queryMaterialInventoryList(
  searchParams: URLSearchParams,
): Promise<MaterialInventoryListRow[]> {
  const code = searchParams.get("code")?.trim() || undefined;
  const name = searchParams.get("name")?.trim() || undefined;
  const kindId = searchParams.get("kindId")?.trim() || undefined;
  const supplierId = searchParams.get("supplierId")?.trim() || undefined;
  const purchaseOrderNo = searchParams.get("purchaseOrderNo")?.trim() || undefined;
  /** 物料主档「部件描述」，与列表列一致；入库明细上的部件描述不参与此项筛选 */
  const partDescription = searchParams.get("partDescription")?.trim() || undefined;
  const receivedFrom = searchParams.get("receivedFrom");
  const receivedTo = searchParams.get("receivedTo");
  const stockMin = searchParams.get("stockMin");
  const stockMax = searchParams.get("stockMax");
  const deprecatedRaw = (searchParams.get("deprecated") ?? "0").trim();

  const fromDate = receivedFrom ? new Date(receivedFrom) : undefined;
  const toDate = receivedTo ? new Date(receivedTo) : undefined;
  if (fromDate && Number.isNaN(fromDate.getTime())) {
    throw new Error("入库开始时间无效");
  }
  if (toDate && Number.isNaN(toDate.getTime())) {
    throw new Error("入库结束时间无效");
  }

  const inboundConditions: Prisma.MaterialInboundWhereInput[] = [];
  if (fromDate || toDate) {
    inboundConditions.push({
      receivedAt: {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      },
    });
  }
  if (purchaseOrderNo) {
    inboundConditions.push({
      purchaseOrderNo: { contains: purchaseOrderNo, mode: "insensitive" },
    });
  }

  const where: Prisma.MaterialWhereInput = {
    ...(deprecatedRaw === "1"
      ? { isDeprecated: true }
      : deprecatedRaw === "all"
        ? {}
        : { isDeprecated: false }),
    ...(code ? { code: { contains: code, mode: "insensitive" } } : {}),
    ...(name ? { name: { contains: name, mode: "insensitive" } } : {}),
    ...(kindId ? { kindId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(partDescription
      ? {
          partDescription: { contains: partDescription, mode: "insensitive" },
        }
      : {}),
    ...(inboundConditions.length
      ? {
          inbounds: {
            some:
              inboundConditions.length === 1
                ? inboundConditions[0]
                : { AND: inboundConditions },
          },
        }
      : {}),
  };

  const list = await prisma.material.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      customer: { select: { id: true, code: true, name: true } },
      presetKind: { select: { id: true, name: true, prefix: true } },
      inbounds: {
        select: {
          quantity: true,
          receivedAt: true,
          purchaseOrderNo: true,
          partDescription: true,
          entryType: true,
        },
        orderBy: { receivedAt: "desc" },
      },
    },
  });

  const minN = stockMin !== null && stockMin !== "" ? Number(stockMin) : undefined;
  const maxN = stockMax !== null && stockMax !== "" ? Number(stockMax) : undefined;

  return list
    .map((m) => {
      const totalQty = m.inbounds.reduce((s, i) => s + Number(i.quantity), 0);
      const lastPositive = m.inbounds.find((i) => Number(i.quantity) > 0);
      const lastReceivedAt = lastPositive?.receivedAt ?? null;
      return {
        id: m.id,
        code: m.code,
        name: m.name,
        isDeprecated: m.isDeprecated,
        deprecatedAt: m.deprecatedAt?.toISOString() ?? null,
        deprecatedReason: m.deprecatedReason,
        partDescription: m.partDescription,
        brand: m.brand,
        unit: m.unit,
        unitPrice: m.unitPrice.toString(),
        safetyStock: m.safetyStock,
        maxStock: m.maxStock,
        kindId: m.kindId,
        kindName: kindName(m),
        kind: m.kind,
        presetKind: m.presetKind,
        isCustomerSupplied: m.isCustomerSupplied,
        customer: m.customer,
        supplier: m.supplier,
        inspectionNotes: m.inspectionNotes,
        sampleImageUrls: parseSampleUrls(m.sampleImageUrls),
        createdAt: m.createdAt.toISOString(),
        totalQty,
        lastReceivedAt: lastReceivedAt?.toISOString() ?? null,
      };
    })
    .filter((r) => {
      if (minN !== undefined && !Number.isNaN(minN) && r.totalQty < minN) {
        return false;
      }
      if (maxN !== undefined && !Number.isNaN(maxN) && r.totalQty > maxN) {
        return false;
      }
      return true;
    });
}
