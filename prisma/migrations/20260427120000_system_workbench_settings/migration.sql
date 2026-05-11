-- CreateTable
CREATE TABLE "SystemWorkbenchSettings" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemWorkbenchSettings_pkey" PRIMARY KEY ("id")
);
