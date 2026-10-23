import { z } from "zod";
import type { PurchaseOrderNumberRule } from "@/lib/purchase-print-template";
import { DEFAULT_PURCHASE_ORDER_NUMBER_RULE } from "@/lib/purchase-print-template";

/** 外发物料单表格列绑定的数据字段（与表头文案解耦，删列/改名后内容仍对齐） */
export const OUTSOURCE_SLIP_COLUMN_KEYS = [
  "materialCode",
  "materialName",
  "partDescription",
  "brand",
  "unit",
  "quantity",
  "remark",
] as const;

export type OutsourceSlipColumnKey = (typeof OUTSOURCE_SLIP_COLUMN_KEYS)[number];

export const OUTSOURCE_SLIP_COLUMN_KEY_SET = new Set<string>(OUTSOURCE_SLIP_COLUMN_KEYS);

export const OUTSOURCE_SLIP_DEFAULT_COLUMN_LABELS: Record<
  OutsourceSlipColumnKey,
  string
> = {
  materialCode: "种类",
  materialName: "物料名称",
  partDescription: "部件描述",
  brand: "品牌",
  unit: "单位",
  quantity: "数量",
  remark: "备注",
};

const OUTSOURCE_SLIP_HEADER_TO_KEY: Record<string, OutsourceSlipColumnKey> = {
  种类: "materialCode",
  物料编号: "materialCode",
  物料代码: "materialCode",
  物料名称: "materialName",
  部件描述: "partDescription",
  品牌: "brand",
  单位: "unit",
  数量: "quantity",
  备注: "remark",
};

export type OutsourceMaterialSlipTemplateConfig = {
  /** 外发单号：{prefix}-{供应商简称或编号}-{YYYYMMDD}-{流水}，流水按 UTC 自然年、按供应商重置 */
  orderNumberRule: PurchaseOrderNumberRule;
  companyNameCn: string;
  companyNameEn: string;
  documentTitle: string;
  toLabel: string;
  dateLabel: string;
  orderNoLabel: string;
  /** 表头上方：加工商品名称 */
  productNameLabel: string;
  /** 表头上方：外发加工套数（非物料行数量） */
  productQtySetsLabel: string;
  /** 模版预览占位：品名 */
  previewProductName: string;
  /** 模版预览占位：加工套数说明 */
  previewProductQtySets: string;
  tableColumnHeaders: string[];
  /** 与 tableColumnHeaders 等长；每列对应行数据字段 */
  tableColumnKeys: OutsourceSlipColumnKey[];
  specialNoticeTitle: string;
  specialNoticeItems: string[];
  quadruplicateNote: string;
  issuerLabel: string;
  receiverSignLabel: string;
  /** 模板预览用占位（正式打印取所选供应商） */
  previewRecipientName: string;
  previewIssuerName: string;
  footerNote: string;
  customCss: string;
  paperMaxWidthPx: number;
};

export function isOutsourceSlipColumnKey(v: unknown): v is OutsourceSlipColumnKey {
  return typeof v === "string" && OUTSOURCE_SLIP_COLUMN_KEY_SET.has(v);
}

/**
 * 保证表头与字段键一一对应。优先用已存 keys；缺省时按表头文案推断（兼容旧模版删列后错位）。
 */
export function normalizeOutsourceSlipColumns(
  headersIn: unknown,
  keysIn: unknown,
): { headers: string[]; keys: OutsourceSlipColumnKey[] } {
  const defaultHeaders = OUTSOURCE_SLIP_COLUMN_KEYS.map(
    (k) => OUTSOURCE_SLIP_DEFAULT_COLUMN_LABELS[k],
  );
  const headers = Array.isArray(headersIn)
    ? headersIn
        .map((h) => String(h ?? "").trim())
        .filter((h) => h.length > 0)
        .slice(0, OUTSOURCE_SLIP_COLUMN_KEYS.length)
    : [...defaultHeaders];
  const safeHeaders = headers.length > 0 ? headers : [...defaultHeaders];

  // 仅当已存 keys 与表头等长时才按位采用；否则按表头文案推断（兼容旧模版只删了表头）
  const rawKeysCandidate = Array.isArray(keysIn)
    ? keysIn.filter(isOutsourceSlipColumnKey)
    : [];
  const rawKeys =
    rawKeysCandidate.length === safeHeaders.length ? rawKeysCandidate : [];

  const used = new Set<OutsourceSlipColumnKey>();
  const keys: OutsourceSlipColumnKey[] = [];

  for (let i = 0; i < safeHeaders.length; i++) {
    let key: OutsourceSlipColumnKey | undefined = rawKeys[i];
    if (key && used.has(key)) key = undefined;
    if (!key) {
      const byLabel = OUTSOURCE_SLIP_HEADER_TO_KEY[safeHeaders[i]];
      if (byLabel && !used.has(byLabel)) key = byLabel;
    }
    if (!key) {
      key = OUTSOURCE_SLIP_COLUMN_KEYS.find((k) => !used.has(k));
    }
    if (!key) break;
    used.add(key);
    keys.push(key);
  }

  if (keys.length === 0) {
    return { headers: [...defaultHeaders], keys: [...OUTSOURCE_SLIP_COLUMN_KEYS] };
  }

  return {
    headers: safeHeaders.slice(0, keys.length),
    keys,
  };
}

const orderNumberRuleSchema = z.object({
  prefix: z.string().min(1).max(24),
  useShortName: z.boolean(),
  dateFormat: z.literal("YYYYMMDD"),
  sequenceDigits: z.number().int().min(2).max(8),
  startSequence: z.number().int().min(1).max(99999),
});

const outsourceSlipColumnKeySchema = z.enum(OUTSOURCE_SLIP_COLUMN_KEYS);

export const outsourceMaterialSlipTemplateConfigSchema = z
  .object({
    orderNumberRule: orderNumberRuleSchema,
    companyNameCn: z.string().min(1),
    companyNameEn: z.string(),
    documentTitle: z.string().min(1),
    toLabel: z.string().min(1),
    dateLabel: z.string().min(1),
    orderNoLabel: z.string().min(1),
    productNameLabel: z.string().min(1),
    productQtySetsLabel: z.string().min(1),
    previewProductName: z.string(),
    previewProductQtySets: z.string(),
    tableColumnHeaders: z.array(z.string().min(1)).min(1).max(OUTSOURCE_SLIP_COLUMN_KEYS.length),
    tableColumnKeys: z
      .array(outsourceSlipColumnKeySchema)
      .min(1)
      .max(OUTSOURCE_SLIP_COLUMN_KEYS.length),
    specialNoticeTitle: z.string().min(1),
    specialNoticeItems: z.array(z.string()).min(1).max(12),
    quadruplicateNote: z.string(),
    issuerLabel: z.string().min(1),
    receiverSignLabel: z.string().min(1),
    previewRecipientName: z.string(),
    previewIssuerName: z.string(),
    footerNote: z.string(),
    customCss: z.string(),
    paperMaxWidthPx: z.number().int().min(400).max(1400),
  })
  .superRefine((v, ctx) => {
    if (v.tableColumnHeaders.length !== v.tableColumnKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "表头与列字段数量须一致",
        path: ["tableColumnKeys"],
      });
    }
    if (new Set(v.tableColumnKeys).size !== v.tableColumnKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "列字段不可重复",
        path: ["tableColumnKeys"],
      });
    }
  });

export const DEFAULT_OUTSOURCE_ORDER_NUMBER_RULE: PurchaseOrderNumberRule = {
  ...DEFAULT_PURCHASE_ORDER_NUMBER_RULE,
  prefix: "WF",
  dateFormat: "YYYYMMDD",
  sequenceDigits: 3,
  startSequence: 1,
};

export const DEFAULT_OUTSOURCE_MATERIAL_SLIP_TEMPLATE: OutsourceMaterialSlipTemplateConfig =
  {
    orderNumberRule: { ...DEFAULT_OUTSOURCE_ORDER_NUMBER_RULE },
    companyNameCn: "深圳市健坤科技有限公司",
    /** 单据不再打印英文公司名；字段保留兼容已保存模版配置 */
    companyNameEn: "",
    documentTitle: "外发加工单",
    toLabel: "收件方",
    dateLabel: "日期",
    orderNoLabel: "NO",
    productNameLabel: "品名",
    productQtySetsLabel: "数量（套）",
    previewProductName: "对应商品名称",
    previewProductQtySets: "对应外发输入加工的数量",
    tableColumnHeaders: OUTSOURCE_SLIP_COLUMN_KEYS.map(
      (k) => OUTSOURCE_SLIP_DEFAULT_COLUMN_LABELS[k],
    ),
    tableColumnKeys: [...OUTSOURCE_SLIP_COLUMN_KEYS],
    specialNoticeTitle: "特别提示",
    specialNoticeItems: [
      "收到货后请于送货单上签名盖章，谢谢！",
      "请收到货后尽快验收、如发现货物数量、质量与订单不相符请在五个工作日内通知本公司，否则视为认同接收",
      "此单一式四联，第一联存根（白）第二联客户（红）第三联客户（蓝）第四联仓库（黄）",
    ],
    quadruplicateNote: "",
    issuerLabel: "出料",
    receiverSignLabel: "签收",
    previewRecipientName: "对应供应商名称",
    previewIssuerName: "对应操作员名",
    footerNote:
      "说明：红色字样为系统占位示意；正式单据取所选供应商、当前操作员及系统生成的单号；品名与数量（套）取本单商品与外发加工套数。单号流水按 UTC 自然年、按加工方供应商自起始号递增。",
    customCss: "",
    /** 与 A5 横向可印宽度（约 210mm @96dpi）对齐，减轻屏上排版与打印/PDF 偏差 */
    paperMaxWidthPx: 760,
  };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  patch: Record<string, unknown>,
): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, pv] of Object.entries(patch)) {
    if (pv === undefined) continue;
    const bv = out[k];
    if (isPlainObject(bv) && isPlainObject(pv)) {
      out[k] = deepMerge(bv as Record<string, unknown>, pv);
    } else {
      out[k] = pv;
    }
  }
  return out as T;
}

export function mergeOutsourcePrintConfig(
  raw: unknown,
): OutsourceMaterialSlipTemplateConfig {
  const patch =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const base = structuredClone(
    DEFAULT_OUTSOURCE_MATERIAL_SLIP_TEMPLATE,
  ) as unknown as Record<string, unknown>;
  const merged = deepMerge(base, patch);
  const cols = normalizeOutsourceSlipColumns(
    merged.tableColumnHeaders,
    merged.tableColumnKeys,
  );
  merged.tableColumnHeaders = cols.headers;
  merged.tableColumnKeys = cols.keys;
  const parsed = outsourceMaterialSlipTemplateConfigSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  return DEFAULT_OUTSOURCE_MATERIAL_SLIP_TEMPLATE;
}

export function parseOutsourcePrintConfigForSave(
  raw: unknown,
):
  | { ok: true; config: OutsourceMaterialSlipTemplateConfig }
  | { ok: false; error: string } {
  const merged = mergeOutsourcePrintConfig(raw);
  const parsed = outsourceMaterialSlipTemplateConfigSchema.safeParse(merged);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("；"),
    };
  }
  return { ok: true, config: parsed.data };
}
