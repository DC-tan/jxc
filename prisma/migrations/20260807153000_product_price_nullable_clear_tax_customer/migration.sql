-- 未税价改为可空；含税客户历史商品清空未税价（价已在含税价中）
ALTER TABLE "Product" ALTER COLUMN "price" DROP NOT NULL;

UPDATE "Product" AS p
SET "price" = NULL
FROM "Customer" AS c
WHERE c."id" = p."customerId"
  AND c."priceIncludesTax" = true;
