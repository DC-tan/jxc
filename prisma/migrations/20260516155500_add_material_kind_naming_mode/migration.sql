-- CreateEnum
CREATE TYPE "MaterialKindNamingMode" AS ENUM ('STANDARD', 'CUSTOM');

-- AlterTable
ALTER TABLE "MaterialPresetKind"
ADD COLUMN "namingMode" "MaterialKindNamingMode" NOT NULL DEFAULT 'STANDARD';
