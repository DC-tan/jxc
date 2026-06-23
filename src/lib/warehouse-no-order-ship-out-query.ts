import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildNoOrderDeliveryDraft,
  type WarehouseDeliveryDraft,
  type WarehouseNoOrderLineMeta,
} from "@/lib/warehouse-delivery-draft";
import { WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK } from "@/lib/warehouse-product-ship-out";

export type NoOrderShipOutQueryRow = {
  id: string;
  shippedAt: string;
  shipQty: number;
  customerId: string;
  customerCode: string;
  customerName: string;
  productModel: string;
  customerMaterialCode: string;
  unit: string;
  unitPrice: number;
  amount: number;
  /** 关联编号（客户编号，写入 purchaseOrderNo） */
  orderRef: string;
  remark: string | null;
  deliveryNoteNo: string | null;
};

const NO_ORDER_PART_LEGACY = "无单出库";

/** 从备注解析送货单号（兼容多种分隔符与无空格写法） */
export function parseNoOrderDeliveryNoteNo(
  remark: string | null | undefined,
): string | null {
  const t = remark?.trim();
  if (!t) return null;

  const explicit = t.match(/送货单号[：:\s]*([^\s；;,]+)/u);
  if (explicit?.[1]?.trim()) return explicit[1].trim();

  /** 与 allocate API 一致：{简称}{YYYYMMDD}{三位流水} */
  const embedded = t.match(/\b([A-Za-z\u4e00-\u9fff]{1,8}\d{11})\b/u);
  if (embedded?.[1]?.trim()) return embedded[1].trim();

  return null;
}

function batchDeliveryNoteKey(row: {
  customerId: string;
  shippedAt: string;
}): string {
  const at = row.shippedAt.slice(0, 19);
  return `${row.customerId}|${at}`;
}

/** 同批出货（同客户、同秒）共享送货单号 */
function enrichNoOrderDeliveryNoteNos(
  rows: NoOrderShipOutQueryRow[],
): NoOrderShipOutQueryRow[] {
  const docByBatch = new Map<string, string>();
  for (const r of rows) {
    const doc =
      r.deliveryNoteNo?.trim() ||
      parseNoOrderDeliveryNoteNo(r.remark)?.trim() ||
      null;
    if (!doc) continue;
    const key = batchDeliveryNoteKey(r);
    if (!docByBatch.has(key)) docByBatch.set(key, doc);
  }
  return rows.map((r) => {
    const parsed =
      r.deliveryNoteNo?.trim() ||
      parseNoOrderDeliveryNoteNo(r.remark)?.trim() ||
      docByBatch.get(batchDeliveryNoteKey(r)) ||
      null;
    if (!parsed || parsed === r.deliveryNoteNo) return r;
    return { ...r, deliveryNoteNo: parsed };
  });
}

/** 同批出库流水在库内查备注，补全未回写单号的行 */
async function fillDeliveryNoteFromBatchDb(
  db: PrismaClient,
  rows: NoOrderShipOutQueryRow[],
): Promise<NoOrderShipOutQueryRow[]> {
  const missingKeys = new Map<string, NoOrderShipOutQueryRow>();
  for (const r of rows) {
    if (r.deliveryNoteNo?.trim()) continue;
    missingKeys.set(batchDeliveryNoteKey(r), r);
  }
  if (missingKeys.size === 0) return rows;

  const docByKey = new Map<string, string>();
  for (const [key, sample] of missingKeys) {
    const receivedAt = new Date(sample.shippedAt);
    if (Number.isNaN(receivedAt.getTime())) continue;
    const siblings = await db.productInbound.findMany({
      where: {
        AND: [
          buildNoOrderShipOutInboundWhere({ customerId: sample.customerId }),
          { receivedAt },
        ],
      },
      select: { remark: true },
      take: 50,
    });
    for (const s of siblings) {
      const doc = parseNoOrderDeliveryNoteNo(s.remark)?.trim();
      if (doc) {
        docByKey.set(key, doc);
        break;
      }
    }
  }
  if (docByKey.size === 0) return rows;

  return rows.map((r) => {
    const doc =
      r.deliveryNoteNo?.trim() ||
      docByKey.get(batchDeliveryNoteKey(r)) ||
      null;
    if (!doc || doc === r.deliveryNoteNo) return r;
    return { ...r, deliveryNoteNo: doc };
  });
}

export function isNoOrderShipOutInbound(row: {
  quantity: number;
  partDescription?: string | null;
  remark?: string | null;
}): boolean {
  if (row.quantity >= 0) return false;
  const part = row.partDescription?.trim() ?? "";
  const remark = row.remark?.trim() ?? "";
  if (
    part === WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK ||
    part === NO_ORDER_PART_LEGACY
  ) {
    return true;
  }
  return (
    remark.includes(WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK) ||
    remark.includes(NO_ORDER_PART_LEGACY)
  );
}

export function buildNoOrderShipOutInboundWhere(params: {
  from?: Date;
  to?: Date;
  keyword?: string;
  customerId?: string;
}): Prisma.ProductInboundWhereInput {
  const andParts: Prisma.ProductInboundWhereInput[] = [
    { quantity: { lt: 0 } },
    {
      OR: [
        { partDescription: WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK },
        { partDescription: NO_ORDER_PART_LEGACY },
        { remark: { contains: WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK } },
        { remark: { contains: NO_ORDER_PART_LEGACY } },
      ],
    },
  ];

  if (params.from || params.to) {
    andParts.push({
      receivedAt: {
        ...(params.from ? { gte: params.from } : {}),
        ...(params.to ? { lte: params.to } : {}),
      },
    });
  }

  if (params.customerId) {
    andParts.push({ product: { customerId: params.customerId } });
  }

  const keyword = params.keyword?.trim();
  if (keyword) {
    andParts.push({
      OR: [
        { purchaseOrderNo: { contains: keyword, mode: "insensitive" } },
        { remark: { contains: keyword, mode: "insensitive" } },
        {
          product: {
            model: { contains: keyword, mode: "insensitive" },
          },
        },
        {
          product: {
            customerMaterialCode: { contains: keyword, mode: "insensitive" },
          },
        },
        {
          product: {
            customer: {
              name: { contains: keyword, mode: "insensitive" },
            },
          },
        },
        {
          product: {
            customer: {
              code: { contains: keyword, mode: "insensitive" },
            },
          },
        },
      ],
    });
  }

  return andParts.length === 1 ? andParts[0]! : { AND: andParts };
}

export async function listNoOrderShipOutRows(
  db: PrismaClient,
  params: {
    from?: Date;
    to?: Date;
    keyword?: string;
    customerId?: string;
    take?: number;
  },
): Promise<NoOrderShipOutQueryRow[]> {
  const rows = await db.productInbound.findMany({
    where: buildNoOrderShipOutInboundWhere(params),
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    take: params.take ?? 2000,
    select: {
      id: true,
      quantity: true,
      receivedAt: true,
      purchaseOrderNo: true,
      remark: true,
      product: {
        select: {
          model: true,
          customerMaterialCode: true,
          unit: true,
          price: true,
          customerId: true,
          customer: { select: { code: true, name: true } },
        },
      },
    },
  });

  const mapped = enrichNoOrderDeliveryNoteNos(
    rows
      .filter((r) => isNoOrderShipOutInbound(r))
      .map((r) => {
        const shipQty = Math.abs(Number(r.quantity) || 0);
        const unitPrice = Number(r.product.price ?? 0);
        const customer = r.product.customer;
        return {
          id: r.id,
          shippedAt: r.receivedAt.toISOString(),
          shipQty,
          customerId: r.product.customerId,
          customerCode: customer.code,
          customerName: customer.name,
          productModel: r.product.model?.trim() || "—",
          customerMaterialCode: r.product.customerMaterialCode?.trim() || "—",
          unit: r.product.unit?.trim() || "—",
          unitPrice,
          amount: shipQty * unitPrice,
          orderRef: r.purchaseOrderNo?.trim() || customer.code?.trim() || "—",
          remark: r.remark?.trim() || null,
          deliveryNoteNo: parseNoOrderDeliveryNoteNo(r.remark),
        };
      }),
  );
  return fillDeliveryNoteFromBatchDb(db, mapped);
}

export type WarehouseDeliveredQueryRow = {
  id: string;
  rowKind: "sales" | "noOrder";
  customerOrderNo: string;
  customerModel: string;
  deliveryDueAt: string | null;
  actualDeliveredAt: string | null;
  latestBatchDeliveredAt?: string | null;
  totalAmount: string;
  remark: string | null;
  customer: { id: string; code: string; name: string };
  createdAt: string;
  updatedAt: string;
  deliveryNoteNo?: string | null;
};

export function noOrderShipOutToQueryRow(
  row: NoOrderShipOutQueryRow,
): WarehouseDeliveredQueryRow {
  return {
    id: `no-order:${row.id}`,
    rowKind: "noOrder",
    customerOrderNo: "—",
    customerModel: row.productModel,
    deliveryDueAt: null,
    actualDeliveredAt: row.shippedAt,
    latestBatchDeliveredAt: null,
    totalAmount: String(row.amount),
    remark: row.remark?.trim() || WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK,
    customer: {
      id: row.customerId,
      code: row.customerCode,
      name: row.customerName,
    },
    createdAt: row.shippedAt,
    updatedAt: row.shippedAt,
    deliveryNoteNo: row.deliveryNoteNo,
  };
}

export function queryRowDeliveredAtMs(row: WarehouseDeliveredQueryRow): number {
  const iso = row.actualDeliveredAt ?? row.latestBatchDeliveredAt ?? row.createdAt;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function noOrderShipOutToReconcileRow(
  row: NoOrderShipOutQueryRow,
): {
  送货日期: string;
  送货单号: string;
  项目型号: string;
  订单数量: number;
  订单编号: string;
  商品型号: string;
  物料料号: string;
  单位: string;
  送货数量: number;
  单价: number;
  金额: number;
  备品数量: number;
} {
  return {
    送货日期: row.shippedAt,
    送货单号:
      row.deliveryNoteNo?.trim() ||
      parseNoOrderDeliveryNoteNo(row.remark)?.trim() ||
      "—",
    项目型号: "—",
    订单数量: row.shipQty,
    订单编号: `${row.orderRef}（无单出货）`,
    商品型号: row.productModel,
    物料料号: row.customerMaterialCode,
    单位: row.unit,
    送货数量: row.shipQty,
    单价: row.unitPrice,
    金额: row.amount,
    备品数量: 0,
  };
}

/** 出货查询：按单条无单出库流水还原同批送货单预览（同客户、同出货时间） */
export async function buildNoOrderShipOutDeliveryPreview(
  db: PrismaClient,
  inboundId: string,
): Promise<{ draft: WarehouseDeliveryDraft; documentNo: string | null } | null> {
  const anchor = await db.productInbound.findUnique({
    where: { id: inboundId },
    select: {
      id: true,
      quantity: true,
      receivedAt: true,
      purchaseOrderNo: true,
      partDescription: true,
      remark: true,
      product: {
        select: {
          id: true,
          model: true,
          spec: true,
          customerMaterialCode: true,
          unit: true,
          customerId: true,
          customer: {
            select: { id: true, code: true, name: true, shortName: true },
          },
        },
      },
    },
  });
  if (!anchor || !isNoOrderShipOutInbound(anchor)) return null;

  const rows = await db.productInbound.findMany({
    where: {
      AND: [
        buildNoOrderShipOutInboundWhere({
          customerId: anchor.product.customerId,
        }),
        { receivedAt: anchor.receivedAt },
      ],
    },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      quantity: true,
      receivedAt: true,
      purchaseOrderNo: true,
      partDescription: true,
      remark: true,
      product: {
        select: {
          id: true,
          model: true,
          spec: true,
          customerMaterialCode: true,
          unit: true,
          customerId: true,
          customer: {
            select: { id: true, code: true, name: true, shortName: true },
          },
        },
      },
    },
  });

  const batch = rows.filter((r) => isNoOrderShipOutInbound(r));
  if (batch.length === 0) return null;

  const customer = anchor.product.customer;
  const noOrderLineMeta: Record<string, WarehouseNoOrderLineMeta> = {};
  const lines: { lineId: string; shipQty: number }[] = [];
  const inboundIds: string[] = [];

  for (const r of batch) {
    const shipQty = Math.abs(Number(r.quantity) || 0);
    if (shipQty <= 0) continue;
    const pid = r.product.id;
    lines.push({ lineId: pid, shipQty });
    inboundIds.push(r.id);
    noOrderLineMeta[pid] = {
      productId: pid,
      model: r.product.model?.trim() || "—",
      customerMaterialCode: r.product.customerMaterialCode?.trim() || "—",
      unit: r.product.unit?.trim() || "—",
      spec: r.product.spec?.trim() || undefined,
    };
  }
  if (lines.length === 0) return null;

  const documentNo =
    enrichNoOrderDeliveryNoteNos(
      batch.map((r) => ({
        id: r.id,
        shippedAt: r.receivedAt.toISOString(),
        shipQty: Math.abs(Number(r.quantity) || 0),
        customerId: r.product.customerId,
        customerCode: r.product.customer.code,
        customerName: r.product.customer.name,
        productModel: r.product.model?.trim() || "—",
        customerMaterialCode: r.product.customerMaterialCode?.trim() || "—",
        unit: r.product.unit?.trim() || "—",
        unitPrice: 0,
        amount: 0,
        orderRef: r.purchaseOrderNo?.trim() || "—",
        remark: r.remark?.trim() || null,
        deliveryNoteNo: parseNoOrderDeliveryNoteNo(r.remark),
      })),
    )
      .map((r) => r.deliveryNoteNo?.trim())
      .find(Boolean) ?? null;

  const draft = buildNoOrderDeliveryDraft({
    customerId: anchor.product.customerId,
    customer: {
      code: customer.code,
      name: customer.name,
      shortName: customer.shortName,
    },
    shippedAt: anchor.receivedAt.toISOString(),
    lines,
    noOrderLineMeta,
    noOrderInboundIds: inboundIds,
  });
  draft.orderId = `no-order:${inboundId}`;
  if (documentNo) draft.documentNo = documentNo;

  return { draft, documentNo };
}
