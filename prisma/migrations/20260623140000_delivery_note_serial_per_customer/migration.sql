-- 送货单流水：由全年全局递增改为按客户 + 年各自从 001 起
DROP TABLE IF EXISTS "DeliveryNoteSerial";

CREATE TABLE "DeliveryNoteSerial" (
    "customerId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DeliveryNoteSerial_pkey" PRIMARY KEY ("customerId","year")
);

ALTER TABLE "DeliveryNoteSerial" ADD CONSTRAINT "DeliveryNoteSerial_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
