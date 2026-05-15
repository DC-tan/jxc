-- Material stock limits: 0 means unset -> store NULL
ALTER TABLE "Material"
ALTER COLUMN "safetyStock" DROP NOT NULL,
ALTER COLUMN "safetyStock" DROP DEFAULT,
ALTER COLUMN "maxStock" DROP NOT NULL,
ALTER COLUMN "maxStock" DROP DEFAULT;

UPDATE "Material"
SET
  "safetyStock" = NULL
WHERE "safetyStock" = 0;

UPDATE "Material"
SET
  "maxStock" = NULL
WHERE "maxStock" = 0;

-- Product stock limits: 0 means unset -> store NULL
ALTER TABLE "Product"
ALTER COLUMN "safetyStock" DROP NOT NULL,
ALTER COLUMN "safetyStock" DROP DEFAULT,
ALTER COLUMN "maxStock" DROP NOT NULL,
ALTER COLUMN "maxStock" DROP DEFAULT;

UPDATE "Product"
SET
  "safetyStock" = NULL
WHERE "safetyStock" = 0;

UPDATE "Product"
SET
  "maxStock" = NULL
WHERE "maxStock" = 0;
