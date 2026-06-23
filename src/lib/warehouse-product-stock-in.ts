import type { Prisma, PrismaClient } from "@prisma/client";
import { bomNeedForShort } from "@/lib/bom-need";
import {
  shipmentMaterialPartLabel,
  shipmentProductModelLabel,
} from "@/lib/inhouse-bom-display";
import { getMaterialInboundTotalsByIds } from "@/lib/materialStock";
import { formatOutsourceRecoveryMaterialCode } from "@/lib/outsource-recovery-display";
import { getOutsourceRecoveryQtyByProductId } from "@/lib/outsource-recovery-stock";
import { productBomForInhouseProduction } from "@/lib/product-bom-scope";

type DbClient = PrismaClient | Prisma.TransactionClient;

/** 无单入库流水固定备注，便于对帐与明细筛选 */
export const WAREHOUSE_NO_ORDER_STOCK_IN_REMARK = "无单入库";

/** 历史流水备注（功能升级前） */
export const WAREHOUSE_PRODUCT_STOCK_IN_REMARK_LEGACY = "仓库 · 商品入库";

/** @deprecated 请使用 WAREHOUSE_NO_ORDER_STOCK_IN_REMARK */
export const WAREHOUSE_PRODUCT_STOCK_IN_REMARK_DEFAULT =
  WAREHOUSE_PRODUCT_STOCK_IN_REMARK_LEGACY;

export function formatNoOrderStockInRemark(extra?: string | null): string {
  const extraTrim = extra?.trim();
  return extraTrim
    ? `${WAREHOUSE_NO_ORDER_STOCK_IN_REMARK}；${extraTrim}`
    : WAREHOUSE_NO_ORDER_STOCK_IN_REMARK;
}

function stockInHistoryRemarkOr(): Prisma.ProductInboundWhereInput {
  return {
    OR: [
      { remark: { contains: WAREHOUSE_NO_ORDER_STOCK_IN_REMARK } },
      { remark: { contains: WAREHOUSE_PRODUCT_STOCK_IN_REMARK_LEGACY } },
      { partDescription: { contains: "·商品入库" } },
    ],
  };
}

export function buildWarehouseProductStockInHistoryWhere(params: {
  keyword?: string;
  receivedFrom?: Date;
  receivedTo?: Date;
}): Prisma.ProductInboundWhereInput {
  const andParts: Prisma.ProductInboundWhereInput[] = [
    {
      quantity: { gt: 0 },
      ...stockInHistoryRemarkOr(),
    },
  ];
  if (params.receivedFrom || params.receivedTo) {
    andParts.push({
      receivedAt: {
        ...(params.receivedFrom ? { gte: params.receivedFrom } : {}),
        ...(params.receivedTo ? { lte: params.receivedTo } : {}),
      },
    });
  }
  const keyword = params.keyword?.trim();
  if (keyword) {
    andParts.push({
      OR: [
        { product: { model: { contains: keyword, mode: "insensitive" } } },
        {
          product: {
            customerMaterialCode: { contains: keyword, mode: "insensitive" },
          },
        },
        { remark: { contains: keyword, mode: "insensitive" } },
        { partDescription: { contains: keyword, mode: "insensitive" } },
        {
          operator: { name: { contains: keyword, mode: "insensitive" } },
        },
        {
          operator: {
            employeeNo: { contains: keyword, mode: "insensitive" },
          },
        },
      ],
    });
  }
  return andParts.length === 1 ? andParts[0]! : { AND: andParts };
}

export function isWarehouseProductStockInRecord(row: {
  quantity: number;
  partDescription?: string | null;
  remark?: string | null;
}): boolean {
  if (row.quantity <= 0) return false;
  if ((row.partDescription ?? "").includes("·商品入库")) return true;
  const r = row.remark ?? "";
  return (
    r.includes(WAREHOUSE_NO_ORDER_STOCK_IN_REMARK) ||
    r.includes(WAREHOUSE_PRODUCT_STOCK_IN_REMARK_LEGACY)
  );
}

export type ProductStockInBomRow = {
  materialId: string;
  materialCode: string;
  materialName: string;
  materialPart: string;
  usageQty: number;
  materialStock: number;
  needQty: number;
};

export type ProductStockInPreviewLine = {
  productId: string;
  productLabel: string;
  customerMaterialCode: string;
  unit: string;
  processingMode: "INHOUSE" | "OUTSOURCE_INHOUSE";
  productStock: number;
  recoveryStock: number | null;
  quantity: number;
  bom: ProductStockInBomRow[];
};

type ProductForStockIn = {
  id: string;
  model: string;
  customerMaterialCode: string;
  unit: string;
  processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
  productMaterials: {
    materialId: string;
    scope: "DEFAULT" | "OUTSOURCE" | "INHOUSE";
    usageQty: unknown;
    material: {
      code: string;
      name: string;
      partDescription: string | null;
    };
  }[];
};

export class WarehouseProductStockInError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "WarehouseProductStockInError";
  }
}

function toPositiveInt(v: unknown): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return 0;
  return n;
}

export function parseProductStockInQuantity(v: unknown): number {
  const n = toPositiveInt(v);
  if (n <= 0) {
    throw new WarehouseProductStockInError("入库数量须为正整数");
  }
  return n;
}

async function loadProduct(
  db: DbClient,
  productId: string,
): Promise<(ProductForStockIn & { isDeprecated: boolean }) | null> {
  return db.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      model: true,
      customerMaterialCode: true,
      unit: true,
      processingMode: true,
      isDeprecated: true,
      productMaterials: {
        orderBy: { sortOrder: "asc" },
        select: {
          materialId: true,
          scope: true,
          usageQty: true,
          material: {
            select: {
              code: true,
              name: true,
              partDescription: true,
            },
          },
        },
      },
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

export async function buildProductStockInPreviewLine(
  db: DbClient,
  productId: string,
  quantityInput: unknown,
): Promise<ProductStockInPreviewLine> {
  const quantity = parseProductStockInQuantity(quantityInput);
  const product = await loadProduct(db, productId);
  if (!product) {
    throw new WarehouseProductStockInError("商品不存在", 404);
  }
  if (product.isDeprecated) {
    throw new WarehouseProductStockInError("该商品已弃用，不能入库");
  }

  const productLabel = shipmentProductModelLabel(product);
  const unit = product.unit?.trim() || "—";
  const productStock = await productStockQty(db, product.id);

  if (product.processingMode === "OUTSOURCE") {
    throw new WarehouseProductStockInError(
      `「${productLabel}」为外发加工商品，请通过「物料外发 → 确认回收」办理成品入库。`,
    );
  }

  const boms = productBomForInhouseProduction(
    product.processingMode,
    product.productMaterials ?? [],
  );
  if (boms.length === 0) {
    throw new WarehouseProductStockInError(
      `「${productLabel}」未维护自加工侧 BOM，无法扣减物料入库。请先在商品信息中维护 BOM。`,
    );
  }

  let recoveryStock: number | null = null;
  if (product.processingMode === "OUTSOURCE_INHOUSE") {
    recoveryStock = await getOutsourceRecoveryQtyByProductId(db, product.id);
    const recoveryLabel = formatOutsourceRecoveryMaterialCode(
      product.customerMaterialCode,
    );
    if (recoveryStock < quantity) {
      throw new WarehouseProductStockInError(
        `「${recoveryLabel} / ${productLabel}」外发回收库库存不足（当前 ${recoveryStock}，本次入库 ${quantity}）。请先在「物料外发 → 外发回收库」补充库存。`,
      );
    }
  }

  const matIds = boms.map((b) => b.materialId);
  const stockMap = await getMaterialInboundTotalsByIds(db, matIds);
  const bom: ProductStockInBomRow[] = [];
  for (const b of boms) {
    const u = Number(b.usageQty);
    const usageQty = Number.isFinite(u) && u > 0 ? u : 0;
    const needQty = bomNeedForShort(b.usageQty, quantity);
    const materialStock = stockMap.get(b.materialId) ?? 0;
    const materialPart = shipmentMaterialPartLabel(b.material);
    bom.push({
      materialId: b.materialId,
      materialCode: b.material.code?.trim() || b.materialId,
      materialName: b.material.name?.trim() || "—",
      materialPart,
      usageQty,
      materialStock,
      needQty,
    });
    if (needQty > 0 && materialStock < needQty) {
      throw new WarehouseProductStockInError(
        `「${productLabel}」入库 ${quantity} 件时，物料「${materialPart}」库存不足（当前 ${materialStock}，需 ${needQty}）。`,
      );
    }
  }

  return {
    productId: product.id,
    productLabel,
    customerMaterialCode: product.customerMaterialCode?.trim() || "—",
    unit,
    processingMode: product.processingMode,
    productStock,
    recoveryStock,
    quantity,
    bom,
  };
}

export async function previewProductStockIn(
  db: DbClient,
  lines: { productId: string; quantity: unknown }[],
): Promise<ProductStockInPreviewLine[]> {
  if (lines.length === 0) {
    throw new WarehouseProductStockInError("请至少添加一行商品");
  }
  const seen = new Set<string>();
  const result: ProductStockInPreviewLine[] = [];
  for (const row of lines) {
    if (seen.has(row.productId)) {
      throw new WarehouseProductStockInError("存在重复的商品行");
    }
    seen.add(row.productId);
    result.push(
      await buildProductStockInPreviewLine(db, row.productId, row.quantity),
    );
  }
  return result;
}

export async function applyProductStockInLine(
  tx: Prisma.TransactionClient,
  preview: ProductStockInPreviewLine,
  receivedAt: Date,
  operatorUserId: string,
  remark?: string | null,
): Promise<void> {
  const product = await loadProduct(tx, preview.productId);
  if (!product) {
    throw new WarehouseProductStockInError("商品不存在", 404);
  }

  const productLabel = shipmentProductModelLabel(product);
  const label = productLabel === "—" ? "商品" : productLabel;
  const produce = preview.quantity;
  const boms = productBomForInhouseProduction(
    product.processingMode,
    product.productMaterials ?? [],
  );

  if (product.processingMode === "OUTSOURCE_INHOUSE") {
    const recoveryQty = await getOutsourceRecoveryQtyByProductId(
      tx,
      preview.productId,
    );
    if (recoveryQty < produce) {
      const recoveryLabel = formatOutsourceRecoveryMaterialCode(
        product.customerMaterialCode,
      );
      throw new WarehouseProductStockInError(
        `「${recoveryLabel} / ${productLabel}」外发回收库库存不足（当前 ${recoveryQty}，本次入库 ${produce}）。`,
      );
    }

    for (const b of boms) {
      const need = bomNeedForShort(b.usageQty, produce);
      if (need <= 0) continue;
      const stockMap = await getMaterialInboundTotalsByIds(tx, [b.materialId]);
      const stock = stockMap.get(b.materialId) ?? 0;
      if (stock < need) {
        throw new WarehouseProductStockInError(
          `「${productLabel}」入库时物料「${shipmentMaterialPartLabel(b.material)}」库存不足（当前 ${stock}，需 ${need}）。`,
        );
      }
      await tx.materialInbound.create({
        data: {
          materialId: b.materialId,
          quantity: -need,
          receivedAt,
          partDescription: `外发+自加工扣料·商品入库（${label}×${produce}）`,
          operatorUserId,
        },
      });
    }

    await tx.outsourceRecoveryInbound.create({
      data: {
        productId: preview.productId,
        quantity: -produce,
        receivedAt,
        entryType: "SHIP_CONSUME",
        partDescription: `商品入库消耗外发回收库（${label}×${produce}）`,
        remark: formatNoOrderStockInRemark(remark),
        operatorUserId,
      },
    });

    await tx.productInbound.create({
      data: {
        productId: preview.productId,
        quantity: produce,
        receivedAt,
        partDescription: `外发回收库结转·商品入库（${label}×${produce}）`,
        remark: formatNoOrderStockInRemark(remark),
        operatorUserId,
      },
    });
    return;
  }

  for (const b of boms) {
    const need = bomNeedForShort(b.usageQty, produce);
    if (need <= 0) continue;
    const stockMap = await getMaterialInboundTotalsByIds(tx, [b.materialId]);
    const stock = stockMap.get(b.materialId) ?? 0;
    if (stock < need) {
      throw new WarehouseProductStockInError(
        `「${productLabel}」入库时物料「${shipmentMaterialPartLabel(b.material)}」库存不足（当前 ${stock}，需 ${need}）。`,
      );
    }
    await tx.materialInbound.create({
      data: {
        materialId: b.materialId,
        quantity: -need,
        receivedAt,
        partDescription: `自加工扣料·商品入库（${label}×${produce}）`,
        operatorUserId,
      },
    });
  }

  await tx.productInbound.create({
    data: {
      productId: preview.productId,
      quantity: produce,
      receivedAt,
      partDescription: `自加工完工入库·商品入库（${produce}）`,
      remark: formatNoOrderStockInRemark(remark),
      operatorUserId,
    },
  });
}

export async function executeProductStockIn(
  db: PrismaClient,
  input: {
    lines: { productId: string; quantity: unknown }[];
    receivedAt: Date;
    operatorUserId: string;
    remark?: string | null;
  },
): Promise<{ lines: ProductStockInPreviewLine[]; receivedAt: string }> {
  const previews = await previewProductStockIn(db, input.lines);
  await db.$transaction(async (tx) => {
    for (const line of previews) {
      await applyProductStockInLine(
        tx,
        line,
        input.receivedAt,
        input.operatorUserId,
        input.remark,
      );
    }
  });
  return { lines: previews, receivedAt: input.receivedAt.toISOString() };
}
