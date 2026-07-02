-- 送货单确认后只读凭证（预览与打印一致）
CREATE TABLE "DeliveryNoteVoucher" (
    "id" TEXT NOT NULL,
    "documentNo" VARCHAR(64) NOT NULL,
    "customerId" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL,
    "mergedShip" BOOLEAN NOT NULL DEFAULT false,
    "snapshot" JSONB NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryNoteVoucher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryNoteVoucher_documentNo_key" ON "DeliveryNoteVoucher"("documentNo");
CREATE INDEX "DeliveryNoteVoucher_customerId_idx" ON "DeliveryNoteVoucher"("customerId");
CREATE INDEX "DeliveryNoteVoucher_deliveredAt_idx" ON "DeliveryNoteVoucher"("deliveredAt");

ALTER TABLE "DeliveryNoteVoucher" ADD CONSTRAINT "DeliveryNoteVoucher_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
