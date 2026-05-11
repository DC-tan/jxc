export type CustomerLookup = { id: string; code: string; name: string };

/** 与导入模板表头一致 */
export const PRODUCT_IMPORT_HEADERS = [
  "客户名称",
  "物料编号",
  "机型号",
  "商品型号",
  "商品规格",
  "单位",
  "价格",
  "加工成本",
  "安全库存",
  "最大库存",
  "注意事项",
] as const;

/** 客户：编号或名称匹配 */
export function resolveCustomerId(
  raw: string,
  customers: CustomerLookup[],
): string | null {
  const s = raw.trim();
  if (!s) return null;
  const byCode = customers.find((x) => x.code === s);
  if (byCode) return byCode.id;
  const byName = customers.find((x) => x.name === s);
  if (byName) return byName.id;
  const lower = s.toLowerCase();
  const byNameI = customers.find((x) => x.name.toLowerCase() === lower);
  if (byNameI) return byNameI.id;
  return null;
}

export function normalizeHeaderKey(key: string): string {
  return String(key).replace(/\s/g, "").trim();
}

export function mapHeaderRow(row: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  row.forEach((cell, i) => {
    const k = normalizeHeaderKey(String(cell ?? ""));
    if (k) map.set(k, i);
  });
  return map;
}

export function parseNonNegativeDecimal(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && !Number.isNaN(raw)) {
    if (raw < 0) return null;
    return String(raw);
  }
  const s = String(raw).trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  if (Number.isNaN(n) || n < 0) return null;
  return String(n);
}
