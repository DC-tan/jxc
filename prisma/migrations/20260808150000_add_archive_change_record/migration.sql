-- CreateEnum
CREATE TYPE "ArchiveChangeKind" AS ENUM ('VERSION', 'PRICE');

-- CreateEnum
CREATE TYPE "ArchiveChangeTarget" AS ENUM ('PRODUCT', 'MATERIAL');

-- CreateTable
CREATE TABLE "ArchiveChangeRecord" (
    "id" TEXT NOT NULL,
    "targetType" "ArchiveChangeTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "kind" "ArchiveChangeKind" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL,
    "beforeText" TEXT NOT NULL,
    "afterText" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveChangeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArchiveChangeRecord_targetType_targetId_kind_changedAt_idx" ON "ArchiveChangeRecord"("targetType", "targetId", "kind", "changedAt");

-- CreateIndex
CREATE INDEX "ArchiveChangeRecord_createdById_idx" ON "ArchiveChangeRecord"("createdById");

-- AddForeignKey
ALTER TABLE "ArchiveChangeRecord" ADD CONSTRAINT "ArchiveChangeRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
