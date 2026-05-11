/** sessionStorage 草稿：确认出货后先可能进入「自加工补产」再进送货单；点「完成」才调用 deliver API */
export const WAREHOUSE_DELIVERY_DRAFT_KEY = "warehouse-delivery-slip-draft";

export type WarehouseDeliveryLineDraft = {
  lineId: string;
  /** 本批实际出货数：在「确认出货」弹窗填写，可超过待交/订单行；自加工与 deliver 均以此为基准 */
  shipQty: number;
  /** 仅兼容旧草稿：曾在打印页改总数量时存在；新流程勿写 */
  lineTotal?: number;
  /** 备品件数；总出库 = shipQty + spareQty（与备注「备品」行一致） */
  spareQty?: number;
  /** 用户「添加备注信息」的附加说明 */
  userRemark?: string;
};

export type WarehouseDeliveryDraft = {
  orderId: string;
  actualDeliveredAt: string;
  lines: WarehouseDeliveryLineDraft[];
  /** 自加工缺额行在补产页填写的本批成品「现入库」数量，与 shipQty 一并提交 deliver */
  inhouseProduceByLineId?: Record<string, number>;
  /** 送货单 NO（年度流水，进入打印页时分配，写入后保存草稿） */
  documentNo?: string;
};
