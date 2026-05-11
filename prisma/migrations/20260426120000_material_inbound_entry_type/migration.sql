-- CreateEnum
CREATE TYPE "MaterialInboundEntryType" AS ENUM ('REGULAR', 'MANUAL_STOCK_ADJUST');

-- AlterTable
ALTER TABLE "MaterialInbound" ADD COLUMN "entryType" "MaterialInboundEntryType" NOT NULL DEFAULT 'REGULAR';
