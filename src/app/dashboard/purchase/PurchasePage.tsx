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
import { useMeTabPermissions } from "@/lib/use-me-tab-permissions";
import { PurchaseFromSalesWizard } from "./PurchaseFromSalesWizard";

const PURCHASE_TAB_PERM: Record<string, string> = {
  add: "tab.pur.add",
  pending: "tab.pur.open",
  query: "tab.pur.query",
  settings: "tab.pur.settings",
};
import { PurchaseOrderContractPreviewModal } from "./PurchaseOrderContractPreviewModal";
import { PurchaseTemplateVisualEditor } from "./PurchaseTemplateVisualEditor";

type SupplierOpt = { id: string; code: string; name: string };
type MaterialOpt = {
  id: string;
  code: string;
  name: string;
  unit: string;
  unitPrice: string;
  supplier: { id: string; code: string; name: string };
};

type PurchasePresetBundle = {
  suppliers: SupplierOpt[];
  materials: MaterialOpt[];
};

type PurchaseOrderRow = {
  id: string;
  orderNo: string;
  remark: string | null;
  status?: string;
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

/** 当日 / 未交：仅有「要求交货时间」；收料前无实际交货日 */
const PURCHASE_ORDER_COL_OPTIONS_UNDELIVERED: { label: string; value: string }[] =
  [
    { label: "采购单号", value: "orderNo" },
    { label: "供应商", value: "supplier" },
    { label: "关联销售单", value: "salesOrder" },
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
}: {
  lines: PoLine[];
  setLines: Dispatch<SetStateAction<PoLine[]>>;
  materials: MaterialOpt[];
}) {
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
      title: "单价",
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
    [lines, materials, updateLine, removeLine],
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
  const [createForm] = Form.useForm();
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

  const buildQuery = useCallback(
    (
      createdFrom: string,
      createdTo: string,
      v: Record<string, unknown>,
      mode: "default" | "pending" | "inQuery",
    ) => {
      const p = new URLSearchParams();
      p.set("createdFrom", createdFrom);
      p.set("createdTo", createdTo);
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
        `/api/purchase-orders?${buildQuery(start, end, {}, "default")}`,
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
        `/api/purchase-orders?${buildQuery(start, end, {}, "pending")}`,
        { credentials: "include" },
      );
      setPendingRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
      setPendingRows([]);
    } finally {
      setLoadingPending(false);
    }
  }, [message, buildQuery]);

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
        const data = await fetchJson<{ list: PurchaseOrderRow[] }>(
          `/api/purchase-orders?${buildQuery(start, end, v, "inQuery")}`,
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
    if (tab !== "query") return;
    const range: [dayjs.Dayjs, dayjs.Dayjs] = [
      dayjs().subtract(7, "day").startOf("day"),
      dayjs().endOf("day"),
    ];
    queryForm.setFieldsValue({ dateRange: range });
    void loadQueryOrders({ dateRange: range });
  }, [tab, loadQueryOrders, queryForm]);

  const openCreate = () => {
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
    if (tab === "query") {
      const vals = queryForm.getFieldsValue() as Record<string, unknown>;
      void loadQueryOrders(vals);
    }
  }, [loadTodayOrders, loadPendingPurchase, loadQueryOrders, queryForm, tab]);

  const submitCreate = async () => {
    const v = await createForm.validateFields();
    const filled = poLines.filter((l) => l.materialId);
    if (filled.length === 0) {
      message.error("请至少添加一行并选择物料");
      return;
    }
    if (filled.some((l) => !l.quantity || l.quantity <= 0)) {
      message.error("每行数量须大于 0");
      return;
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
      setReceiptOpen(true);
      setReceiptLoading(true);
      try {
        const d = await fetchJson<DetailPayload>(`/api/purchase-orders/${r.id}`, {
          credentials: "include",
        });
        const qtys: Record<string, number> = {};
        for (const line of d.lines) {
          qtys[line.id] = Math.round(Number(line.quantity));
        }
        setReceiptDetail(d);
        setReceiptQtyByLineId(qtys);
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
    let anyPositive = false;
    for (const l of receiptDetail.lines) {
      const maxQ = Math.round(Number(l.quantity));
      const q = receiptQtyByLineId[l.id] ?? 0;
      if (q < 0 || q > maxQ) {
        message.warning("本次收料数量须在 0 与待收数量之间");
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
            lines: receiptDetail.lines.map((l) => ({
              lineId: l.id,
              receivedQty: receiptQtyByLineId[l.id] ?? 0,
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
    reloadListsAfterMutation,
  ]);

  const renderMutableListOp = useCallback(
    (_: unknown, r: PurchaseOrderRow) => {
      const isEditableStatus =
        r.status === "PENDING_RECEIPT" || r.status === "CONFIRMED";
      const canEdit = isEditableStatus && allowed("purchase.edit");
      const canDelete = isEditableStatus && allowed("purchase.delete");
      const canConfirmReceipt =
        r.status === "PENDING_RECEIPT" && allowed("purchase.receive");
      const showDetail = !canEdit && !canDelete;
      return (
        <Space size={0} wrap>
          {(canEdit || canDelete) && (
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
                  删除
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
          title: "单价",
          render: (_: unknown, r: DetailLine) => r.unitPrice,
        },
        {
          key: "amount",
          title: "金额",
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
    [],
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

  const visiblePurchaseTabKeys = useMemo(
    () =>
      (["add", "pending", "query", "settings"] as const).filter((k) =>
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
                  <Button onClick={openCreate} disabled={loadingPresets}>
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
                      optionFilterProp="label"
                      options={(presets?.suppliers ?? []).map((s) => ({
                        value: s.id,
                        label: `${s.code} ${s.name}`,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name="orderNo" label="采购单号">
                    <Input allowClear placeholder="模糊" style={{ width: 160 }} />
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
        title={editingPoId ? "修改采购订单" : "手动录入采购订单"}
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
              optionFilterProp="label"
              options={(presets?.suppliers ?? []).map((s) => ({
                value: s.id,
                label: `${s.code} ${s.name}`,
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
          materials={presets?.materials ?? []}
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
          <Button type="primary" onClick={() => setDetailOpen(false)}>
            关闭
          </Button>
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
        onCancel={() => {
          setReceiptOpen(false);
          setReceiptOrderId(null);
          setReceiptOrderNo(null);
          setReceiptDetail(null);
          setReceiptQtyByLineId({});
        }}
        okText="确认入库"
        onOk={() => submitReceipt()}
        confirmLoading={receiptSubmitting}
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
                    return (
                      <InputNumber
                        min={0}
                        max={maxQ}
                        precision={0}
                        style={{ width: "100%" }}
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
