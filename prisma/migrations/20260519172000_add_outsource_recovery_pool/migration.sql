-- CreateEnum
CREATE TYPE "public"."OutsourceRecoveryEntryType" AS ENUM ('RECOVERY', 'MANUAL_STOCK_ADJUST', 'SHIP_CONSUME');

-- CreateTable
CREATE TABLE "public"."OutsourceRecoveryInbound" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "outsourceOrderId" TEXT,
    "outsourceOrderNo" TEXT,
    "quantity" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "partDescription" TEXT,
    "remark" TEXT,
    "entryType" "public"."OutsourceRecoveryEntryType" NOT NULL DEFAULT 'RECOVERY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operatorUserId" TEXT,

    CONSTRAINT "OutsourceRecoveryInbound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutsourceRecoveryInbound_productId_idx" ON "public"."OutsourceRecoveryInbound"("productId");

-- CreateIndex
CREATE INDEX "OutsourceRecoveryInbound_outsourceOrderId_idx" ON "public"."OutsourceRecoveryInbound"("outsourceOrderId");

-- CreateIndex
CREATE INDEX "OutsourceRecoveryInbound_outsourceOrderNo_idx" ON "public"."OutsourceRecoveryInbound"("outsourceOrderNo");

-- CreateIndex
CREATE INDEX "OutsourceRecoveryInbound_receivedAt_idx" ON "public"."OutsourceRecoveryInbound"("receivedAt");

-- CreateIndex
CREATE INDEX "OutsourceRecoveryInbound_operatorUserId_idx" ON "public"."OutsourceRecoveryInbound"("operatorUserId");

-- AddForeignKey
ALTER TABLE "public"."OutsourceRecoveryInbound" ADD CONSTRAINT "OutsourceRecoveryInbound_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OutsourceRecoveryInbound" ADD CONSTRAINT "OutsourceRecoveryInbound_outsourceOrderId_fkey" FOREIGN KEY ("outsourceOrderId") REFERENCES "public"."OutsourceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OutsourceRecoveryInbound" ADD CONSTRAINT "OutsourceRecoveryInbound_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
