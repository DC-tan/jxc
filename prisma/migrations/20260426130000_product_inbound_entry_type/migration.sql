-- CreateEnum
CREATE TYPE "ProductInboundEntryType" AS ENUM ('REGULAR', 'MANUAL_STOCK_ADJUST');

-- AlterTable
ALTER TABLE "ProductInbound" ADD COLUMN "entryType" "ProductInboundEntryType" NOT NULL DEFAULT 'REGULAR';
