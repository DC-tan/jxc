ALTER TABLE "TodoItem"
ADD COLUMN "serialNo" SERIAL;

UPDATE "TodoItem"
SET "serialNo" = nextval(pg_get_serial_sequence('"TodoItem"', 'serialNo'))
WHERE "serialNo" IS NULL;

ALTER TABLE "TodoItem"
ALTER COLUMN "serialNo" SET NOT NULL;

CREATE UNIQUE INDEX "TodoItem_serialNo_key"
ON "TodoItem"("serialNo");
