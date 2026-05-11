import type { Prisma } from "@prisma/client";

export const CUSTOMER_SUPPLY_SUPPLIER_CODE = "CUSTOMER-SUPPLY";
export const CUSTOMER_SUPPLY_SUPPLIER_NAME = "客供料（系统）";

/**
 * 客供料在数据库层仍关联供应商字段（兼容现有结构），统一绑定到系统占位供应商。
 */
export async function ensureCustomerSupplySupplier(
  tx: Prisma.TransactionClient,
): Promise<{ id: string }> {
  const exists = await tx.supplier.findFirst({
    where: {
      OR: [
        { code: CUSTOMER_SUPPLY_SUPPLIER_CODE },
        { name: CUSTOMER_SUPPLY_SUPPLIER_NAME },
      ],
    },
    select: { id: true },
  });
  if (exists) return exists;
  const created = await tx.supplier.create({
    data: {
      code: CUSTOMER_SUPPLY_SUPPLIER_CODE,
      name: CUSTOMER_SUPPLY_SUPPLIER_NAME,
      attrProduction: false,
      attrProcessing: false,
    },
    select: { id: true },
  });
  return created;
}
