-- 从已有销售订单出货记录回填各客户当年最大流水，部署后下一张单从 max+1 续编
WITH parsed AS (
  SELECT
    so."customerId",
    CAST(SUBSTRING(TRIM(sl."deliveryNoteNo") FROM LENGTH(TRIM(sl."deliveryNoteNo")) - 10 FOR 4) AS INTEGER) AS yr,
    CAST(RIGHT(TRIM(sl."deliveryNoteNo"), 3) AS INTEGER) AS seq
  FROM "SalesOrderLineShipLog" sl
  INNER JOIN "SalesOrderLine" sol ON sol."id" = sl."salesOrderLineId"
  INNER JOIN "SalesOrder" so ON so."id" = sol."salesOrderId"
  WHERE sl."deliveryNoteNo" IS NOT NULL
    AND LENGTH(TRIM(sl."deliveryNoteNo")) >= 12
    AND RIGHT(TRIM(sl."deliveryNoteNo"), 11) ~ '^\d{11}$'
)
INSERT INTO "DeliveryNoteSerial" ("customerId", "year", "lastSeq")
SELECT "customerId", yr, MAX(seq)
FROM parsed
WHERE yr BETWEEN 2000 AND 2100 AND seq BETWEEN 1 AND 999
GROUP BY "customerId", yr
ON CONFLICT ("customerId", "year")
DO UPDATE SET "lastSeq" = GREATEST("DeliveryNoteSerial"."lastSeq", EXCLUDED."lastSeq");
