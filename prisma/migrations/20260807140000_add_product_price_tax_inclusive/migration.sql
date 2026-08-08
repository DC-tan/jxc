-- AlterTable
ALTER TABLE "Product" ADD COLUMN "priceTaxInclusive" DECIMAL(14,4);

-- 含税客户：将现有「价格」同步为含税价，便于下单自动带入
UPDATE "Product" AS p
SET "priceTaxInclusive" = p."price"
FROM "Customer" AS c
WHERE c."id" = p."customerId"
  AND c."priceIncludesTax" = true;
