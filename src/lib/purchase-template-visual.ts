/**
 * 可视化采购合同模板（与 JSON 模板并存于 PurchasePrintTemplate.config.visualEditor）
 */
export const VISUAL_BLOCK_IDS = [
  "logoTitle",
  "meta",
  "parties",
  "intro",
  "products",
  "terms",
  "footer",
] as const;

export type VisualBlockId = (typeof VISUAL_BLOCK_IDS)[number];

export type VisualColumn = { id: string; label: string };

export type PartyASealConfig = {
  /** 印章 PNG 等图片 URL（与 LOGO 相同，可走上传接口） */
  imageUrl: string;
  /** 显示宽度（像素），高度随比例 */
  widthPx: number;
  /** 相对甲方开票信息正文区左上角偏移（像素），印章绝对定位叠在文字上 */
  offsetXPx: number;
  offsetYPx: number;
};

export type VisualEditorState = {
  version: 1;
  blockOrder: string[];
  texts: Record<string, string>;
  columns: VisualColumn[];
  logo: {
    mode: "text" | "image";
    text: string;
    imageUrl: string;
  };
  /** 甲方开票信息区电子章（盖在「名称」行右侧，打印/预览一致） */
  partyASeal: PartyASealConfig;
};

export const VISUAL_BLOCK_LABELS: Record<VisualBlockId, string> = {
  logoTitle: "LOGO 与标题区",
  meta: "合同编号 / 签约日期",
  parties: "甲乙双方抬头",
  intro: "说明与交货期",
  products: "产品表格",
  terms: "条款区",
  footer: "开票信息 / 签章区",
};

const DEFAULT_TEXTS: Record<string, string> = {
  documentTitle: "采购合同",
  contractNoLabel: "合同编号",
  contractNoValue: "自动生成",
  signDateLabel: "签约日期",
  signDateValue: "自动生成",
  partyALabel: "甲方（需方）",
  partyARow: "深圳市键坤科技发展有限公司",
  partyAContactLine: "电话：0755-XXXXXXXX　联系人：贺小姐",
  partyBLabel: "乙方（供方）",
  partyBNamePlaceholder: "对应供应商名称",
  partyBPhonePlaceholder: "供应商联系电话",
  partyBContactPlaceholder: "供应商联系人",
  introLine:
    "依据双方约定，就甲方向乙方采购下列物料（关联销售订单：{{CUSTOMER_LINE}}）达成如下条款。交货时间：{{DELIVERY_DATE}}。",
  sectionOneTitle:
    "一、甲方定制产品名称、型号、数量、规格、金额及交货期描述如下：",
  term2: "二、包装：纸箱。",
  term3: "三、质量：按样品。",
  term4: "四、交货与验收：按约定时间交货。",
  term5: "五、价款与结算：月结。",
  term6: "六、违约责任：按法律规定。",
  term7: "七、不可抗力：按法律规定。",
  term8: "八、争议解决：提交甲方所在地法院。",
  term9: "九、合同生效：双方签字盖章生效。",
  term10: "十、其他：本合同一式两份。",
  footerPartyATitle: "甲方（开票信息）",
  footerPartyBTitle: "乙方（开票信息）",
  footerPartyABody:
    "名称：深圳市键坤科技发展有限公司\n纳税人识别号：91440300MA5EPKRT9L\n地址：深圳市宝安区松岗街道江边社区工业五路8号A栋301B\n开户行及帐号：中国农业银行深圳华侨城支行 41002900040036591",
  footerPartyBBody:
    "名称：供应商「税务登记号」\n纳税人识别号：供应商「税务登记号」\n地址、电话：供应商「单位地址」及「电话」\n开户行及帐号：供应商「开户银行」及「账号」",
};

const DEFAULT_COLUMNS: VisualColumn[] = [
  { id: "c1", label: "序号" },
  { id: "c2", label: "型号" },
  { id: "c3", label: "规格" },
  { id: "c4", label: "单位" },
  { id: "c5", label: "数量" },
  { id: "c6", label: "单价" },
  { id: "c7", label: "金额" },
  { id: "c8", label: "备注" },
];

export const DEFAULT_VISUAL_EDITOR_STATE: VisualEditorState = {
  version: 1,
  blockOrder: [...VISUAL_BLOCK_IDS],
  texts: { ...DEFAULT_TEXTS },
  columns: DEFAULT_COLUMNS.map((c) => ({ ...c })),
  logo: {
    mode: "text",
    text: "GEKUN®",
    imageUrl: "",
  },
  partyASeal: {
    imageUrl: "",
    widthPx: 120,
    offsetXPx: 200,
    offsetYPx: 2,
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function mergeVisualEditorState(raw: unknown): VisualEditorState {
  const base = structuredClone(DEFAULT_VISUAL_EDITOR_STATE);
  if (!isPlainObject(raw)) return base;
  const p = raw as Record<string, unknown>;
  if (Array.isArray(p.blockOrder) && p.blockOrder.every((x) => typeof x === "string")) {
    const valid = new Set(VISUAL_BLOCK_IDS as unknown as string[]);
    const ordered = (p.blockOrder as string[]).filter((id) => valid.has(id));
    const rest = VISUAL_BLOCK_IDS.filter((id) => !ordered.includes(id));
    base.blockOrder = [...ordered, ...rest];
  }
  if (isPlainObject(p.texts)) {
    base.texts = { ...base.texts, ...(p.texts as Record<string, string>) };
  }
  if (Array.isArray(p.columns)) {
    const cols = (p.columns as unknown[]).filter(
      (c): c is VisualColumn =>
        isPlainObject(c) &&
        typeof (c as VisualColumn).id === "string" &&
        typeof (c as VisualColumn).label === "string",
    );
    if (cols.length >= 4) base.columns = cols;
  }
  if (isPlainObject(p.logo)) {
    const lg = p.logo as Record<string, unknown>;
    if (lg.mode === "text" || lg.mode === "image") base.logo.mode = lg.mode;
    if (typeof lg.text === "string") base.logo.text = lg.text;
    if (typeof lg.imageUrl === "string") base.logo.imageUrl = lg.imageUrl;
  }
  if (isPlainObject(p.partyASeal)) {
    const seal = p.partyASeal as Record<string, unknown>;
    if (typeof seal.imageUrl === "string") base.partyASeal.imageUrl = seal.imageUrl;
    if (typeof seal.widthPx === "number" && Number.isFinite(seal.widthPx)) {
      base.partyASeal.widthPx = Math.round(
        Math.min(280, Math.max(40, seal.widthPx)),
      );
    }
    if (typeof seal.offsetXPx === "number" && Number.isFinite(seal.offsetXPx)) {
      base.partyASeal.offsetXPx = Math.round(
        Math.min(900, Math.max(-400, seal.offsetXPx)),
      );
    }
    if (typeof seal.offsetYPx === "number" && Number.isFinite(seal.offsetYPx)) {
      base.partyASeal.offsetYPx = Math.round(
        Math.min(500, Math.max(-250, seal.offsetYPx)),
      );
    }
  }
  return base;
}

/** 将说明段落中的占位符替换为预览数据（兼容未使用占位符的旧模板文案） */
export function interpolateIntroLine(
  template: string,
  opts: { customerLine: string; deliveryDisplay: string },
): string {
  const delivery = opts.deliveryDisplay.trim() || "（未填写）";
  let s = template;
  if (/\{\{CUSTOMER_LINE\}\}/.test(s)) {
    s = s.replace(/\{\{CUSTOMER_LINE\}\}/g, opts.customerLine);
  } else {
    s = s.replace(/示例客户\s*·\s*SO-001/g, opts.customerLine).replace(/示例客户/g, opts.customerLine);
  }
  if (/\{\{DELIVERY_DATE\}\}/.test(s)) {
    s = s.replace(/\{\{DELIVERY_DATE\}\}/g, delivery);
  } else {
    s = s.replace(/对应要求交货时间\.?/g, delivery);
  }
  return s;
}
