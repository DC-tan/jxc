-- AlterTable
ALTER TABLE "OutsourceOrderLine" ADD COLUMN "issuedQuantity" INTEGER NOT NULL DEFAULT 0;

-- 历史数据：发料数至少为当前在外量或本单仓库外发出库量
UPDATE "OutsourceOrderLine" AS ol
SET "issuedQuantity" = GREATEST(
  ol."quantity",
  COALESCE((
    SELECT SUM(ABS(mi."quantity"))::INTEGER
    FROM "MaterialInbound" AS mi
    INNER JOIN "OutsourceOrder" AS oo ON oo."orderNo" = mi."purchaseOrderNo"
    WHERE oo."id" = ol."outsourceOrderId"
      AND mi."materialId" = ol."materialId"
      AND mi."quantity" < 0
  ), 0)
);
