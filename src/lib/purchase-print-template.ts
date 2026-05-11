import { z } from "zod";

export type PartyATemplate = {
  name: string;
  taxNo: string;
  address: string;
  bankName: string;
  bankAccount: string;
  /** 甲方抬头电话（合同首页） */
  headerPhone: string;
  /** 甲方抬头联系人 */
  headerContact: string;
};

export type TermClause = {
  label: string;
  body: string;
};

/**
 * 采购单号编码规则：`{前缀}-{供应商简称或编号}-{年度流水}`。
 * 流水按 UTC 自然年、按供应商独立递增，每年从 `startSequence` 起（默认 001）。
 * `dateFormat` 仅兼容旧版存库数据，不再参与单号拼接。
 */
export type PurchaseOrderNumberRule = {
  /** 首段，如 GK */
  prefix: string;
  /** true：优先用供应商简称，无简称则用编号；false：固定用供应商编号 */
  useShortName: boolean;
  /** 兼容旧配置，当前不参与单号生成 */
  dateFormat: "YYYYMMDD";
  /** 流水位数（如 3 → 001） */
  sequenceDigits: number;
  /** 每个自然年首张单的起始流水（一般为 1） */
  startSequence: number;
};

export type PurchasePrintTemplateConfig = {
  /** 可视化编辑器状态（与上方字段独立存储） */
  visualEditor?: unknown;
  /** 新建采购单时单号生成规则 */
  orderNumberRule: PurchaseOrderNumberRule;
  documentTitle: string;
  logoMode: "text" | "image";
  logoUrl: string;
  logoText: string;
  logoTextColor: string;
  logoHeightPx: number;
  partyALabel: string;
  partyBLabel: string;
  partyA: PartyATemplate;
  contractNoLabel: string;
  signDateLabel: string;
  contractNoPreviewPrefix: string;
  sectionOneHeading: string;
  tableColumnHeaders: string[];
  terms: TermClause[];
  footerNote: string;
  customCss: string;
  paperMaxWidthPx: number;
};

const termSchema = z.object({
  label: z.string(),
  body: z.string(),
});

const partyASchema = z.object({
  name: z.string(),
  taxNo: z.string(),
  address: z.string(),
  bankName: z.string(),
  bankAccount: z.string(),
  headerPhone: z.string(),
  headerContact: z.string(),
});

const orderNumberRuleSchema = z.object({
  prefix: z.string().min(1).max(24),
  useShortName: z.boolean(),
  dateFormat: z.literal("YYYYMMDD"),
  sequenceDigits: z.number().int().min(2).max(8),
  startSequence: z.number().int().min(1).max(99999),
});

export const purchasePrintTemplateConfigSchema = z.object({
  visualEditor: z.unknown().optional(),
  orderNumberRule: orderNumberRuleSchema,
  documentTitle: z.string().min(1),
  logoMode: z.enum(["text", "image"]),
  logoUrl: z.string(),
  logoText: z.string(),
  logoTextColor: z.string(),
  logoHeightPx: z.number().int().min(16).max(160),
  partyALabel: z.string().min(1),
  partyBLabel: z.string().min(1),
  partyA: partyASchema,
  contractNoLabel: z.string().min(1),
  signDateLabel: z.string().min(1),
  contractNoPreviewPrefix: z.string().min(1),
  sectionOneHeading: z.string().min(1),
  tableColumnHeaders: z.array(z.string()).min(4).max(12),
  terms: z.array(termSchema).min(1).max(20),
  footerNote: z.string(),
  customCss: z.string(),
  paperMaxWidthPx: z.number().int().min(400).max(1400),
});

export const DEFAULT_PURCHASE_ORDER_NUMBER_RULE: PurchaseOrderNumberRule = {
  prefix: "GK",
  useShortName: true,
  dateFormat: "YYYYMMDD",
  sequenceDigits: 3,
  startSequence: 1,
};

export const DEFAULT_PURCHASE_PRINT_TEMPLATE: PurchasePrintTemplateConfig = {
  orderNumberRule: { ...DEFAULT_PURCHASE_ORDER_NUMBER_RULE },
  documentTitle: "采购合同",
  logoMode: "text",
  logoUrl: "",
  logoText: "GEKUN®",
  logoTextColor: "#1677ff",
  logoHeightPx: 40,
  partyALabel: "甲方（需方）",
  partyBLabel: "乙方（供方）",
  partyA: {
    name: "深圳市键坤科技发展有限公司",
    taxNo: "91440300MA5EPKRT9L",
    address: "深圳市宝安区松岗街道江边社区工业五路8号A栋301B",
    bankName: "中国农业银行深圳华侨城支行",
    bankAccount: "41002900040036591",
    headerPhone: "",
    headerContact: "",
  },
  contractNoLabel: "合同编号",
  signDateLabel: "签约日期",
  contractNoPreviewPrefix: "预览",
  sectionOneHeading:
    "一、甲方定制产品名称、型号、数量、规格、金额及交货期描述如下：",
  tableColumnHeaders: [
    "序号",
    "型号",
    "规格",
    "单位",
    "数量",
    "单价",
    "金额",
    "备注",
  ],
  terms: [
    {
      label: "二、包装与标识：",
      body: "纸箱（可在模板中修改）。乙方应按约定及行业标准包装、标识，因包装不当造成的损失由乙方承担。",
    },
    {
      label: "三、质量与技术要求：",
      body: "按样品（可在模板中修改）。物料应符合约定规格及国家/行业相关标准；不合格品乙方应负责退换并承担相应费用。",
    },
    {
      label: "四、交货与验收：",
      body: "乙方应按约定时间、地点交货；交货时间见上文约定。甲方验收后视为交付完成，有异议应在合理期限内书面提出。",
    },
    {
      label: "五、价款与结算：",
      body: "价款以本合同及订单约定为准；双方可约定月结等结算方式，以实际对帐确认为准。",
    },
    {
      label: "六、违约责任：",
      body: "任何一方违约，应承担守约方因此遭受的直接损失（法律规定范围内的责任）。",
    },
    {
      label: "七、不可抗力：",
      body: "因不可抗力导致不能履行的，根据影响程度部分或全部免责，但应及时通知对方。",
    },
    {
      label: "八、争议解决：",
      body: "协商不成的，提交甲方所在地有管辖权的人民法院诉讼解决。",
    },
    {
      label: "九、合同生效：",
      body: "本合同自双方盖章或授权代表签字之日起生效；扫描件与原件具有同等效力（如双方另有约定除外）。",
    },
    {
      label: "十、其他：",
      body: "本合同一式两份，双方各执一份；未尽事宜由双方协商并签订补充协议，补充协议与本合同具有同等法律效力。",
    },
  ],
  footerNote:
    "说明：正式合同编号以系统生成采购单为准；红色文字表示供应商档案中未填写，请在「供应商信息」中维护。",
  customCss: "",
  paperMaxWidthPx: 900,
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
    if (k === "visualEditor") {
      out[k] = pv;
      continue;
    }
    const bv = out[k];
    if (isPlainObject(bv) && isPlainObject(pv)) {
      out[k] = deepMerge(bv as Record<string, unknown>, pv);
    } else {
      out[k] = pv;
    }
  }
  return out as T;
}

export function mergePurchasePrintConfig(
  raw: unknown,
): PurchasePrintTemplateConfig {
  const patch =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const base = structuredClone(
    DEFAULT_PURCHASE_PRINT_TEMPLATE,
  ) as unknown as Record<string, unknown>;
  const merged = deepMerge(base, patch);
  const parsed = purchasePrintTemplateConfigSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  return DEFAULT_PURCHASE_PRINT_TEMPLATE;
}

export function parsePurchasePrintConfigForSave(
  raw: unknown,
):
  | { ok: true; config: PurchasePrintTemplateConfig }
  | { ok: false; error: string } {
  const merged = mergePurchasePrintConfig(raw);
  const parsed = purchasePrintTemplateConfigSchema.safeParse(merged);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("；"),
    };
  }
  return { ok: true, config: parsed.data };
}
