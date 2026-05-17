-- CreateEnum
CREATE TYPE "TodoStatus" AS ENUM ('TODO', 'DEFERRED', 'DONE');

-- CreateTable
CREATE TABLE "TodoItem" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" "TodoStatus" NOT NULL DEFAULT 'TODO',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TodoItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TodoItem_userId_status_createdAt_idx"
ON "TodoItem"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TodoItem_userId_updatedAt_idx"
ON "TodoItem"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "TodoItem"
ADD CONSTRAINT "TodoItem_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
