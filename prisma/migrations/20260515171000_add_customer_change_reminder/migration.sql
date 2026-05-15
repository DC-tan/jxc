-- CreateEnum
CREATE TYPE "CustomerChangeReminderStatus" AS ENUM (
  'ACTIVE',
  'DONE',
  'VOIDED'
);

-- CreateTable
CREATE TABLE "CustomerChangeReminder" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "changeSummary" TEXT NOT NULL,
  "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "CustomerChangeReminderStatus" NOT NULL DEFAULT 'ACTIVE',
  "salesConfirmCount" INTEGER NOT NULL DEFAULT 0,
  "purchaseConfirmCount" INTEGER NOT NULL DEFAULT 0,
  "salesLastConfirmedAt" TIMESTAMP(3),
  "salesLastConfirmedById" TEXT,
  "purchaseLastConfirmedAt" TIMESTAMP(3),
  "purchaseLastConfirmedById" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerChangeReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerChangeReminder_customerId_productId_idx"
ON "CustomerChangeReminder"("customerId", "productId");

-- CreateIndex
CREATE INDEX "CustomerChangeReminder_status_proposedAt_idx"
ON "CustomerChangeReminder"("status", "proposedAt");

-- CreateIndex
CREATE INDEX "CustomerChangeReminder_createdById_idx"
ON "CustomerChangeReminder"("createdById");

-- AddForeignKey
ALTER TABLE "CustomerChangeReminder"
ADD CONSTRAINT "CustomerChangeReminder_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerChangeReminder"
ADD CONSTRAINT "CustomerChangeReminder_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerChangeReminder"
ADD CONSTRAINT "CustomerChangeReminder_salesLastConfirmedById_fkey"
FOREIGN KEY ("salesLastConfirmedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerChangeReminder"
ADD CONSTRAINT "CustomerChangeReminder_purchaseLastConfirmedById_fkey"
FOREIGN KEY ("purchaseLastConfirmedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerChangeReminder"
ADD CONSTRAINT "CustomerChangeReminder_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
