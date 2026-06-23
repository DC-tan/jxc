import type { Prisma, PrismaClient } from "@prisma/client";
import { shipmentProductModelLabel } from "@/lib/inhouse-bom-display";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** 无单出货流水固定备注，便于对帐识别 */
export const WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK = "无单出货";

/** 用户未填写时默认「无单出货」 */
export function resolveNoOrderShipOutUserRemark(extra?: string | null): string {
  const t = extra?.trim();
  return t || WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK;
}

export function formatNoOrderShipOutRemark(
  extra?: string | null,
  deliveryNoteNo?: string | null,
): string {
  const parts = [resolveNoOrderShipOutUserRemark(extra)];
  const doc = deliveryNoteNo?.trim();
  if (doc) parts.push(`送货单号 ${doc}`);
  return parts.join("；");
}

/** 从已落库的 remark 解析用户备注（不含送货单号段） */
export function parseNoOrderShipOutRemarkExtra(
  stored: string | null | undefined,
): string | null {
  if (!stored?.trim()) return null;
  const segments = stored
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const body = segments.filter((s) => !/^送货单号\s/.test(s));
  if (body.length === 0) return null;
  if (body[0] === WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK) {
    const rest = body.slice(1).join("；");
    return rest || null;
  }
  const joined = body.join("；");
  return joined === WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK ? null : joined;
}

export class WarehouseProductShipOutError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "WarehouseProductShipOutError";
  }
}

export type ProductShipOutPreviewLine = {
  productId: string;
  productLabel: string;
  customerMaterialCode: string;
  unit: string;
  processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
  customerId: string;
  customerCode: string;
  customerName: string;
  shipQty: number;
  productStock: number;
  stockAfterShip: number;
};

type ProductForShipOut = {
  id: string;
  model: string;
  customerMaterialCode: string;
  unit: string;
  processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
  isDeprecated: boolean;
  customerId: string;
  customer: { code: string; name: string };
};

type CustomerBrief = {
  id: string;
  code: string;
  name: string;
};

function toNonNegInt(v: unknown): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function parseShipQty(v: unknown): number {
  const n = toNonNegInt(v);
  if (n <= 0) {
    throw new WarehouseProductShipOutError("出货数量须为正整数");
  }
  return n;
}

function parseCustomerId(v: unknown): string {
  const id = typeof v === "string" ? v.trim() : "";
  if (!id) {
    throw new WarehouseProductShipOutError("请选择客户");
  }
  return id;
}

async function loadCustomer(
  db: DbClient,
  customerId: string,
): Promise<CustomerBrief | null> {
  return db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, code: true, name: true },
  });
}

async function loadProduct(
  db: DbClient,
  productId: string,
): Promise<ProductForShipOut | null> {
  return db.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      model: true,
      customerMaterialCode: true,
      unit: true,
      processingMode: true,
      isDeprecated: true,
      customerId: true,
      customer: { select: { code: true, name: true } },
    },
  });
}

async function productStockQty(db: DbClient, productId: string): Promise<number> {
  const agg = await db.productInbound.aggregate({
    where: { productId },
    _sum: { quantity: true },
  });
  return Number(agg._sum.quantity ?? 0);
}

export async function buildProductShipOutPreviewLine(
  db: DbClient,
  customerIdInput: unknown,
  productId: string,
  shipQtyInput: unknown,
): Promise<ProductShipOutPreviewLine> {
  const customerId = parseCustomerId(customerIdInput);
  const customer = await loadCustomer(db, customerId);
  if (!customer) {
    throw new WarehouseProductShipOutError("客户不存在", 404);
  }

  const shipQty = parseShipQty(shipQtyInput);
  const product = await loadProduct(db, productId);
  if (!product) {
    throw new WarehouseProductShipOutError("商品不存在", 404);
  }
  if (product.customerId !== customerId) {
    throw new WarehouseProductShipOutError(
      `商品「${shipmentProductModelLabel(product)}」不属于所选客户`,
    );
  }
  if (product.isDeprecated) {
    throw new WarehouseProductShipOutError("该商品已弃用，不能出货");
  }

  const productLabel = shipmentProductModelLabel(product);
  const unit = product.unit?.trim() || "—";
  const productStock = await productStockQty(db, product.id);

  if (productStock <= 0) {
    throw new WarehouseProductShipOutError(
      `「${productLabel}」当前无商品库存，无法无单出货。请先办理成品入库。`,
    );
  }

  if (productStock < shipQty) {
    throw new WarehouseProductShipOutError(
      `「${productLabel}」商品库存不足（当前 ${productStock}，本次出货 ${shipQty}）。无单出货仅扣减现有库存。`,
    );
  }

  return {
    productId: product.id,
    productLabel,
    customerMaterialCode: product.customerMaterialCode?.trim() || "—",
    unit,
    processingMode: product.processingMode,
    customerId: customer.id,
    customerCode: customer.code,
    customerName: customer.name,
    shipQty,
    productStock,
    stockAfterShip: productStock - shipQty,
  };
}

export async function previewProductShipOut(
  db: DbClient,
  customerId: unknown,
  lines: { productId: string; shipQty: unknown }[],
): Promise<ProductShipOutPreviewLine[]> {
  parseCustomerId(customerId);
  if (lines.length === 0) {
    throw new WarehouseProductShipOutError("请至少添加一行商品");
  }
  const seen = new Set<string>();
  const result: ProductShipOutPreviewLine[] = [];
  for (const row of lines) {
    if (seen.has(row.productId)) {
      throw new WarehouseProductShipOutError("存在重复的商品行");
    }
    seen.add(row.productId);
    result.push(
      await buildProductShipOutPreviewLine(
        db,
        customerId,
        row.productId,
        row.shipQty,
      ),
    );
  }
  return result;
}

export async function executeProductShipOut(
  db: PrismaClient,
  input: {
    customerId: unknown;
    lines: { productId: string; shipQty: unknown }[];
    shippedAt: Date;
    operatorUserId: string;
    remark?: string | null;
    /** 送货单打印页「完成」时一并写入备注 */
    deliveryNoteNo?: string | null;
  },
): Promise<{ lines: ProductShipOutPreviewLine[]; shippedAt: string; inboundIds: string[] }> {
  const customerId = parseCustomerId(input.customerId);
  const customer = await loadCustomer(db, customerId);
  if (!customer) {
    throw new WarehouseProductShipOutError("客户不存在", 404);
  }

  const previews = await previewProductShipOut(db, customerId, input.lines);
  const note = formatNoOrderShipOutRemark(input.remark, input.deliveryNoteNo);
  const orderRef = customer.code?.trim() || customer.name?.trim() || customer.id;
  const inboundIds: string[] = [];

  await db.$transaction(async (tx) => {
    for (const line of previews) {
      const agg = await tx.productInbound.aggregate({
        where: { productId: line.productId },
        _sum: { quantity: true },
      });
      const haveNow = Number(agg._sum.quantity ?? 0);
      if (haveNow < line.shipQty) {
        throw new WarehouseProductShipOutError(
          `「${line.productLabel}」出货前商品库存校验失败（当前 ${haveNow}，需 ${line.shipQty}）。`,
        );
      }

      const created = await tx.productInbound.create({
        data: {
          productId: line.productId,
          quantity: -line.shipQty,
          receivedAt: input.shippedAt,
          purchaseOrderNo: orderRef,
          partDescription: WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK,
          remark: note,
          operatorUserId: input.operatorUserId,
        },
      });
      inboundIds.push(created.id);
    }
  });

  return { lines: previews, shippedAt: input.shippedAt.toISOString(), inboundIds };
}

export async function attachNoOrderShipOutDeliveryNote(
  db: PrismaClient,
  inboundIds: string[],
  deliveryNoteNo: string,
): Promise<number> {
  const doc = deliveryNoteNo?.trim();
  if (!doc) {
    throw new WarehouseProductShipOutError("送货单号无效");
  }
  const ids = [...new Set(inboundIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    throw new WarehouseProductShipOutError("缺少出库流水 ID");
  }

  const rows = await db.productInbound.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      quantity: true,
      partDescription: true,
      remark: true,
    },
  });
  if (rows.length === 0) {
    throw new WarehouseProductShipOutError("未找到无单出货流水", 404);
  }

  let updated = 0;
  await db.$transaction(async (tx) => {
    for (const row of rows) {
      if (!isNoOrderShipOutInbound(row)) continue;
      await tx.productInbound.update({
        where: { id: row.id },
        data: {
          remark: formatNoOrderShipOutRemark(
            parseNoOrderShipOutRemarkExtra(row.remark),
            doc,
          ),
        },
      });
      updated += 1;
    }
  });

  if (updated === 0) {
    throw new WarehouseProductShipOutError("未找到可更新的无单出货流水", 404);
  }
  return updated;
}

function isNoOrderShipOutInbound(row: {
  quantity: number;
  partDescription?: string | null;
  remark?: string | null;
}): boolean {
  if (row.quantity >= 0) return false;
  const part = row.partDescription?.trim() ?? "";
  const remark = row.remark?.trim() ?? "";
  if (part === WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK || part === "无单出库") {
    return true;
  }
  return remark.includes(WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK) || remark.includes("无单出库");
}
