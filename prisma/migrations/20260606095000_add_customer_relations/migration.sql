-- CreateTable
CREATE TABLE "CustomerRelation" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "relatedCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerRelation_customerId_idx" ON "CustomerRelation"("customerId");

-- CreateIndex
CREATE INDEX "CustomerRelation_relatedCustomerId_idx" ON "CustomerRelation"("relatedCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRelation_customerId_relatedCustomerId_key" ON "CustomerRelation"("customerId", "relatedCustomerId");

-- AddForeignKey
ALTER TABLE "CustomerRelation" ADD CONSTRAINT "CustomerRelation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRelation" ADD CONSTRAINT "CustomerRelation_relatedCustomerId_fkey" FOREIGN KEY ("relatedCustomerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
