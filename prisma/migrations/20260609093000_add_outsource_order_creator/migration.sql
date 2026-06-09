-- Add creator tracking for outsource orders
ALTER TABLE "OutsourceOrder"
ADD COLUMN "createdByUserId" TEXT;

CREATE INDEX "OutsourceOrder_createdByUserId_idx" ON "OutsourceOrder"("createdByUserId");

ALTER TABLE "OutsourceOrder"
ADD CONSTRAINT "OutsourceOrder_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
