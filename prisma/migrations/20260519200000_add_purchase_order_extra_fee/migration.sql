-- CreateTable
CREATE TABLE "PurchaseOrderExtraFee" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "purpose" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderExtraFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrderExtraFee_purchaseOrderId_idx" ON "PurchaseOrderExtraFee"("purchaseOrderId");

-- AddForeignKey
ALTER TABLE "PurchaseOrderExtraFee" ADD CONSTRAINT "PurchaseOrderExtraFee_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
