-- Add deprecation fields for materials
ALTER TABLE "public"."Material"
ADD COLUMN "isDeprecated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "deprecatedAt" TIMESTAMP(3),
ADD COLUMN "deprecatedReason" TEXT;

CREATE INDEX "Material_isDeprecated_idx" ON "public"."Material"("isDeprecated");
