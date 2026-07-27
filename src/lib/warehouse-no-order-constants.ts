/** 无单出货 / 免费赠送：备注常量（独立文件，避免与查询模块循环依赖） */

/** 无单出货流水固定说明（partDescription），便于对帐识别 */
export const WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK = "无单出货";

/** 无单出货「免费」：帐单有出货记录，金额为 0 */
export const WAREHOUSE_NO_ORDER_SHIP_OUT_FREE_REMARK = "免费赠送";

/** 历史说明文案 */
export const WAREHOUSE_NO_ORDER_SHIP_OUT_PART_LEGACY = "无单出库";

/** 备注是否表示免费赠送（单价/金额按 0 计） */
export function isNoOrderShipOutFreeRemark(
  remark?: string | null,
): boolean {
  const t = remark?.trim() ?? "";
  if (!t) return false;
  return (
    t === WAREHOUSE_NO_ORDER_SHIP_OUT_FREE_REMARK ||
    t.includes(WAREHOUSE_NO_ORDER_SHIP_OUT_FREE_REMARK)
  );
}

/** 用户未填写时默认「无单出货」 */
export function resolveNoOrderShipOutUserRemark(extra?: string | null): string {
  const t = extra?.trim();
  return t || WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK;
}

export function formatNoOrderShipOutRemark(
  extra?: string | null,
  deliveryNoteNo?: string | null,
): string {
  const parts = [resolveNoOrderShipOutUserRemark(extra)];
  const doc = deliveryNoteNo?.trim();
  if (doc) parts.push(`送货单号 ${doc}`);
  return parts.join("；");
}

/** 从已落库的 remark 解析用户备注（不含送货单号段） */
export function parseNoOrderShipOutRemarkExtra(
  stored: string | null | undefined,
): string | null {
  if (!stored?.trim()) return null;
  const segments = stored
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const body = segments.filter((s) => !/^送货单号\s/.test(s));
  if (body.length === 0) return null;
  if (body[0] === WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK) {
    const rest = body.slice(1).join("；");
    return rest || null;
  }
  const joined = body.join("；");
  return joined === WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK ? null : joined;
}
