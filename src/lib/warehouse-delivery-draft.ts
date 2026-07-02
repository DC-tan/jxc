/** sessionStorage 草稿：确认出货后可能经「自加工补产入库存」再进送货单；点「完成」才调用 deliver API */
export const WAREHOUSE_DELIVERY_DRAFT_KEY = "warehouse-delivery-slip-draft";

export type WarehouseDeliveryLineDraft = {
  lineId: string;
  /** 本批实际出货数：在「确认出货」弹窗填写，可超过待交/订单行；自加工与 deliver 均以此为基准 */
  shipQty: number;
  /** 仅兼容旧草稿：曾在打印页改总数量时存在；新流程勿写 */
  lineTotal?: number;
  /** 备品件数；只影响库存扣减与送货单备注，不计入订单已出货 */
  spareQty?: number;
  /** 用户「添加备注信息」的附加说明 */
  userRemark?: string;
};

export type WarehouseNoOrderLineMeta = {
  productId: string;
  model: string;
  customerMaterialCode: string;
  unit: string;
  spec?: string;
};

export type WarehouseDeliveryDraft = {
  orderId: string;
  actualDeliveredAt: string;
  lines: WarehouseDeliveryLineDraft[];
  /**
   * 自加工 / 外发+自加工：确认出货弹窗填写的本批自加工完工数（≥ 本批出货）。
   */
  inhouseProduceByLineId?: Record<string, number>;
  /** 与 inhouseProduceByLineId 相同键值；外发+自加工行 deliver API 优先读此字段 */
  hybridInhouseProduceByLineId?: Record<string, number>;
  /** 为 true 时进入「自加工补产入库存」页（完工数大于默认数） */
  needsInhouseStep?: boolean;
  /** 送货单 NO（年度流水，进入打印页时分配，写入后保存草稿） */
  documentNo?: string;
  /** 无单出货：点送货单页「确定」后扣减库存并落出库流水 */
  noOrderShipOut?: boolean;
  customerId?: string;
  /** lineId（= productId）→ 商品信息，供送货单渲染 */
  noOrderLineMeta?: Record<string, WarehouseNoOrderLineMeta>;
  noOrderCustomer?: { code: string; name: string; shortName?: string | null };
  /** 无单出货扣库存流水 ID，用于回写送货单号 */
  noOrderInboundIds?: string[];
  /** 无单出货备注；空则落库时默认「无单出货」 */
  noOrderShipOutRemark?: string;
};

export function buildNoOrderDeliveryDraft(input: {
  customerId: string;
  customer: { code: string; name: string; shortName?: string | null };
  shippedAt: string;
  lines: WarehouseDeliveryLineDraft[];
  noOrderLineMeta: Record<string, WarehouseNoOrderLineMeta>;
  noOrderInboundIds?: string[];
  noOrderShipOutRemark?: string;
}): WarehouseDeliveryDraft {
  const batchKey =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `no-${Date.now()}`;
  return {
    orderId: `no-order:${batchKey}`,
    noOrderShipOut: true,
    customerId: input.customerId,
    noOrderCustomer: input.customer,
    actualDeliveredAt: input.shippedAt,
    lines: input.lines,
    noOrderLineMeta: input.noOrderLineMeta,
    noOrderInboundIds: input.noOrderInboundIds,
    noOrderShipOutRemark: input.noOrderShipOutRemark?.trim() || undefined,
  };
}
