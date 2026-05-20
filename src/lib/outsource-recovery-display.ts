/** 外发回收库展示用：半成品相对商品档案客户料号的前缀 */
export const OUTSOURCE_RECOVERY_MATERIAL_CODE_PREFIX = "WF-";

/** 外发回收库列表/弹窗展示的料号（在商品客户物料编号前加 WF-） */
export function formatOutsourceRecoveryMaterialCode(
  customerMaterialCode: string | null | undefined,
): string {
  const raw = (customerMaterialCode ?? "").trim();
  if (!raw) return "—";
  const prefix = OUTSOURCE_RECOVERY_MATERIAL_CODE_PREFIX;
  if (raw.toUpperCase().startsWith(prefix.toUpperCase())) return raw;
  return `${prefix}${raw}`;
}

/** 查询时去掉用户输入的 WF-，便于按商品档案料号检索 */
export function normalizeOutsourceRecoverySearchKeyword(keyword: string): string {
  const k = keyword.trim();
  const prefix = OUTSOURCE_RECOVERY_MATERIAL_CODE_PREFIX;
  if (k.toUpperCase().startsWith(prefix.toUpperCase())) {
    return k.slice(prefix.length).trim();
  }
  return k;
}

export function outsourceRecoveryStockSearchText(row: {
  customerCode: string;
  customerName: string;
  customerMaterialCode: string;
  model: string;
}): string {
  const code = row.customerMaterialCode.trim();
  const display = formatOutsourceRecoveryMaterialCode(code);
  return [row.customerCode, row.customerName, code, display, row.model]
    .join(" ")
    .toLowerCase();
}
