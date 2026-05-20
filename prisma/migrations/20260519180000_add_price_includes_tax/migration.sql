-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "priceIncludesTax" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "priceIncludesTax" BOOLEAN NOT NULL DEFAULT false;
