-- Add supplier info field for sample orders
ALTER TABLE "SampleOrder"
ADD COLUMN "supplierInfo" TEXT;
