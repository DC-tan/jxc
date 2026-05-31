-- CreateEnum
CREATE TYPE "MaterialPurchaseChannel" AS ENUM ('STANDARD_PURCHASE', 'PROCESSING_CONTRACT');

-- AlterTable
ALTER TABLE "Material"
ADD COLUMN "purchaseChannel" "MaterialPurchaseChannel" NOT NULL DEFAULT 'STANDARD_PURCHASE';

-- AlterTable
ALTER TABLE "PurchaseOrder"
ADD COLUMN "purchaseChannel" "MaterialPurchaseChannel" NOT NULL DEFAULT 'STANDARD_PURCHASE';

-- Data migration: mark all PCB materials as processing-contract procurement
UPDATE "Material"
SET "purchaseChannel" = 'PROCESSING_CONTRACT'
WHERE "kind" = 'PCB'
   OR "kindId" IN (
     SELECT "id" FROM "MaterialPresetKind" WHERE "name" = 'PCB'
   );

-- Data migration: classify existing purchase orders by their line materials
UPDATE "PurchaseOrder" AS po
SET "purchaseChannel" = 'PROCESSING_CONTRACT'
WHERE EXISTS (
  SELECT 1
  FROM "PurchaseOrderLine" AS pol
  JOIN "Material" AS m ON m."id" = pol."materialId"
  WHERE pol."purchaseOrderId" = po."id"
    AND m."purchaseChannel" = 'PROCESSING_CONTRACT'
);
