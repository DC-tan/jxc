-- CreateEnum
CREATE TYPE "ProductBomLineScope" AS ENUM ('DEFAULT', 'OUTSOURCE', 'INHOUSE');

-- AlterTable: add column with default, backfill
ALTER TABLE "ProductMaterial" ADD COLUMN "scope" "ProductBomLineScope" NOT NULL DEFAULT 'DEFAULT';

-- Drop old unique, add composite unique
ALTER TABLE "ProductMaterial" DROP CONSTRAINT IF EXISTS "ProductMaterial_productId_materialId_key";
CREATE UNIQUE INDEX "ProductMaterial_productId_materialId_scope_key" ON "ProductMaterial"("productId", "materialId", "scope");
