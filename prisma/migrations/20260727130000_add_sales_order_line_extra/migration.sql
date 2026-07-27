-- CreateEnum
CREATE TYPE "SalesOrderLineKind" AS ENUM ('PRODUCT', 'EXTRA');

-- AlterTable
ALTER TABLE "SalesOrderLine" ADD COLUMN "lineKind" "SalesOrderLineKind" NOT NULL DEFAULT 'PRODUCT';
ALTER TABLE "SalesOrderLine" ADD COLUMN "title" VARCHAR(200);

-- DropForeignKey
ALTER TABLE "SalesOrderLine" DROP CONSTRAINT "SalesOrderLine_productId_fkey";

-- AlterColumn: productId nullable
ALTER TABLE "SalesOrderLine" ALTER COLUMN "productId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "SalesOrderLine_lineKind_idx" ON "SalesOrderLine"("lineKind");
