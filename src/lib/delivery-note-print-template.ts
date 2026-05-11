import { z } from "zod";

export type DeliveryNotePreviewLine = {
  orderNo: string;
  materialCode: string;
  nameSpec: string;
  unit: string;
  quantity: string;
  remark: string;
};

export type DeliveryNoteTemplateConfig = {
  companyNameCn: string;
  companyNameEn: string;
  documentTitle: string;
  customerNameLabel: string;
  dateLabel: string;
  documentNoLabel: string;
  previewCustomerName: string;
  /** 日期旁示意，如「自动生成」 */
  previewDateNote: string;
  previewDocumentNo: string;
  tableColumnHeaders: string[];
  previewLine: DeliveryNotePreviewLine;
  /** 除示例外空白行数 */
  tableBodyEmptyRows: number;
  specialNoticeTitle: string;
  specialNoticeItems: string[];
  issuerLabel: string;
  receiverSignLabel: string;
  previewIssuerName: string;
  paperMaxWidthPx: number;
  customCss: string;
  footerNote: string;
};

const previewLineSchema = z.object({
  orderNo: z.string(),
  materialCode: z.string(),
  nameSpec: z.string(),
  unit: z.string(),
  quantity: z.string(),
  remark: z.string(),
});

export const deliveryNoteTemplateConfigSchema = z.object({
  companyNameCn: z.string().min(1),
  companyNameEn: z.string(),
  documentTitle: z.string().min(1),
  customerNameLabel: z.string().min(1),
  dateLabel: z.string().min(1),
  documentNoLabel: z.string().min(1),
  previewCustomerName: z.string(),
  previewDateNote: z.string(),
  previewDocumentNo: z.string(),
  tableColumnHeaders: z.array(z.string().min(1)).length(6),
  previewLine: previewLineSchema,
  tableBodyEmptyRows: z.number().int().min(0).max(40),
  specialNoticeTitle: z.string().min(1),
  specialNoticeItems: z.array(z.string()).min(1).max(12),
  issuerLabel: z.string().min(1),
  receiverSignLabel: z.string().min(1),
  previewIssuerName: z.string(),
  /** 模版编辑预览宽度；约 A5 横向可印宽度（210mm≈794px@96dpi） */
  paperMaxWidthPx: z.number().int().min(400).max(1200),
  customCss: z.string(),
  footerNote: z.string(),
});

export const DEFAULT_DELIVERY_NOTE_TEMPLATE: DeliveryNoteTemplateConfig = {
  companyNameCn: "深圳市键坤科技发展有限公司",
  companyNameEn: "Shenzhen Gekun Technology Development Co., Ltd",
  documentTitle: "送 货 单",
  customerNameLabel: "客户名称",
  dateLabel: "日期",
  documentNoLabel: "NO",
  previewCustomerName: "对应客户名称（中文）",
  previewDateNote: "自动生成",
  previewDocumentNo: "APS20260424001",
  tableColumnHeaders: [
    "订单号",
    "物料编码",
    "品名规格",
    "单位",
    "数量",
    "备注",
  ],
  previewLine: {
    orderNo: "对应「销售订单号」",
    materialCode: "对应「商品物料编码」",
    nameSpec: "对应「商品名称」",
    unit: "PCS",
    quantity: "",
    remark: "对应商品「备注」",
  },
  tableBodyEmptyRows: 8,
  specialNoticeTitle: "特别提示：",
  specialNoticeItems: [
    "收到货后请于送货单上签名盖章，谢谢！",
    "请收到货后尽快验收、如发现货物数量、质量与订单不相符请在五个工作日内通知本公司，否则视为认同接收",
    "此单一式四联，第一联存根（白）第二联客户（红）第三联客户（蓝）第四联仓库（黄）",
  ],
  issuerLabel: "出货审核",
  receiverSignLabel: "客户签收",
  previewIssuerName: "对应操作员名",
  paperMaxWidthPx: 794,
  customCss: "",
  footerNote:
    "说明：红色字样为模版占位示意；正式送货单取销售订单、客户档案及操作员等实际数据。",
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

export function mergeDeliveryNotePrintConfig(
  raw: unknown,
): DeliveryNoteTemplateConfig {
  const patch =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const base = structuredClone(
    DEFAULT_DELIVERY_NOTE_TEMPLATE,
  ) as unknown as Record<string, unknown>;
  const merged = deepMerge(base, patch);
  const parsed = deliveryNoteTemplateConfigSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  return DEFAULT_DELIVERY_NOTE_TEMPLATE;
}

export function parseDeliveryNotePrintConfigForSave(
  raw: unknown,
):
  | { ok: true; config: DeliveryNoteTemplateConfig }
  | { ok: false; error: string } {
  const merged = mergeDeliveryNotePrintConfig(raw);
  const parsed = deliveryNoteTemplateConfigSchema.safeParse(merged);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("；"),
    };
  }
  return { ok: true, config: parsed.data };
}
