-- Add deprecation fields for products
ALTER TABLE "public"."Product"
ADD COLUMN "isDeprecated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "deprecatedAt" TIMESTAMP(3),
ADD COLUMN "deprecatedReason" TEXT;

CREATE INDEX "Product_isDeprecated_idx" ON "public"."Product"("isDeprecated");
