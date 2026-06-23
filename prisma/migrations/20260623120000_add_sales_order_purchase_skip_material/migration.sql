-- CreateTable
CREATE TABLE "SalesOrderPurchaseSkipMaterial" (
    "salesOrderId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderPurchaseSkipMaterial_pkey" PRIMARY KEY ("salesOrderId","materialId")
);

-- CreateIndex
CREATE INDEX "SalesOrderPurchaseSkipMaterial_materialId_idx" ON "SalesOrderPurchaseSkipMaterial"("materialId");

-- AddForeignKey
ALTER TABLE "SalesOrderPurchaseSkipMaterial" ADD CONSTRAINT "SalesOrderPurchaseSkipMaterial_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderPurchaseSkipMaterial" ADD CONSTRAINT "SalesOrderPurchaseSkipMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
