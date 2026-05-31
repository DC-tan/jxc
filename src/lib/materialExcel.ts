import { MaterialKind } from "@prisma/client";
import { DEFAULT_MATERIAL_KIND_IDS } from "@/lib/materialPresetConstants";
import { MATERIAL_KIND_LABEL } from "@/lib/materialLabels";

/** 与导入模板表头一致（必填列） */
export const MATERIAL_IMPORT_HEADERS = [
  "物料名称",
  "物料种类",
  "部件描述",
  "品牌",
  "供应商",
  "单位",
  "单价",
  "备注",
] as const;

/** 可选列：自定义名称种类建档时填写编号用的名称前缀 */
export const MATERIAL_IMPORT_OPTIONAL_HEADER = "名称前缀";

export type SupplierLookup = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
};

/** 按供应商编号、名称或简称匹配（名称、简称不区分大小写） */
export function resolveSupplierId(
  raw: string,
  suppliers: SupplierLookup[],
): string | null {
  const s = raw.trim();
  if (!s) return null;
  const byCode = suppliers.find((x) => x.code === s);
  if (byCode) return byCode.id;
  const byName = suppliers.find((x) => x.name === s);
  if (byName) return byName.id;
  const lower = s.toLowerCase();
  const byNameI = suppliers.find((x) => x.name.toLowerCase() === lower);
  if (byNameI) return byNameI.id;
  const byShort = suppliers.find(
    (x) => x.shortName?.trim() && x.shortName.trim() === s,
  );
  if (byShort) return byShort.id;
  const byShortI = suppliers.find(
    (x) =>
      x.shortName?.trim() &&
      x.shortName.trim().toLowerCase() === lower,
  );
  if (byShortI) return byShortI.id;
  return null;
}

const KIND_LABEL_TO_ENUM = (() => {
  const m = new Map<string, MaterialKind>();
  for (const [k, label] of Object.entries(MATERIAL_KIND_LABEL)) {
    m.set(label.trim(), k as MaterialKind);
    m.set(k.trim(), k as MaterialKind);
  }
  return m;
})();

export function parseMaterialKind(raw: unknown): MaterialKind | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const fromLabel = KIND_LABEL_TO_ENUM.get(s);
  if (fromLabel) return fromLabel;
  const upper = s.toUpperCase();
  if ((Object.values(MaterialKind) as string[]).includes(upper)) {
    return upper as MaterialKind;
  }
  return null;
}

/** 将 Excel 中的「物料种类」解析为预设种类 id（兼容旧枚举中文/英文） */
export function matchPresetKindId(
  raw: unknown,
  kinds: { id: string; name: string }[],
): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const exact = kinds.find((k) => k.name === s);
  if (exact) return exact.id;
  const lower = s.toLowerCase();
  const ci = kinds.find((k) => k.name.toLowerCase() === lower);
  if (ci) return ci.id;
  const legacy = parseMaterialKind(raw);
  if (legacy) {
    const presetId =
      DEFAULT_MATERIAL_KIND_IDS[legacy as keyof typeof DEFAULT_MATERIAL_KIND_IDS];
    if (kinds.some((k) => k.id === presetId)) return presetId;
  }
  return null;
}

export function normalizeHeaderKey(key: string): string {
  return String(key).replace(/\s/g, "").trim();
}

/** 将 sheet 首行映射为列索引 */
export function mapHeaderRow(row: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  row.forEach((cell, i) => {
    const k = normalizeHeaderKey(String(cell ?? ""));
    if (k) map.set(k, i);
  });
  return map;
}

export function parseUnitPrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  const s = String(raw).trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  if (Number.isNaN(n) || n < 0) return null;
  return n;
}
