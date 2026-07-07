-- 销售单拆采购：按供应商记录「确认」与已生成采购单，用于列表是否仍可选
CREATE TABLE "SalesOrderPurchaseSupplierConfirm" (
    "salesOrderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "purchaseOrderId" TEXT,

    CONSTRAINT "SalesOrderPurchaseSupplierConfirm_pkey" PRIMARY KEY ("salesOrderId","supplierId")
);

CREATE INDEX "SalesOrderPurchaseSupplierConfirm_supplierId_idx" ON "SalesOrderPurchaseSupplierConfirm"("supplierId");
CREATE INDEX "SalesOrderPurchaseSupplierConfirm_purchaseOrderId_idx" ON "SalesOrderPurchaseSupplierConfirm"("purchaseOrderId");

ALTER TABLE "SalesOrderPurchaseSupplierConfirm" ADD CONSTRAINT "SalesOrderPurchaseSupplierConfirm_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesOrderPurchaseSupplierConfirm" ADD CONSTRAINT "SalesOrderPurchaseSupplierConfirm_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesOrderPurchaseSupplierConfirm" ADD CONSTRAINT "SalesOrderPurchaseSupplierConfirm_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
