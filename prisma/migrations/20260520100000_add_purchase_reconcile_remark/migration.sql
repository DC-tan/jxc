-- CreateTable
CREATE TABLE "PurchaseReconcileRemark" (
    "id" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "remark" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "PurchaseReconcileRemark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReconcileRemark_lineKey_key" ON "PurchaseReconcileRemark"("lineKey");

-- CreateIndex
CREATE INDEX "PurchaseReconcileRemark_updatedAt_idx" ON "PurchaseReconcileRemark"("updatedAt");
