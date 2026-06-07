"use client";

import { PlusOutlined, QuestionCircleOutlined, SettingOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popover,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ResizeCallbackData } from "react-resizable";
import type { Dispatch, ReactNode, SetStateAction, SyntheticEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ResizableTableTitle } from "@/components/ResizableTableTitle";
import { fetchJson } from "@/lib/fetch-json";
import { moneyColumnLabels } from "@/lib/price-tax";
import { useMeTabPermissions } from "@/lib/use-me-tab-permissions";
import { PurchaseFromSalesWizard } from "./PurchaseFromSalesWizard";

const PURCHASE_TAB_PERM: Record<string, string> = {
  add: "tab.pur.add",
  pcb: "tab.pur.pcb",
  pending: "tab.pur.open",
  query: "tab.pur.query",
  settings: "tab.pur.settings",
};
import { PurchaseOrderContractPreviewModal } from "./PurchaseOrderContractPreviewModal";
import { PurchaseTemplateVisualEditor } from "./PurchaseTemplateVisualEditor";

type SupplierOpt = {
  id: string;
  code: string;
  name: string;
  shortName?: string | null;
  priceIncludesTax: boolean;
};
type MaterialOpt = {
  id: string;
  code: string;
  name: string;
  unit: string;
  unitPrice: string;
  purchaseChannel: "STANDARD_PURCHASE" | "PROCESSING_CONTRACT";
  supplier: { id: string; code: string; name: string };
};

type PurchasePresetBundle = {
  suppliers: SupplierOpt[];
  materials: MaterialOpt[];
};

type PendingChangeReminder = {
  id: string;
  productModel: string;
  customerMaterialCode: string;
  changeSummary: string;
  proposedAt: string;
  status: "ACTIVE" | "DONE" | "VOIDED";
  salesConfirmCount: number;
  purchaseConfirmCount: number;
  purchaseLastConfirmedAt: string | null;
  purchaseLastConfirmedByName: string | null;
};

async function confirmPurchaseChannelReminders(
  modal: { confirm: (config: Parameters<typeof Modal.confirm>[0]) => void },
  reminders: PendingChangeReminder[],
) {
  if (reminders.length === 0) return true;
  return new Promise<boolean>((resolve) => {
    modal.confirm({
      title: `检测到 ${reminders.length} 条客户变更提醒`,
      width: 760,
      okText: "已确认本次变更，继续保存",
      cancelText: "取消",
      content: (
        <Space
          direction="vertical"
          style={{ maxHeight: 420, overflowY: "auto", color: "#cf1322" }}
        >
          {reminders.map((r) => (
            <div
              key={r.id}
              style={{ border: "1px solid #f0f0f0", borderRadius: 6, padding: 10 }}
            >
              <Typography.Text strong style={{ color: "#cf1322" }}>
                采购提醒（{r.purchaseConfirmCount}/2）
              </Typography.Text>
              <br />
              <Typography.Text style={{ color: "#cf1322" }}>
                商品：{r.productModel?.trim() || "—"} / {r.customerMaterialCode?.trim() || "—"}
              </Typography.Text>
              <br />
              <Typography.Text style={{ color: "#cf1322" }}>
                变更：{r.changeSummary}
              </Typography.Text>
              <br />
              <Typography.Text style={{ color: "#cf1322" }}>
                提出：{new Date(r.proposedAt).toLocaleDateString("zh-CN")}
                {r.purchaseLastConfirmedAt
                  ? `；上次确认：${r.purchaseLastConfirmedByName ?? "—"} ${new Date(r.purchaseLastConfirmedAt).toLocaleString("zh-CN")}`
                  : ""}
              </Typography.Text>
            </div>
          ))}
        </Space>
      ),
      onOk: async () => {
        await fetchJson("/api/customer-change-reminders/ack", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: reminders.map((x) => x.id),
            channel: "purchase",
          }),
        });
        resolve(true);
      },
      onCancel: () => resolve(false),
    });
  });
}

type PurchaseOrderRow = {
  id: string;
  orderNo: string;
  remark: string | null;
  status?: string;
  canEdit?: boolean;
  canDelete?: boolean;
  canClose?: boolean;
  purchaseChannel?: "STANDARD_PURCHASE" | "PROCESSING_CONTRACT";
  supplier: SupplierOpt;
  salesOrder?: {
    id: string;
    customerOrderNo: string;
    customerModel: string;
  } | null;
  lineCount: number;
  /** 采购单要求交货日（按供应商交货天数自生成日起算） */
  deliveryDueAt: string | null;
  /** 确认收料时的实际交货日 */
  actualDeliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PoLine = {
  key: string;
  materialId: string | undefined;
  quantity: number;
  unitPrice: number;
  remark: string;
};

type PcbContractDraftRow = {
  key: string;
  contractNo: string;
  materialId?: string;
  quantity: number;
  unitPrice: number;
  deliveryDueAt: string | null;
};

type DetailLine = {
  id: string;
  quantity: string;
  unitPrice: string;
  remark: string | null;
  material: {
    id: string;
    code: string;
    name: string;
    unit: string;
    unitPrice: string;
    partDescription: string | null;
    inspectionNotes?: string | null;
    purchaseChannel?: "STANDARD_PURCHASE" | "PROCESSING_CONTRACT";
  };
};

/** 与本采购单号关联的收料入库批次（按物料汇总展示历史） */
type ReceiptBatch = {
  materialId: string;
  quantity: number;
  receivedAt: string;
};

function receiptBatchesForMaterial(
  batches: ReceiptBatch[] | undefined,
  materialId: string,
): ReceiptBatch[] {
  return (batches ?? []).filter((b) => b.materialId === materialId);
}

function totalReceivedForMaterial(
  batches: ReceiptBatch[] | undefined,
  materialId: string,
): number {
  return receiptBatchesForMaterial(batches, materialId).reduce(
    (s, b) => s + b.quantity,
    0,
  );
}

/** 本行原始订单数量 = 当前待收 + 该物料在本单已入库累计（按单号+物料匹配） */
function orderQtyForLine(
  line: DetailLine,
  batches: ReceiptBatch[] | undefined,
): number {
  const pending = Math.round(Number(line.quantity));
  return pending + totalReceivedForMaterial(batches, line.material.id);
}

type DetailPayload = {
  id: string;
  orderNo: string;
  status: string;
  purchaseChannel?: "STANDARD_PURCHASE" | "PROCESSING_CONTRACT";
  remark: string | null;
  supplier: SupplierOpt & {
    shortName?: string | null;
    contactPerson: string | null;
    phone: string | null;
    address: string | null;
    bankName: string | null;
    bankAccount: string | null;
    taxRegistrationNo: string | null;
  };
  salesOrder: {
    customerOrderNo: string;
    customerModel: string;
    deliveryDueAt: string | null;
    customer: { code: string; name: string };
  } | null;
  /** 采购单要求交货日 */
  deliveryDueAt: string | null;
  /** 实际交货日（收料确认） */
  actualDeliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: DetailLine[];
  receiptBatches?: ReceiptBatch[];
};

function newLineKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newPcbContractDraftRow(): PcbContractDraftRow {
  return {
    key:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `pcb-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    contractNo: "",
    materialId: undefined,
    quantity: 1,
    unitPrice: 0,
    deliveryDueAt: null,
  };
}

/** 当日 / 未交：仅有「要求交货时间」；收料前无实际交货日 */
const PURCHASE_ORDER_COL_OPTIONS_UNDELIVERED: { label: string; value: string }[] =
  [
    { label: "采购单号", value: "orderNo" },
    { label: "供应商", value: "supplier" },
    { label: "关联销售单", value: "salesOrder" },
    { label: "关联机型", value: "customerModel" },
    { label: "交货时间", value: "deliveryDueAt" },
    { label: "状态", value: "status" },
    { label: "行数", value: "lineCount" },
    { label: "订单预览", value: "orderPreview" },
    { label: "备注", value: "remark" },
    { label: "创建时间", value: "createdAt" },
  ];

/** 采购订单查询：含实际交货日期（收料确认后才有值） */
const PURCHASE_ORDER_COL_OPTIONS_QUERY: { label: string; value: string }[] = [
  { label: "采购单号", value: "orderNo" },
  { label: "供应商", value: "supplier" },
  { label: "关联销售单", value: "salesOrder" },
  { label: "关联机型", value: "customerModel" },
  { label: "交货时间", value: "deliveryDueAt" },
  { label: "实际交货日期", value: "actualDeliveredAt" },
  { label: "状态", value: "status" },
  { label: "行数", value: "lineCount" },
  { label: "订单预览", value: "orderPreview" },
  { label: "备注", value: "remark" },
  { label: "创建时间", value: "createdAt" },
];

const PURCHASE_ORDER_UNDELIVERED_ALL_KEYS =
  PURCHASE_ORDER_COL_OPTIONS_UNDELIVERED.map((o) => o.value);
const PURCHASE_ORDER_QUERY_ALL_KEYS = PURCHASE_ORDER_COL_OPTIONS_QUERY.map(
  (o) => o.value,
);

const LS_PURCHASE_TODAY_COLS = "purchase.orderList.today.cols.v3";
const LS_PURCHASE_QUERY_COLS = "purchase.orderList.query.cols.v2";
const LS_PURCHASE_PENDING_COLS = "purchase.orderList.pending.cols.v3";

const PO_LINE_COL_OPTIONS: { label: string; value: string }[] = [
  { label: "物料", value: "material" },
  { label: "数量", value: "quantity" },
  { label: "单价", value: "unitPrice" },
  { label: "备注", value: "lineRemark" },
];

const PO_LINE_ALL_KEYS = PO_LINE_COL_OPTIONS.map((o) => o.value);
const LS_PO_LINE_COLS = "purchase.poLine.cols.v1";

const DETAIL_LINE_COL_OPTIONS: { label: string; value: string }[] = [
  { label: "物料编号", value: "materialCode" },
  { label: "物料名称", value: "materialName" },
  { label: "部件描述", value: "partDescription" },
  { label: "单位", value: "unit" },
  { label: "数量", value: "quantity" },
  { label: "单价", value: "unitPrice" },
  { label: "金额", value: "amount" },
  { label: "行备注", value: "lineRemark" },
];

const DETAIL_LINE_ALL_KEYS = DETAIL_LINE_COL_OPTIONS.map((o) => o.value);
const LS_PURCHASE_DETAIL_LINE_COLS = "purchase.detail.lines.cols.v1";

const DEFAULT_DETAIL_LINE_COL_WIDTH: Record<string, number> = {
  materialCode: 120,
  materialName: 140,
  partDescription: 160,
  unit: 64,
  quantity: 100,
  unitPrice: 100,
  amount: 100,
  lineRemark: 140,
};

const DEFAULT_PO_LINE_COL_WIDTH: Record<string, number> = {
  material: 240,
  quantity: 120,
  unitPrice: 120,
  lineRemark: 120,
  op: 72,
};

const DEFAULT_PURCHASE_LIST_COL_WIDTH: Record<string, number> = {
  orderNo: 160,
  supplier: 180,
  salesOrder: 160,
  customerModel: 140,
  deliveryDueAt: 120,
  actualDeliveredAt: 128,
  status: 88,
  lineCount: 80,
  orderPreview: 104,
  remark: 160,
  createdAt: 168,
  op: 240,
};

function loadPurchaseVisibleColKeys(
  storageKey: string,
  allKeys: string[],
  fallback: string[],
): string[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return fallback;
    const set = new Set(
      parsed.filter((x): x is string => typeof x === "string"),
    );
    const kept = allKeys.filter((k) => set.has(k));
    return kept.length > 0 ? kept : fallback;
  } catch {
    return fallback;
  }
}

function attachResizePurchaseList<T extends object>(
  columns: ColumnsType<T>,
  widths: Record<string, number>,
  setWidths: Dispatch<SetStateAction<Record<string, number>>>,
  defaults: Record<string, number>,
): ColumnsType<T> {
  return columns.map((col) => {
    const key = col.key != null ? String(col.key) : "";
    if (!key || key === "op") {
      const w =
        key === "op"
          ? (widths.op ?? defaults.op ?? 88)
          : ((col.width as number) ?? 120);
      return { ...col, width: w };
    }
    const w = widths[key] ?? defaults[key] ?? 120;
    return {
      ...col,
      width: w,
      onHeaderCell: () => ({
        width: w,
        onResize: (_e: SyntheticEvent, data: ResizeCallbackData) => {
          setWidths((prev) => ({ ...prev, [key]: data.size.width }));
        },
      }),
    };
  });
}

function PurchaseListColumnSettingButton({
  value,
  onChange,
  options,
}: {
  value: string[];
  onChange: (keys: string[]) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <Popover
      title="显示列"
      trigger="click"
      placement="bottomRight"
      content={
        <Checkbox.Group
          value={value}
          onChange={(v) => onChange(v as string[])}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            maxHeight: 360,
            overflowY: "auto",
          }}
          options={options}
        />
      }
    >
      <Button type="text" icon={<SettingOutlined />} aria-label="列设置" />
    </Popover>
  );
}

function HelpTip({ text }: { text: ReactNode }) {
  return (
    <Tooltip title={<span style={{ whiteSpace: "normal" }}>{text}</span>} placement="topLeft">
      <QuestionCircleOutlined style={{ color: "#8c8c8c", cursor: "help" }} />
    </Tooltip>
  );
}

function PoLineEditorColumnSettingButton({
  value,
  onChange,
}: {
  value: string[];
  onChange: (keys: string[]) => void;
}) {
  return (
    <Popover
      title="显示列"
      trigger="click"
      placement="bottomRight"
      content={
        <Checkbox.Group
          value={value}
          onChange={(v) => onChange(v as string[])}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            maxHeight: 360,
            overflowY: "auto",
          }}
          options={PO_LINE_COL_OPTIONS}
        />
      }
    >
      <Button type="text" icon={<SettingOutlined />} aria-label="列设置" />
    </Popover>
  );
}

function PoLinesEditor({
  lines,
  setLines,
  materials,
  priceIncludesTax,
}: {
  lines: PoLine[];
  setLines: Dispatch<SetStateAction<PoLine[]>>;
  materials: MaterialOpt[];
  priceIncludesTax: boolean;
}) {
  const priceLabels = useMemo(
    () => moneyColumnLabels(priceIncludesTax),
    [priceIncludesTax],
  );
  const [poLineColKeys, setPoLineColKeys] = useState<string[]>(() =>
    loadPurchaseVisibleColKeys(LS_PO_LINE_COLS, PO_LINE_ALL_KEYS, PO_LINE_ALL_KEYS),
  );
  const [poLineColWidths, setPoLineColWidths] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      localStorage.setItem(LS_PO_LINE_COLS, JSON.stringify(poLineColKeys));
    } catch {
      /* ignore */
    }
  }, [poLineColKeys]);

  const updateLine = useCallback(
    (key: string, patch: Partial<PoLine>) => {
      setLines((prev) =>
        prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
      );
    },
    [setLines],
  );
  const removeLine = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }, [setLines]);
  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        key: newLineKey(),
        materialId: undefined,
        quantity: 1,
        unitPrice: 0,
        remark: "",
      },
    ]);
  };

  const poLineAllColumns: ColumnsType<PoLine> = useMemo(
    () => [
    {
      key: "material",
      title: "物料",
      width: 240,
      render: (_, row) => {
        const taken = new Set(
          lines
            .filter((l) => l.key !== row.key && l.materialId)
            .map((l) => l.materialId as string),
        );
        const opts = materials.filter(
          (m) => !taken.has(m.id) || m.id === row.materialId,
        );
        return (
          <Select
            placeholder="选择物料"
            allowClear
            showSearch
            style={{ width: "100%" }}
            optionFilterProp="label"
            value={row.materialId}
            options={opts.map((m) => ({
              value: m.id,
              label: `${m.code} ${m.name}`,
            }))}
            onChange={(mid) => {
              if (!mid) {
                updateLine(row.key, {
                  materialId: undefined,
                  unitPrice: 0,
                });
                return;
              }
              const m = materials.find((x) => x.id === mid);
              updateLine(row.key, {
                materialId: mid,
                unitPrice: m ? Number(m.unitPrice) : 0,
              });
            }}
          />
        );
      },
    },
    {
      key: "quantity",
      title: "数量",
      width: 120,
      render: (_, row) => (
        <InputNumber
          min={1}
          max={999999999}
          precision={0}
          step={1}
          style={{ width: "100%" }}
          value={row.quantity}
          onChange={(v) => {
            if (v === null || v === undefined) {
              updateLine(row.key, { quantity: 1 });
              return;
            }
            const n = Math.round(Number(v));
            updateLine(row.key, {
              quantity: Number.isFinite(n) && n >= 1 ? n : 1,
            });
          }}
        />
      ),
    },
    {
      key: "unitPrice",
      title: priceLabels.unitPrice,
      width: 120,
      render: (_, row) => (
        <InputNumber
          min={0}
          precision={4}
          style={{ width: "100%" }}
          value={row.unitPrice}
          onChange={(v) =>
            updateLine(row.key, {
              unitPrice: typeof v === "number" && !Number.isNaN(v) ? v : 0,
            })
          }
        />
      ),
    },
    {
      key: "lineRemark",
      title: "备注",
      render: (_, row) => (
        <Input
          value={row.remark}
          onChange={(e) => updateLine(row.key, { remark: e.target.value })}
          placeholder="可选"
        />
      ),
    },
    {
      title: "操作",
      key: "op",
      width: 72,
      render: (_, row) => (
        <Button
          type="link"
          danger
          size="small"
          onClick={() => removeLine(row.key)}
        >
          删除
        </Button>
      ),
    },
    ],
    [lines, materials, updateLine, removeLine, priceLabels],
  );

  const poLineColumns = useMemo(() => {
    const visible = poLineAllColumns.filter(
      (col) =>
        col.key === "op" ||
        (typeof col.key === "string" && poLineColKeys.includes(col.key)),
    );
    return attachResizePurchaseList(
      visible,
      poLineColWidths,
      setPoLineColWidths,
      DEFAULT_PO_LINE_COL_WIDTH,
    );
  }, [poLineAllColumns, poLineColKeys, poLineColWidths]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 4,
        }}
      >
        <Typography.Text strong>采购明细</Typography.Text>
        <PoLineEditorColumnSettingButton
          value={poLineColKeys}
          onChange={setPoLineColKeys}
        />
      </div>
      <Table<PoLine>
        size="small"
        style={{ marginTop: 8 }}
        rowKey="key"
        pagination={false}
        dataSource={lines}
        locale={{ emptyText: "请点击下方按钮添加一行" }}
        columns={poLineColumns}
        tableLayout="fixed"
        scroll={{ x: "max-content" }}
        components={{
          header: { cell: ResizableTableTitle },
        }}
      />
      <Button type="dashed" onClick={addLine} style={{ marginTop: 8 }}>
        添加一行
      </Button>
    </div>
  );
}

export function PurchasePage() {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { loading: tabPermLoading, allowed } = useMeTabPermissions();
  const [tab, setTab] = useState("add");

  const [presets, setPresets] = useState<PurchasePresetBundle | null>(null);
  const [loadingPresets, setLoadingPresets] = useState(true);

  const [todayRows, setTodayRows] = useState<PurchaseOrderRow[]>([]);
  const [loadingToday, setLoadingToday] = useState(false);
  const [pcbRows, setPcbRows] = useState<PurchaseOrderRow[]>([]);
  const [loadingPcb, setLoadingPcb] = useState(false);

  const [queryForm] = Form.useForm();
  const [queryRows, setQueryRows] = useState<PurchaseOrderRow[]>([]);
  const [loadingQuery, setLoadingQuery] = useState(false);

  const [todayPoListColKeys, setTodayPoListColKeys] = useState<string[]>(() =>
    loadPurchaseVisibleColKeys(
      LS_PURCHASE_TODAY_COLS,
      PURCHASE_ORDER_UNDELIVERED_ALL_KEYS,
      PURCHASE_ORDER_UNDELIVERED_ALL_KEYS,
    ),
  );
  const [todayPoListColWidths, setTodayPoListColWidths] = useState<
    Record<string, number>
  >({});

  const [queryPoListColKeys, setQueryPoListColKeys] = useState<string[]>(() =>
    loadPurchaseVisibleColKeys(
      LS_PURCHASE_QUERY_COLS,
      PURCHASE_ORDER_QUERY_ALL_KEYS,
      PURCHASE_ORDER_QUERY_ALL_KEYS,
    ),
  );
  const [queryPoListColWidths, setQueryPoListColWidths] = useState<
    Record<string, number>
  >({});

  const [pendingRows, setPendingRows] = useState<PurchaseOrderRow[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [pendingSupplierId, setPendingSupplierId] = useState<string | undefined>(undefined);
  const [pendingPoListColKeys, setPendingPoListColKeys] = useState<string[]>(
    () =>
      loadPurchaseVisibleColKeys(
        LS_PURCHASE_PENDING_COLS,
        PURCHASE_ORDER_UNDELIVERED_ALL_KEYS,
        PURCHASE_ORDER_UNDELIVERED_ALL_KEYS,
      ),
  );
  const [pendingPoListColWidths, setPendingPoListColWidths] = useState<
    Record<string, number>
  >({});

  const [wizardOpen, setWizardOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPoId, setEditingPoId] = useState<string | null>(null);
  const [createChannel, setCreateChannel] = useState<
    "STANDARD_PURCHASE" | "PROCESSING_CONTRACT"
  >("STANDARD_PURCHASE");
  const [pcbDraftRows, setPcbDraftRows] = useState<PcbContractDraftRow[]>([
    newPcbContractDraftRow(),
  ]);
  const [pcbSavingRowKey, setPcbSavingRowKey] = useState<string | null>(null);
  const [createForm] = Form.useForm();
  const createSupplierId = Form.useWatch("supplierId", createForm);
  const createSupplierPriceIncludesTax = useMemo(() => {
    if (!createSupplierId || !presets) return false;
    return (
      presets.suppliers.find((s) => s.id === createSupplierId)?.priceIncludesTax ??
      false
    );
  }, [createSupplierId, presets]);
  const [poLines, setPoLines] = useState<PoLine[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailLineColKeys, setDetailLineColKeys] = useState<string[]>(() =>
    loadPurchaseVisibleColKeys(
      LS_PURCHASE_DETAIL_LINE_COLS,
      DETAIL_LINE_ALL_KEYS,
      DETAIL_LINE_ALL_KEYS,
    ),
  );
  const [detailLineColWidths, setDetailLineColWidths] = useState<
    Record<string, number>
  >({});

  const [poContractPreviewOpen, setPoContractPreviewOpen] = useState(false);
  const [poContractPreviewId, setPoContractPreviewId] = useState<string | null>(null);
  const [poContractPreviewNo, setPoContractPreviewNo] = useState<string | null>(null);

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptSubmitting, setReceiptSubmitting] = useState(false);
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null);
  const [receiptOrderNo, setReceiptOrderNo] = useState<string | null>(null);
  const [receiptDetail, setReceiptDetail] = useState<DetailPayload | null>(null);
  const [receiptQtyByLineId, setReceiptQtyByLineId] = useState<Record<string, number>>(
    {},
  );
  const [receiptSpareQtyByLineId, setReceiptSpareQtyByLineId] = useState<
    Record<string, number>
  >({});

  const openPoContractPreview = useCallback((r: PurchaseOrderRow) => {
    setPoContractPreviewId(r.id);
    setPoContractPreviewNo(r.orderNo);
    setPoContractPreviewOpen(true);
  }, []);

  const loadPresets = useCallback(async () => {
    setLoadingPresets(true);
    try {
      const data = await fetchJson<PurchasePresetBundle>(
        "/api/purchase-presets",
        { credentials: "include" },
      );
      setPresets(data);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载选项失败");
      setPresets({ suppliers: [], materials: [] });
    } finally {
      setLoadingPresets(false);
    }
  }, [message]);

  const pcbMaterialOptions = useMemo(
    () =>
      (presets?.materials ?? []).filter(
        (m) => m.purchaseChannel === "PROCESSING_CONTRACT",
      ),
    [presets],
  );

  const updatePcbDraftRow = useCallback(
    (rowKey: string, patch: Partial<PcbContractDraftRow>) => {
      setPcbDraftRows((prev) =>
        prev.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)),
      );
    },
    [],
  );

  const addPcbDraftRow = useCallback(() => {
    setPcbDraftRows((prev) => [...prev, newPcbContractDraftRow()]);
  }, []);

  const removePcbDraftRow = useCallback((rowKey: string) => {
    setPcbDraftRows((prev) => {
      const next = prev.filter((row) => row.key !== rowKey);
      return next.length > 0 ? next : [newPcbContractDraftRow()];
    });
  }, []);

  const buildQuery = useCallback(
    (
      createdFrom: string,
      createdTo: string,
      v: Record<string, unknown>,
      mode: "default" | "pending" | "inQuery",
      purchaseChannel?: "STANDARD_PURCHASE" | "PROCESSING_CONTRACT",
    ) => {
      const p = new URLSearchParams();
      p.set("createdFrom", createdFrom);
      p.set("createdTo", createdTo);
      if (purchaseChannel) p.set("purchaseChannel", purchaseChannel);
      if (mode === "pending") p.set("pending", "1");
      if (mode === "inQuery") p.set("inQuery", "1");
      if (v.supplierId) p.set("supplierId", String(v.supplierId));
      if (v.orderNo) p.set("orderNo", String(v.orderNo).trim());
      return p.toString();
    },
    [],
  );

  const loadTodayOrders = useCallback(async () => {
    setLoadingToday(true);
    try {
      const start = dayjs().startOf("day").toISOString();
      const end = dayjs().endOf("day").toISOString();
      const data = await fetchJson<{ list: PurchaseOrderRow[] }>(
        `/api/purchase-orders?${buildQuery(
          start,
          end,
          {},
          "default",
          "STANDARD_PURCHASE",
        )}`,
        { credentials: "include" },
      );
      setTodayRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
      setTodayRows([]);
    } finally {
      setLoadingToday(false);
    }
  }, [message, buildQuery]);

  const loadPendingPurchase = useCallback(async () => {
    setLoadingPending(true);
    try {
      const start = dayjs().subtract(365, "day").startOf("day").toISOString();
      const end = dayjs().endOf("day").toISOString();
      const data = await fetchJson<{ list: PurchaseOrderRow[] }>(
        `/api/purchase-orders?${buildQuery(
          start,
          end,
          pendingSupplierId ? { supplierId: pendingSupplierId } : {},
          "pending",
          "STANDARD_PURCHASE",
        )}`,
        { credentials: "include" },
      );
      setPendingRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
      setPendingRows([]);
    } finally {
      setLoadingPending(false);
    }
  }, [message, buildQuery, pendingSupplierId]);

  const loadQueryOrders = useCallback(
    async (v: Record<string, unknown>) => {
      setLoadingQuery(true);
      try {
        const range = v.dateRange as [dayjs.Dayjs, dayjs.Dayjs] | undefined;
        if (!range?.[0] || !range?.[1]) {
          message.warning("请选择查询日期范围");
          setLoadingQuery(false);
          return;
        }
        const start = range[0].startOf("day").toISOString();
        const end = range[1].endOf("day").toISOString();
        const purchaseChannelRaw = String(v.purchaseChannel ?? "").trim();
        const purchaseChannel =
          purchaseChannelRaw === "STANDARD_PURCHASE" ||
          purchaseChannelRaw === "PROCESSING_CONTRACT"
            ? purchaseChannelRaw
            : undefined;
        const data = await fetchJson<{ list: PurchaseOrderRow[] }>(
          `/api/purchase-orders?${buildQuery(
            start,
            end,
            v,
            "inQuery",
            purchaseChannel,
          )}`,
          { credentials: "include" },
        );
        setQueryRows(data.list ?? []);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "查询失败");
        setQueryRows([]);
      } finally {
        setLoadingQuery(false);
      }
    },
    [message, buildQuery],
  );

  const loadPcbPending = useCallback(async () => {
    setLoadingPcb(true);
    try {
      const start = dayjs().subtract(365, "day").startOf("day").toISOString();
      const end = dayjs().endOf("day").toISOString();
      const data = await fetchJson<{ list: PurchaseOrderRow[] }>(
        `/api/purchase-orders?${buildQuery(
          start,
          end,
          {},
          "pending",
          "PROCESSING_CONTRACT",
        )}`,
        { credentials: "include" },
      );
      setPcbRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
      setPcbRows([]);
    } finally {
      setLoadingPcb(false);
    }
  }, [message, buildQuery]);

  const savePcbDraftRow = useCallback(
    async (row: PcbContractDraftRow) => {
      const contractNo = row.contractNo.trim();
      if (!contractNo) {
        message.warning("请填写合同号");
        return;
      }
      if (!row.materialId) {
        message.warning("请选择物料名称");
        return;
      }
      if (!Number.isFinite(row.quantity) || row.quantity <= 0) {
        message.warning("数量须大于 0");
        return;
      }
      if (!Number.isFinite(row.unitPrice) || row.unitPrice < 0) {
        message.warning("单价须为非负数");
        return;
      }
      if (!row.deliveryDueAt) {
        message.warning("请选择交货日期");
        return;
      }
      const material = pcbMaterialOptions.find((m) => m.id === row.materialId);
      if (!material) {
        message.warning("物料不存在或不是 PCB 加工合同物料");
        return;
      }
      try {
        const reminderPayload = await fetchJson<{
          list: PendingChangeReminder[];
        }>("/api/customer-change-reminders/match", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            materialIds: [material.id],
            channel: "purchase",
          }),
        });
        const proceed = await confirmPurchaseChannelReminders(
          modal,
          reminderPayload.list ?? [],
        );
        if (!proceed) return;
      } catch (e) {
        message.error(
          e instanceof Error ? e.message : "加载客户变更提醒失败",
        );
        return;
      }

      setPcbSavingRowKey(row.key);
      try {
        await fetchJson("/api/purchase-orders", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierId: material.supplier.id,
            remark: `合同号:${contractNo}`,
            deliveryDueAt: row.deliveryDueAt,
            lines: [
              {
                materialId: material.id,
                quantity: Math.trunc(row.quantity),
                unitPrice: row.unitPrice,
              },
            ],
          }),
        });
        message.success("PCB 加工合同已保存");
        await loadPcbPending();
        setPcbDraftRows((prev) =>
          prev.map((item) =>
            item.key === row.key ? newPcbContractDraftRow() : item,
          ),
        );
      } catch (e) {
        message.error(e instanceof Error ? e.message : "保存失败");
      } finally {
        setPcbSavingRowKey(null);
      }
    },
    [message, modal, pcbMaterialOptions, loadPcbPending],
  );

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_PURCHASE_TODAY_COLS,
        JSON.stringify(todayPoListColKeys),
      );
    } catch {
      /* ignore */
    }
  }, [todayPoListColKeys]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_PURCHASE_QUERY_COLS,
        JSON.stringify(queryPoListColKeys),
      );
    } catch {
      /* ignore */
    }
  }, [queryPoListColKeys]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_PURCHASE_PENDING_COLS,
        JSON.stringify(pendingPoListColKeys),
      );
    } catch {
      /* ignore */
    }
  }, [pendingPoListColKeys]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_PURCHASE_DETAIL_LINE_COLS,
        JSON.stringify(detailLineColKeys),
      );
    } catch {
      /* ignore */
    }
  }, [detailLineColKeys]);

  useEffect(() => {
    if (tab === "add") void loadTodayOrders();
  }, [tab, loadTodayOrders]);

  useEffect(() => {
    if (tab === "pending") void loadPendingPurchase();
  }, [tab, loadPendingPurchase]);

  useEffect(() => {
    if (tab === "pcb") void loadPcbPending();
  }, [tab, loadPcbPending]);

  useEffect(() => {
    if (tab !== "query") return;
    const range: [dayjs.Dayjs, dayjs.Dayjs] = [
      dayjs().subtract(7, "day").startOf("day"),
      dayjs().endOf("day"),
    ];
    queryForm.setFieldsValue({ dateRange: range });
    void loadQueryOrders({ dateRange: range });
  }, [tab, loadQueryOrders, queryForm]);

  const openCreate = (
    mode: "STANDARD_PURCHASE" | "PROCESSING_CONTRACT" = "STANDARD_PURCHASE",
  ) => {
    setCreateChannel(mode);
    setEditingPoId(null);
    createForm.resetFields();
    setPoLines([]);
    setCreateOpen(true);
  };

  const openEdit = useCallback(
    async (r: PurchaseOrderRow) => {
      if (r.status !== "PENDING_RECEIPT" && r.status !== "CONFIRMED") return;
      setEditingPoId(r.id);
      setCreateOpen(true);
      createForm.resetFields();
      setPoLines([]);
      try {
        const d = await fetchJson<DetailPayload>(`/api/purchase-orders/${r.id}`, {
          credentials: "include",
        });
        setCreateChannel(d.purchaseChannel ?? "STANDARD_PURCHASE");
        createForm.setFieldsValue({
          supplierId: d.supplier.id,
          remark: d.remark ?? "",
        });
        setPoLines(
          d.lines.map((l) => ({
            key: l.id,
            materialId: l.material.id,
            quantity: Number(l.quantity),
            unitPrice: Number(l.unitPrice),
            remark: l.remark ?? "",
          })),
        );
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载失败");
        setCreateOpen(false);
        setEditingPoId(null);
      }
    },
    [createForm, message],
  );

  const reloadListsAfterMutation = useCallback(async () => {
    await loadTodayOrders();
    await loadPendingPurchase();
    await loadPcbPending();
    if (tab === "query") {
      const vals = queryForm.getFieldsValue() as Record<string, unknown>;
      void loadQueryOrders(vals);
    }
  }, [loadTodayOrders, loadPendingPurchase, loadPcbPending, loadQueryOrders, queryForm, tab]);

  const submitCreate = async () => {
    let v: Awaited<ReturnType<typeof createForm.validateFields>>;
    try {
      v = await createForm.validateFields();
    } catch {
      return;
    }
    const filled = poLines.filter((l) => l.materialId);
    if (filled.length === 0) {
      message.error("请至少添加一行并选择物料");
      return;
    }
    if (filled.some((l) => !l.quantity || l.quantity <= 0)) {
      message.error("每行数量须大于 0");
      return;
    }
    const materialById = new Map((presets?.materials ?? []).map((m) => [m.id, m] as const));
    const hasCrossChannel = filled.some((l) => {
      const material = l.materialId ? materialById.get(l.materialId) : undefined;
      if (!material) return false;
      return material.purchaseChannel !== createChannel;
    });
    if (hasCrossChannel) {
      message.error(
        createChannel === "PROCESSING_CONTRACT"
          ? "PCB采购合同中不能选择常规采购物料"
          : "常规采购单中不能选择PCB加工合同物料",
      );
      return;
    }
    if (!editingPoId && createChannel === "PROCESSING_CONTRACT") {
      try {
        const reminderPayload = await fetchJson<{
          list: PendingChangeReminder[];
        }>("/api/customer-change-reminders/match", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            materialIds: filled
              .map((l) => l.materialId)
              .filter((id): id is string => Boolean(id)),
            channel: "purchase",
          }),
        });
        const proceed = await confirmPurchaseChannelReminders(
          modal,
          reminderPayload.list ?? [],
        );
        if (!proceed) return;
      } catch (e) {
        message.error(
          e instanceof Error ? e.message : "加载客户变更提醒失败",
        );
        return;
      }
    }
    setSubmitting(true);
    try {
      const body = {
        supplierId: v.supplierId,
        remark: v.remark ?? "",
        lines: filled.map((l) => ({
          materialId: l.materialId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          remark: l.remark || undefined,
        })),
      };
      if (editingPoId) {
        await fetchJson(`/api/purchase-orders/${editingPoId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        message.success("采购订单已更新");
      } else {
        await fetchJson("/api/purchase-orders", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        message.success("采购订单已保存");
      }
      setCreateOpen(false);
      setEditingPoId(null);
      await reloadListsAfterMutation();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  const openDetail = useCallback(
    async (id: string) => {
      setDetailOpen(true);
      setDetail(null);
      setLoadingDetail(true);
      try {
        const data = await fetchJson<DetailPayload>(`/api/purchase-orders/${id}`, {
          credentials: "include",
        });
        setDetail(data);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoadingDetail(false);
      }
    },
    [message],
  );

  const detailPurchaseOrderIdQ = searchParams.get("detailPurchaseOrderId");
  useEffect(() => {
    if (!detailPurchaseOrderIdQ) return;
    let cancelled = false;
    void (async () => {
      await openDetail(detailPurchaseOrderIdQ);
      if (!cancelled) router.replace(pathname, { scroll: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [detailPurchaseOrderIdQ, pathname, router, openDetail]);

  const openReceiptModal = useCallback(
    async (r: PurchaseOrderRow) => {
      if (r.status !== "PENDING_RECEIPT") return;
      setReceiptOrderId(r.id);
      setReceiptOrderNo(r.orderNo);
      setReceiptDetail(null);
      setReceiptQtyByLineId({});
      setReceiptSpareQtyByLineId({});
      setReceiptOpen(true);
      setReceiptLoading(true);
      try {
        const d = await fetchJson<DetailPayload>(
          `/api/purchase-orders/${r.id}?forReceipt=1`,
          {
            credentials: "include",
          },
        );
        const qtys: Record<string, number> = {};
        const spares: Record<string, number> = {};
        for (const line of d.lines) {
          qtys[line.id] = Math.round(Number(line.quantity));
          spares[line.id] = 0;
        }
        setReceiptDetail(d);
        setReceiptQtyByLineId(qtys);
        setReceiptSpareQtyByLineId(spares);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载失败");
        setReceiptOpen(false);
        setReceiptOrderId(null);
        setReceiptOrderNo(null);
      } finally {
        setReceiptLoading(false);
      }
    },
    [message],
  );

  const submitReceipt = useCallback(async () => {
    if (!receiptDetail || !receiptOrderId) {
      return Promise.reject(new Error("未就绪"));
    }
    const actionableLines = receiptDetail.lines.filter(
      (l) => !l.id.startsWith("syn-"),
    );
    if (actionableLines.length === 0) {
      message.warning("该采购单无可收料明细");
      return Promise.reject(new Error("validation"));
    }
    let anyPositive = false;
    for (const l of actionableLines) {
      const maxQ = Math.round(Number(l.quantity));
      const q = receiptQtyByLineId[l.id] ?? 0;
      const spareQ = Math.max(0, Math.round(receiptSpareQtyByLineId[l.id] ?? 0));
      if (q < 0 || q > maxQ) {
        message.warning("本次收料数量须在 0 与待收数量之间");
        return Promise.reject(new Error("validation"));
      }
      if (spareQ > 0 && q < maxQ) {
        message.warning("仅当本次收料等于待收数量时可填写备品数");
        return Promise.reject(new Error("validation"));
      }
      if (q > 0) anyPositive = true;
    }
    if (!anyPositive) {
      message.warning("至少一行本次收料数量须大于 0");
      return Promise.reject(new Error("validation"));
    }
    setReceiptSubmitting(true);
    try {
      const res = await fetchJson<{ ok?: boolean; fullyReceived?: boolean }>(
        `/api/purchase-orders/${receiptOrderId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmReceipt: true,
            lines: actionableLines.map((l) => ({
              lineId: l.id,
              receivedQty: receiptQtyByLineId[l.id] ?? 0,
              spareQty: Math.max(0, Math.round(receiptSpareQtyByLineId[l.id] ?? 0)),
            })),
          }),
        },
      );
      if (res.fullyReceived) {
        message.success("已确认收料，本单已全部入库");
      } else {
        message.success("本次收料已入库；未交数量仍保留在未交采购订单中，可再次收料");
      }
      setReceiptOpen(false);
      setReceiptOrderId(null);
      setReceiptOrderNo(null);
      setReceiptDetail(null);
      setReceiptQtyByLineId({});
      setReceiptSpareQtyByLineId({});
      await reloadListsAfterMutation();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "收料失败");
      return Promise.reject(e instanceof Error ? e : new Error("fail"));
    } finally {
      setReceiptSubmitting(false);
    }
  }, [
    message,
    receiptDetail,
    receiptOrderId,
    receiptQtyByLineId,
    receiptSpareQtyByLineId,
    reloadListsAfterMutation,
  ]);

  const receiptInspectionNotes = useMemo(() => {
    if (!receiptDetail) return [];
    const lines: { lineId: string; text: string }[] = [];
    const seen = new Set<string>();
    for (const l of receiptDetail.lines) {
      const note = l.material.inspectionNotes?.trim();
      if (!note) continue;
      const key = `${l.material.id}::${note}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({
        lineId: l.id,
        text: `${l.material.name}：${note}`,
      });
    }
    return lines;
  }, [receiptDetail]);

  const closeReceiptModal = useCallback(() => {
    setReceiptOpen(false);
    setReceiptOrderId(null);
    setReceiptOrderNo(null);
    setReceiptDetail(null);
    setReceiptQtyByLineId({});
    setReceiptSpareQtyByLineId({});
  }, []);

  const renderMutableListOpImpl = useCallback(
    (
      r: PurchaseOrderRow,
      opts?: {
        grantByPcbTab?: boolean;
        deleteLabel?: string;
        showDetailWhenReadonly?: boolean;
      },
    ) => {
      const grantByPcbTab = opts?.grantByPcbTab === true;
      const isEditableStatus =
        r.status === "PENDING_RECEIPT" || r.status === "CONFIRMED";
      const isPcbOrder = r.purchaseChannel === "PROCESSING_CONTRACT";
      const hasEditPerm =
        allowed("purchase.edit") || (grantByPcbTab && isPcbOrder && allowed("tab.pur.pcb"));
      const hasDeletePerm =
        allowed("purchase.delete") || (grantByPcbTab && isPcbOrder && allowed("tab.pur.pcb"));
      const hasReceivePerm =
        allowed("purchase.receive") || (grantByPcbTab && isPcbOrder && allowed("tab.pur.pcb"));
      const canEdit =
        isEditableStatus &&
        hasEditPerm &&
        r.canEdit !== false;
      const canDelete =
        isEditableStatus &&
        hasDeletePerm &&
        r.canDelete !== false;
      const canClose =
        r.status === "PENDING_RECEIPT" &&
        hasEditPerm &&
        r.canClose === true;
      const canConfirmReceipt =
        r.status === "PENDING_RECEIPT" &&
        hasReceivePerm;
      const showDetail = (opts?.showDetailWhenReadonly ?? true) && !canEdit && !canDelete && !canClose;
      return (
        <Space size={0} wrap>
          {(canEdit || canDelete || canClose) && (
            <>
              {canEdit ? (
                <Button type="link" size="small" onClick={() => void openEdit(r)}>
                  修改
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={() => {
                    modal.confirm({
                      title: `确定删除采购单 ${r.orderNo}？`,
                      okType: "danger",
                      content:
                        r.status === "CONFIRMED"
                          ? "该单已收料确认，删除后将一并从「采购订单查询」中移除，且不可恢复。"
                          : "待收料采购单删除后不可恢复。",
                      onOk: async () => {
                        await fetchJson(`/api/purchase-orders/${r.id}`, {
                          method: "DELETE",
                          credentials: "include",
                        });
                        message.success("已删除");
                        await reloadListsAfterMutation();
                      },
                    });
                  }}
                >
                  {opts?.deleteLabel ?? "删除"}
                </Button>
              ) : null}
            </>
          )}
          {canConfirmReceipt && (
            <Button
              type="link"
              size="small"
              onClick={() => void openReceiptModal(r)}
            >
              确定收料
            </Button>
          )}
          {canClose ? (
            <Button
              type="link"
              size="small"
              danger
              style={{ marginLeft: canConfirmReceipt ? 14 : 0 }}
              onClick={() => {
                modal.confirm({
                  title: `确定结单采购单 ${r.orderNo}？`,
                  content: "结单后该采购单将从未交列表移出。",
                  okType: "primary",
                  onOk: async () => {
                    await fetchJson(`/api/purchase-orders/${r.id}`, {
                      method: "PATCH",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ closeOrder: true }),
                    });
                    message.success("已结单");
                    await reloadListsAfterMutation();
                  },
                });
              }}
            >
              结单
            </Button>
          ) : null}
          {showDetail && (
            <Button type="link" size="small" onClick={() => void openDetail(r.id)}>
              详情
            </Button>
          )}
        </Space>
      );
    },
    [
      allowed,
      modal,
      message,
      openEdit,
      openDetail,
      openReceiptModal,
      reloadListsAfterMutation,
    ],
  );

  const renderMutableListOp = useCallback(
    (_: unknown, r: PurchaseOrderRow) => renderMutableListOpImpl(r),
    [renderMutableListOpImpl],
  );

  const renderPcbListOp = useCallback(
    (_: unknown, r: PurchaseOrderRow) =>
      renderMutableListOpImpl(r, {
        grantByPcbTab: true,
        deleteLabel: "取消",
        showDetailWhenReadonly: false,
      }),
    [renderMutableListOpImpl],
  );

  const purchaseListColsQuery = useMemo(
    () =>
      [
        {
          key: "orderNo",
          title: "采购单号",
          dataIndex: "orderNo",
          ellipsis: true,
        },
        {
          key: "supplier",
          title: "供应商",
          ellipsis: true,
          render: (_: unknown, r: PurchaseOrderRow) =>
            `${r.supplier.code} ${r.supplier.name}`,
        },
        {
          key: "salesOrder",
          title: "关联销售单",
          ellipsis: true,
          render: (_: unknown, r: PurchaseOrderRow) =>
            r.salesOrder?.customerOrderNo?.trim() || "—",
        },
        {
          key: "customerModel",
          title: "关联机型",
          ellipsis: true,
          render: (_: unknown, r: PurchaseOrderRow) =>
            r.salesOrder?.customerModel?.trim() || "—",
        },
        {
          key: "deliveryDueAt",
          title: "交货时间",
          width: 120,
          render: (_: unknown, r: PurchaseOrderRow) =>
            r.deliveryDueAt
              ? dayjs(r.deliveryDueAt).format("YYYY-MM-DD")
              : "—",
        },
        {
          key: "actualDeliveredAt",
          title: "实际交货日期",
          width: 128,
          render: (_: unknown, r: PurchaseOrderRow) =>
            r.actualDeliveredAt
              ? dayjs(r.actualDeliveredAt).format("YYYY-MM-DD")
              : "—",
        },
        {
          key: "status",
          title: "状态",
          width: 96,
          render: (_: unknown, r: PurchaseOrderRow) => {
            const s = r.status;
            if (s === "PENDING_RECEIPT") return "待收料";
            if (s === "CONFIRMED") return "已收料";
            if (s === "CANCELLED") return "已取消";
            if (s === "DRAFT") return "草稿";
            return s ?? "—";
          },
        },
        {
          key: "lineCount",
          title: "行数",
          dataIndex: "lineCount",
          render: (_: unknown, r: PurchaseOrderRow) => (
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: "auto" }}
              onClick={() => void openDetail(r.id)}
            >
              {r.lineCount}
            </Button>
          ),
        },
        {
          key: "orderPreview",
          title: "订单预览",
          width: 104,
          render: (_: unknown, r: PurchaseOrderRow) => (
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: "auto" }}
              onClick={() => openPoContractPreview(r)}
            >
              预览
            </Button>
          ),
        },
        {
          key: "remark",
          title: "备注",
          dataIndex: "remark",
          ellipsis: true,
          render: (t: string | null) => t ?? "—",
        },
        {
          key: "createdAt",
          title: "创建时间",
          dataIndex: "createdAt",
          render: (t: string) => dayjs(t).format("YYYY-MM-DD HH:mm"),
        },
      ] as ColumnsType<PurchaseOrderRow>,
    [openDetail, openPoContractPreview],
  );

  const purchaseListColsUndelivered = useMemo(
    () =>
      purchaseListColsQuery.filter((c) => c.key !== "actualDeliveredAt"),
    [purchaseListColsQuery],
  );

  const queryOnlyOpCol = useMemo(
    () =>
      ({
        key: "op",
        title: "操作",
        width: 88,
        render: (_: unknown, r: PurchaseOrderRow) => (
          <Button type="link" size="small" onClick={() => void openDetail(r.id)}>
            详情
          </Button>
        ),
      }) as ColumnsType<PurchaseOrderRow>[number],
    [openDetail],
  );

  const mutableOpCol = useMemo(
    () =>
      ({
        key: "op",
        title: "操作",
        width: 240,
        render: renderMutableListOp,
      }) as ColumnsType<PurchaseOrderRow>[number],
    [renderMutableListOp],
  );

  const pcbMutableOpCol = useMemo(
    () =>
      ({
        key: "op",
        title: "操作",
        width: 240,
        render: renderPcbListOp,
      }) as ColumnsType<PurchaseOrderRow>[number],
    [renderPcbListOp],
  );

  const todayListColumns = useMemo(() => {
    const base = [...purchaseListColsUndelivered, mutableOpCol];
    const visible = base.filter(
      (col) =>
        col.key === "op" ||
        col.key === "orderPreview" ||
        (typeof col.key === "string" && todayPoListColKeys.includes(col.key)),
    );
    return attachResizePurchaseList(
      visible,
      todayPoListColWidths,
      setTodayPoListColWidths,
      DEFAULT_PURCHASE_LIST_COL_WIDTH,
    );
  }, [
    purchaseListColsUndelivered,
    mutableOpCol,
    todayPoListColKeys,
    todayPoListColWidths,
  ]);

  const queryListColumns = useMemo(() => {
    const base = [...purchaseListColsQuery, queryOnlyOpCol];
    const visible = base.filter(
      (col) =>
        col.key === "op" ||
        col.key === "orderPreview" ||
        (typeof col.key === "string" && queryPoListColKeys.includes(col.key)),
    );
    return attachResizePurchaseList(
      visible,
      queryPoListColWidths,
      setQueryPoListColWidths,
      DEFAULT_PURCHASE_LIST_COL_WIDTH,
    );
  }, [
    purchaseListColsQuery,
    queryOnlyOpCol,
    queryPoListColKeys,
    queryPoListColWidths,
  ]);

  const pendingListColumns = useMemo(() => {
    const base = [...purchaseListColsUndelivered, mutableOpCol];
    const visible = base.filter(
      (col) =>
        col.key === "op" ||
        col.key === "orderPreview" ||
        (typeof col.key === "string" && pendingPoListColKeys.includes(col.key)),
    );
    return attachResizePurchaseList(
      visible,
      pendingPoListColWidths,
      setPendingPoListColWidths,
      DEFAULT_PURCHASE_LIST_COL_WIDTH,
    );
  }, [
    purchaseListColsUndelivered,
    mutableOpCol,
    pendingPoListColKeys,
    pendingPoListColWidths,
  ]);

  const pcbListColumns = useMemo(() => {
    const base = [...purchaseListColsUndelivered, pcbMutableOpCol];
    const visible = base.filter(
      (col) =>
        col.key === "op" ||
        col.key === "orderPreview" ||
        (typeof col.key === "string" && pendingPoListColKeys.includes(col.key)),
    );
    return attachResizePurchaseList(
      visible,
      pendingPoListColWidths,
      setPendingPoListColWidths,
      DEFAULT_PURCHASE_LIST_COL_WIDTH,
    );
  }, [
    purchaseListColsUndelivered,
    pcbMutableOpCol,
    pendingPoListColKeys,
    pendingPoListColWidths,
  ]);

  const detailPriceLabels = useMemo(
    () => moneyColumnLabels(detail?.supplier?.priceIncludesTax ?? false),
    [detail?.supplier?.priceIncludesTax],
  );

  const detailLineAllColumns = useMemo(
    () =>
      [
        {
          key: "materialCode",
          title: "物料编号",
          render: (_: unknown, r: DetailLine) => r.material.code,
        },
        {
          key: "materialName",
          title: "物料名称",
          ellipsis: true,
          render: (_: unknown, r: DetailLine) => r.material.name,
        },
        {
          key: "partDescription",
          title: "部件描述",
          ellipsis: true,
          render: (_: unknown, r: DetailLine) => r.material.partDescription ?? "—",
        },
        {
          key: "unit",
          title: "单位",
          render: (_: unknown, r: DetailLine) => r.material.unit,
        },
        {
          key: "quantity",
          title: "数量",
          render: (_: unknown, r: DetailLine) => r.quantity,
        },
        {
          key: "unitPrice",
          title: detailPriceLabels.unitPrice,
          render: (_: unknown, r: DetailLine) => r.unitPrice,
        },
        {
          key: "amount",
          title: detailPriceLabels.amount,
          render: (_: unknown, r: DetailLine) =>
            (Number(r.quantity) * Number(r.unitPrice)).toFixed(4),
        },
        {
          key: "lineRemark",
          title: "行备注",
          ellipsis: true,
          render: (_: unknown, r: DetailLine) => r.remark ?? "—",
        },
      ] as ColumnsType<DetailLine>,
    [detailPriceLabels],
  );

  const detailLineColumns = useMemo(() => {
    const visible = detailLineAllColumns.filter(
      (col) =>
        typeof col.key === "string" && detailLineColKeys.includes(col.key),
    );
    return attachResizePurchaseList(
      visible,
      detailLineColWidths,
      setDetailLineColWidths,
      DEFAULT_DETAIL_LINE_COL_WIDTH,
    );
  }, [detailLineAllColumns, detailLineColKeys, detailLineColWidths]);

  const pcbDraftColumns = useMemo<ColumnsType<PcbContractDraftRow>>(
    () => [
      {
        key: "contractNo",
        title: "合同号",
        width: 220,
        render: (_: unknown, row) => (
          <Input
            placeholder="请输入合同号"
            value={row.contractNo}
            onChange={(e) =>
              updatePcbDraftRow(row.key, { contractNo: e.target.value })
            }
          />
        ),
      },
      {
        key: "materialId",
        title: "物料名称",
        width: 340,
        render: (_: unknown, row) => (
          <Select
            showSearch
            style={{ width: "100%" }}
            placeholder="选择 PCB 物料"
            optionFilterProp="label"
            value={row.materialId}
            options={pcbMaterialOptions.map((m) => ({
              value: m.id,
              label: `${m.code} ${m.name}`,
            }))}
            onChange={(value) => {
              const picked = pcbMaterialOptions.find((m) => m.id === value);
              updatePcbDraftRow(row.key, {
                materialId: value,
                unitPrice: picked ? Number(picked.unitPrice) : row.unitPrice,
              });
            }}
          />
        ),
      },
      {
        key: "quantity",
        title: "数量",
        width: 120,
        render: (_: unknown, row) => (
          <InputNumber
            min={1}
            precision={0}
            style={{ width: "100%" }}
            value={row.quantity}
            onChange={(value) =>
              updatePcbDraftRow(row.key, { quantity: Number(value ?? 1) })
            }
          />
        ),
      },
      {
        key: "unitPrice",
        title: "单价",
        width: 140,
        render: (_: unknown, row) => (
          <InputNumber
            min={0}
            precision={4}
            step={0.0001}
            style={{ width: "100%" }}
            value={row.unitPrice}
            onChange={(value) =>
              updatePcbDraftRow(row.key, { unitPrice: Number(value ?? 0) })
            }
          />
        ),
      },
      {
        key: "deliveryDueAt",
        title: "交货日期",
        width: 170,
        render: (_: unknown, row) => (
          <DatePicker
            style={{ width: "100%" }}
            value={row.deliveryDueAt ? dayjs(row.deliveryDueAt) : null}
            onChange={(value) =>
              updatePcbDraftRow(row.key, {
                deliveryDueAt: value ? value.endOf("day").toISOString() : null,
              })
            }
          />
        ),
      },
      {
        key: "op",
        title: "操作",
        width: 150,
        render: (_: unknown, row) => (
          <Space size={4}>
            <Button
              type="primary"
              size="small"
              loading={pcbSavingRowKey === row.key}
              onClick={() => void savePcbDraftRow(row)}
            >
              保存
            </Button>
            <Button size="small" danger onClick={() => removePcbDraftRow(row.key)}>
              删除
            </Button>
          </Space>
        ),
      },
    ],
    [
      pcbMaterialOptions,
      pcbSavingRowKey,
      removePcbDraftRow,
      savePcbDraftRow,
      updatePcbDraftRow,
    ],
  );

  const visiblePurchaseTabKeys = useMemo(
    () =>
      (["add", "pcb", "pending", "query", "settings"] as const).filter((k) =>
        allowed([PURCHASE_TAB_PERM[k]]),
      ),
    [allowed],
  );

  useEffect(() => {
    if (tabPermLoading) return;
    if (visiblePurchaseTabKeys.length === 0) return;
    const keys = visiblePurchaseTabKeys as readonly string[];
    if (!keys.includes(tab)) {
      setTab(keys[0] ?? "add");
    }
  }, [tabPermLoading, visiblePurchaseTabKeys, tab]);

  return (
    <Card title="采购订单">
      {tabPermLoading ? (
        <div style={{ padding: 56, textAlign: "center" }}>
          <Spin size="large" />
        </div>
      ) : visiblePurchaseTabKeys.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          当前账号无可用的采购订单 TAB，请联系管理员在「员工管理 → 权限管理」中勾选对应 TAB。
        </Typography.Paragraph>
      ) : (
      <Tabs
        activeKey={tab}
        destroyOnHidden
        onChange={(k) => {
          setTab(k);
          if (
            k === "add" ||
            k === "pcb" ||
            k === "query" ||
            k === "pending" ||
            k === "settings"
          ) {
            void loadPresets();
          }
        }}
        items={[
          {
            key: "add",
            label: "新增采购订单",
            children: (
              <Space direction="vertical" size="large" style={{ width: "100%" }}>
                <Space wrap>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => setWizardOpen(true)}
                    disabled={loadingPresets}
                  >
                    从销售订单新建
                  </Button>
                  <Button
                    onClick={() => openCreate("STANDARD_PURCHASE")}
                    disabled={loadingPresets}
                  >
                    手动录入采购单
                  </Button>
                </Space>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    当日采购单
                  </Typography.Title>
                  <Space size={8}>
                    <PurchaseListColumnSettingButton
                      value={todayPoListColKeys}
                      onChange={setTodayPoListColKeys}
                      options={PURCHASE_ORDER_COL_OPTIONS_UNDELIVERED}
                    />
                    <HelpTip
                      text={
                        <>
                          「从销售订单新建」按 BOM 自动按供应商拆分多张采购单；手动录入为单供应商一单。下方为
                          <strong>当天新建</strong>
                          的采购单（待收料：修改/删除/确定收料，收料时可填本次实收数量以分批入库；已收料：修改/删除。点击行数可看明细）。
                        </>
                      }
                    />
                  </Space>
                </div>
                <Table<PurchaseOrderRow>
                  rowKey="id"
                  loading={loadingToday}
                  columns={todayListColumns}
                  dataSource={todayRows}
                  pagination={{ pageSize: 8 }}
                  scroll={{ x: "max-content" }}
                  tableLayout="fixed"
                  components={{
                    header: { cell: ResizableTableTitle },
                  }}
                />
              </Space>
            ),
          },
          {
            key: "pending",
            label: "未交采购订单",
            children: (
              <Space direction="vertical" size="large" style={{ width: "100%" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 8,
                    width: "100%",
                  }}
                >
                  <PurchaseListColumnSettingButton
                    value={pendingPoListColKeys}
                    onChange={setPendingPoListColKeys}
                    options={PURCHASE_ORDER_COL_OPTIONS_UNDELIVERED}
                  />
                  <Select
                    allowClear
                    showSearch
                    placeholder="供应商（全部）"
                    style={{ width: 220 }}
                    value={pendingSupplierId}
                    onChange={(v) => setPendingSupplierId(v)}
                    optionFilterProp="searchText"
                    options={(presets?.suppliers ?? []).map((s) => ({
                      value: s.id,
                      label: `${s.code} ${s.name}`,
                      searchText: `${s.code} ${s.name} ${s.shortName ?? ""}`.toLowerCase(),
                    }))}
                  />
                  <HelpTip
                    text={
                      <>
                        展示近一年内<strong>待收料</strong>的采购单。确定收料时可按
                        <strong>本次实收数量</strong>
                        分批入库；全部收完后进入「采购订单查询」。可进行修改、删除或确定收料。
                      </>
                    }
                  />
                </div>
                <Table<PurchaseOrderRow>
                  rowKey="id"
                  loading={loadingPending}
                  columns={pendingListColumns}
                  dataSource={pendingRows}
                  pagination={{ pageSize: 10 }}
                  scroll={{ x: "max-content" }}
                  tableLayout="fixed"
                  components={{
                    header: { cell: ResizableTableTitle },
                  }}
                />
              </Space>
            ),
          },
          {
            key: "pcb",
            label: "PCB采购",
            children: (
              <Space direction="vertical" size="large" style={{ width: "100%" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    width: "100%",
                    flexWrap: "wrap",
                  }}
                >
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    录入PCB加工合同
                  </Typography.Title>
                  <Button type="dashed" onClick={addPcbDraftRow}>
                    添加一行
                  </Button>
                </div>
                <Table<PcbContractDraftRow>
                  rowKey="key"
                  size="small"
                  pagination={false}
                  columns={pcbDraftColumns}
                  dataSource={pcbDraftRows}
                  scroll={{ x: "max-content" }}
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    width: "100%",
                    flexWrap: "wrap",
                  }}
                >
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    待收PCB加工合同
                  </Typography.Title>
                  <HelpTip
                    text={
                      <>
                        此处用于录入 PCB
                        加工合同，并在到料后执行「确定收料」入库；仅展示采购渠道为
                        <strong>PROCESSING_CONTRACT</strong>
                        的待收订单。
                      </>
                    }
                  />
                </div>
                <Table<PurchaseOrderRow>
                  rowKey="id"
                  loading={loadingPcb}
                  columns={pcbListColumns}
                  dataSource={pcbRows}
                  pagination={{ pageSize: 10 }}
                  scroll={{ x: "max-content" }}
                  tableLayout="fixed"
                  components={{
                    header: { cell: ResizableTableTitle },
                  }}
                />
              </Space>
            ),
          },
          {
            key: "query",
            label: "采购订单查询",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <Form
                  form={queryForm}
                  layout="inline"
                  style={{ rowGap: 12 }}
                  onFinish={(v) => void loadQueryOrders(v as Record<string, unknown>)}
                >
                  <Form.Item
                    name="dateRange"
                    label="创建时间"
                    rules={[{ required: true, message: "请选择日期范围" }]}
                  >
                    <DatePicker.RangePicker />
                  </Form.Item>
                  <Form.Item name="supplierId" label="供应商">
                    <Select
                      allowClear
                      placeholder="全部"
                      style={{ width: 200 }}
                      showSearch
                      optionFilterProp="searchText"
                      options={(presets?.suppliers ?? []).map((s) => ({
                        value: s.id,
                        label: `${s.code} ${s.name}`,
                        searchText: `${s.code} ${s.name} ${s.shortName ?? ""}`.toLowerCase(),
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name="orderNo" label="采购单号">
                    <Input allowClear placeholder="模糊" style={{ width: 160 }} />
                  </Form.Item>
                  <Form.Item name="purchaseChannel" label="采购渠道">
                    <Select
                      allowClear
                      placeholder="全部"
                      style={{ width: 180 }}
                      options={[
                        { value: "STANDARD_PURCHASE", label: "常规采购" },
                        { value: "PROCESSING_CONTRACT", label: "PCB采购" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit">
                      查询
                    </Button>
                  </Form.Item>
                  <Form.Item>
                    <Button
                      onClick={() => {
                        const range: [dayjs.Dayjs, dayjs.Dayjs] = [
                          dayjs().subtract(7, "day").startOf("day"),
                          dayjs().endOf("day"),
                        ];
                        queryForm.setFieldsValue({
                          dateRange: range,
                          supplierId: undefined,
                          orderNo: undefined,
                          purchaseChannel: undefined,
                        });
                        void loadQueryOrders({
                          dateRange: range,
                        } as Record<string, unknown>);
                      }}
                    >
                      重置
                    </Button>
                  </Form.Item>
                </Form>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 8,
                    width: "100%",
                  }}
                >
                  <PurchaseListColumnSettingButton
                    value={queryPoListColKeys}
                    onChange={setQueryPoListColKeys}
                    options={PURCHASE_ORDER_COL_OPTIONS_QUERY}
                  />
                  <HelpTip
                    text={
                      <>
                        仅查询<strong>已收料确认</strong>或<strong>已取消</strong>
                        的采购单；新建或待收料订单请在「新增采购订单 / 未交采购订单」中处理。未交列表仅显示
                        <strong>要求交货时间</strong>；<strong>实际交货日期</strong>仅在收料后于此处显示。
                      </>
                    }
                  />
                </div>
                <Table<PurchaseOrderRow>
                  rowKey="id"
                  loading={loadingQuery}
                  columns={queryListColumns}
                  dataSource={queryRows}
                  pagination={{
                    defaultPageSize: 10,
                    showSizeChanger: true,
                    pageSizeOptions: [10, 20, 50, 100],
                  }}
                  scroll={{ x: "max-content" }}
                  tableLayout="fixed"
                  components={{
                    header: { cell: ResizableTableTitle },
                  }}
                />
              </Space>
            ),
          },
          {
            key: "settings",
            label: "采购订单设置",
            children: <PurchaseTemplateVisualEditor />,
          },
        ].filter((item) => {
          const code = PURCHASE_TAB_PERM[String(item.key)];
          return code ? allowed([code]) : false;
        })}
      />
      )}

      <PurchaseFromSalesWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={() => {
          void loadTodayOrders();
          void loadPendingPurchase();
        }}
      />

      <Modal
        title={
          editingPoId
            ? "修改采购订单"
            : createChannel === "PROCESSING_CONTRACT"
              ? "录入PCB加工合同"
              : "手动录入采购订单"
        }
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          setEditingPoId(null);
        }}
        onOk={() => void submitCreate()}
        confirmLoading={submitting}
        width={880}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="supplierId"
            label="供应商"
            rules={[{ required: true, message: "请选择供应商" }]}
          >
            <Select
              placeholder="选择供应商"
              showSearch
              optionFilterProp="searchText"
              options={(presets?.suppliers ?? []).map((s) => ({
                value: s.id,
                label: `${s.code} ${s.name}`,
                searchText: `${s.code} ${s.name} ${s.shortName ?? ""}`.toLowerCase(),
              }))}
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
        </Form>
        <PoLinesEditor
          lines={poLines}
          setLines={setPoLines}
          materials={(presets?.materials ?? []).filter(
            (m) => m.purchaseChannel === createChannel,
          )}
          priceIncludesTax={createSupplierPriceIncludesTax}
        />
      </Modal>

      <Modal
        title={detail ? `采购单 ${detail.orderNo}` : "采购单详情"}
        open={detailOpen}
        onCancel={() => {
          setDetailOpen(false);
          setDetail(null);
        }}
        footer={
          <Space wrap>
            <Button onClick={() => setDetailOpen(false)}>关闭</Button>
            {detail ? (
              <>
                <Button
                  onClick={() =>
                    openPoContractPreview({
                      id: detail.id,
                      orderNo: detail.orderNo,
                    } as PurchaseOrderRow)
                  }
                >
                  订单预览 / 合同打印
                </Button>
              </>
            ) : null}
          </Space>
        }
        width={960}
        destroyOnHidden
      >
        {loadingDetail ? (
          <Typography.Text type="secondary">加载中…</Typography.Text>
        ) : detail ? (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Typography.Text>
              <strong>状态：</strong>
              {detail.status === "PENDING_RECEIPT"
                ? "待收料"
                : detail.status === "CONFIRMED"
                  ? "已收料"
                  : detail.status === "CANCELLED"
                    ? "已取消"
                    : detail.status === "DRAFT"
                      ? "草稿"
                      : (detail.status ?? "—")}
            </Typography.Text>
            <Typography.Text>
              <strong>供应商：</strong>
              {detail.supplier.code} {detail.supplier.name}
            </Typography.Text>
            <Typography.Text>
              <strong>备注：</strong>
              {detail.remark ?? "—"}
            </Typography.Text>
            <Typography.Text>
              <strong>交货时间（采购）：</strong>
              {detail.deliveryDueAt
                ? dayjs(detail.deliveryDueAt).format("YYYY-MM-DD")
                : "—"}
            </Typography.Text>
            <Typography.Text>
              <strong>实际交货日期：</strong>
              {detail.actualDeliveredAt
                ? dayjs(detail.actualDeliveredAt).format("YYYY-MM-DD")
                : "—"}
            </Typography.Text>
            <Typography.Text type="secondary">
              创建时间：{dayjs(detail.createdAt).format("YYYY-MM-DD HH:mm:ss")}
            </Typography.Text>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                width: "100%",
              }}
            >
              <PurchaseListColumnSettingButton
                value={detailLineColKeys}
                onChange={setDetailLineColKeys}
                options={DETAIL_LINE_COL_OPTIONS}
              />
            </div>
            <Table<DetailLine>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={detail.lines}
              scroll={{ x: "max-content" }}
              tableLayout="fixed"
              columns={detailLineColumns}
              components={{
                header: { cell: ResizableTableTitle },
              }}
            />
          </Space>
        ) : null}
      </Modal>

      <PurchaseOrderContractPreviewModal
        open={poContractPreviewOpen}
        purchaseOrderId={poContractPreviewId}
        orderNo={poContractPreviewNo}
        onClose={() => {
          setPoContractPreviewOpen(false);
          setPoContractPreviewId(null);
          setPoContractPreviewNo(null);
        }}
      />

      <Modal
        title={
          <Space size={6}>
            <span>{receiptOrderNo ? `确认收料 — ${receiptOrderNo}` : "确认收料"}</span>
            <HelpTip
              text={
                <>
                  默认每行<strong>本次收料</strong>等于<strong>待收数量</strong>
                  。供应商分批交货时请改为本次实收数量；实收部分进入物料库存，未收数量仍保留在本单，可再次点击「确定收料」。
                  <strong>订单数量</strong>为该行原始采购数量；<strong>已收数量</strong>可点击展开各次收料日期与数量。
                </>
              }
            />
          </Space>
        }
        open={receiptOpen}
        onCancel={closeReceiptModal}
        footer={
          <div style={{ width: "100%" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <Button onClick={closeReceiptModal}>取消</Button>
              <Button type="primary" loading={receiptSubmitting} onClick={() => void submitReceipt()}>
                确认入库
              </Button>
            </div>
            {receiptInspectionNotes.length > 0 ? (
              <div
                style={{
                  marginTop: 10,
                  borderRadius: 6,
                  background: "#fffbe6",
                  border: "1px solid #ffe58f",
                  padding: "8px 10px",
                  textAlign: "left",
                }}
              >
                <Typography.Text strong style={{ fontSize: 18 }}>
                  物料检料注意事项
                </Typography.Text>
                <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                  {receiptInspectionNotes.map((n) => (
                    <li key={n.lineId} style={{ fontSize: 18, lineHeight: 1.6 }}>
                      {n.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div
                style={{
                  marginTop: 10,
                  borderRadius: 6,
                  background: "#fafafa",
                  border: "1px dashed #d9d9d9",
                  padding: "8px 10px",
                  textAlign: "left",
                }}
              >
                <Typography.Text strong style={{ fontSize: 18 }}>
                  物料检料注意事项
                </Typography.Text>
                <div style={{ marginTop: 6, fontSize: 18, color: "#8c8c8c" }}>
                  暂无注意事项
                </div>
              </div>
            )}
          </div>
        }
        width={980}
        destroyOnHidden
      >
        {receiptLoading ? (
          <Typography.Text type="secondary">加载明细…</Typography.Text>
        ) : receiptDetail ? (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Table<DetailLine>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={receiptDetail.lines}
              scroll={{ x: "max-content" }}
              columns={[
                {
                  title: "物料编号",
                  width: 120,
                  render: (_, l) => l.material.code,
                },
                {
                  title: "物料名称",
                  width: 160,
                  ellipsis: true,
                  render: (_, l) => l.material.name,
                },
                {
                  title: "单位",
                  width: 64,
                  render: (_, l) => l.material.unit,
                },
                {
                  title: "订单数量",
                  width: 96,
                  align: "right",
                  render: (_, l) =>
                    orderQtyForLine(l, receiptDetail.receiptBatches),
                },
                {
                  title: "已收数量",
                  width: 96,
                  align: "right",
                  render: (_, l) => {
                    const batches = receiptBatchesForMaterial(
                      receiptDetail.receiptBatches,
                      l.material.id,
                    );
                    const total = totalReceivedForMaterial(
                      receiptDetail.receiptBatches,
                      l.material.id,
                    );
                    const popContent =
                      batches.length === 0 ? (
                        <Typography.Text type="secondary">
                          暂无收料记录
                        </Typography.Text>
                      ) : (
                        <ul
                          style={{
                            margin: 0,
                            paddingLeft: 18,
                            maxHeight: 280,
                            overflowY: "auto",
                          }}
                        >
                          {batches.map((b, i) => (
                            <li key={`${b.receivedAt}-${i}-${b.quantity}`}>
                              {dayjs(b.receivedAt).format("YYYY-MM-DD HH:mm")} —{" "}
                              {b.quantity}
                            </li>
                          ))}
                        </ul>
                      );
                    return (
                      <Popover title="收料记录" content={popContent} trigger="click">
                        <Button type="link" style={{ padding: 0, height: "auto" }}>
                          {total}
                        </Button>
                      </Popover>
                    );
                  },
                },
                {
                  title: "待收数量",
                  width: 100,
                  align: "right",
                  render: (_, l) => l.quantity,
                },
                {
                  title: "本次收料",
                  width: 160,
                  render: (_, l) => {
                    const maxQ = Math.round(Number(l.quantity));
                    const disabled = maxQ <= 0 || l.id.startsWith("syn-");
                    return (
                      <InputNumber
                        min={0}
                        max={maxQ}
                        precision={0}
                        style={{ width: "100%" }}
                        disabled={disabled}
                        value={receiptQtyByLineId[l.id] ?? 0}
                        onChange={(v) => {
                          const n =
                            v === null || v === undefined
                              ? 0
                              : Math.min(
                                  Math.max(0, Math.round(Number(v))),
                                  maxQ,
                                );
                          setReceiptQtyByLineId((prev) => ({
                            ...prev,
                            [l.id]: n,
                          }));
                          if (n < maxQ) {
                            setReceiptSpareQtyByLineId((prev) => ({
                              ...prev,
                              [l.id]: 0,
                            }));
                          }
                        }}
                      />
                    );
                  },
                },
                {
                  title: "备品数",
                  width: 120,
                  render: (_, l) => {
                    const maxQ = Math.round(Number(l.quantity));
                    const receiveQ = receiptQtyByLineId[l.id] ?? 0;
                    const canInputSpare =
                      !l.id.startsWith("syn-") && maxQ > 0 && receiveQ >= maxQ;
                    return (
                      <InputNumber
                        min={0}
                        precision={0}
                        style={{ width: "100%" }}
                        disabled={!canInputSpare}
                        value={receiptSpareQtyByLineId[l.id] ?? 0}
                        onChange={(v) => {
                          const n =
                            v === null || v === undefined
                              ? 0
                              : Math.max(0, Math.round(Number(v)));
                          setReceiptSpareQtyByLineId((prev) => ({
                            ...prev,
                            [l.id]: n,
                          }));
                        }}
                      />
                    );
                  },
                },
              ]}
            />
          </Space>
        ) : null}
      </Modal>
    </Card>
  );
}
