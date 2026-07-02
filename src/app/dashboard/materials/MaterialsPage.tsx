"use client";

import {
  DownloadOutlined,
  EyeOutlined,
  FileExcelOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type { ResizeCallbackData } from "react-resizable";
import {
  App,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popover,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadProps } from "antd";
import dayjs from "dayjs";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Dispatch, SetStateAction, SyntheticEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { useMeTabPermissions } from "@/lib/use-me-tab-permissions";
import { ResizableTableTitle } from "@/components/ResizableTableTitle";
import { MaterialSettingsTab } from "./MaterialSettingsTab";

/** 物料信息页 TAB ↔ 权限矩阵 code */
const MATERIAL_TAB_PERM: Record<string, string> = {
  add: "tab.mat.add",
  inventory: "tab.mat.inv",
  customerSupply: "tab.mat.customerSupply",
  stockAdjust: "tab.mat.adjust",
  deprecated: "tab.mat.deprecated",
  settings: "tab.mat.settings",
};

type SupplierOpt = { id: string; code: string; name: string; shortName?: string | null };
type CustomerOpt = { id: string; code: string; name: string; shortName?: string | null };

type MaterialRow = {
  id: string;
  code: string;
  name: string;
  isDeprecated: boolean;
  deprecatedAt: string | null;
  deprecatedReason: string | null;
  partDescription: string | null;
  brand: string | null;
  unit: string;
  unitPrice: string;
  safetyStock: number | null;
  maxStock: number | null;
  kindId: string | null;
  kindName: string;
  isCustomerSupplied: boolean;
  isPcbPurchase?: boolean;
  customer: CustomerOpt | null;
  supplier: SupplierOpt;
  inspectionNotes: string | null;
  sampleImageUrls: string[];
  totalQty: number;
  createdAt: string;
};

type InventoryRow = {
  id: string;
  code: string;
  name: string;
  isDeprecated: boolean;
  deprecatedAt: string | null;
  deprecatedReason: string | null;
  partDescription: string | null;
  brand: string | null;
  unit: string;
  unitPrice: string;
  safetyStock: number | null;
  maxStock: number | null;
  kindId: string | null;
  kindName: string;
  isCustomerSupplied: boolean;
  isPcbPurchase?: boolean;
  customer: CustomerOpt | null;
  supplier: SupplierOpt;
  inspectionNotes: string | null;
  sampleImageUrls: string[];
  createdAt: string;
  totalQty: number;
  lastReceivedAt: string | null;
};

type InboundRow = {
  id: string;
  quantity: string;
  entryType:
    | "REGULAR"
    | "MANUAL_STOCK_ADJUST"
    | "CUSTOMER_SUPPLY_RECEIPT";
  receivedAt: string;
  purchaseOrderNo: string | null;
  partDescription: string | null;
  operatorName?: string | null;
  operatorEmployeeNo?: string | null;
};

function materialInboundTypeLabel(r: InboundRow): string {
  const qty = Number(r.quantity || 0);
  if (r.entryType === "MANUAL_STOCK_ADJUST") {
    return qty >= 0 ? "盘点入库" : "盘点出库";
  }
  if (r.entryType === "CUSTOMER_SUPPLY_RECEIPT") {
    return qty >= 0 ? "客供入库" : "客供出库";
  }
  return qty >= 0 ? "入库" : "出库";
}

type DetailPayload = {
  id: string;
  code: string;
  name: string;
  isDeprecated: boolean;
  deprecatedAt: string | null;
  deprecatedReason: string | null;
  partDescription: string | null;
  brand: string | null;
  unit: string;
  unitPrice: string;
  safetyStock: number | null;
  maxStock: number | null;
  kindId: string | null;
  kindName: string;
  isCustomerSupplied: boolean;
  isPcbPurchase?: boolean;
  customer: CustomerOpt | null;
  supplier: { id: string; code: string; name: string; materialType: string | null; level: string | null };
  inspectionNotes: string | null;
  sampleImageUrls: string[];
  totalQty: number;
  createdAt: string;
  updatedAt: string;
  inbounds: InboundRow[];
  usedByProducts: UsedByProductRow[];
};

type UsedByProductRow = {
  productId: string;
  customerMaterialCode: string;
  model: string;
  spec: string;
  unit: string;
  processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
  scope: "DEFAULT" | "OUTSOURCE" | "INHOUSE";
  usageQty: string;
  isDeprecated: boolean;
  customer: { id: string; code: string; name: string };
};

function productProcessingModeLabel(
  mode: UsedByProductRow["processingMode"],
): string {
  if (mode === "OUTSOURCE") return "外发";
  if (mode === "OUTSOURCE_INHOUSE") return "外发+自加工";
  return "自加工";
}

function productBomScopeLabel(
  scope: UsedByProductRow["scope"],
  processingMode: UsedByProductRow["processingMode"],
): string {
  if (processingMode !== "OUTSOURCE_INHOUSE") return "—";
  if (scope === "OUTSOURCE") return "外发";
  if (scope === "INHOUSE") return "自加工";
  return "—";
}

type CustomerSupplyMaterialOption = {
  id: string;
  code: string;
  name: string;
  customerId: string | null;
  partDescription: string | null;
  customer: CustomerOpt | null;
};

type CustomerSupplyInboundRow = {
  id: string;
  quantity: number;
  receivedAt: string;
  partDescription: string | null;
  remark: string | null;
  customer: CustomerOpt | null;
  material: { id: string; code: string; name: string; unit: string };
  operatorName?: string | null;
  operatorEmployeeNo?: string | null;
};

type PresetBundle = {
  kinds: {
    id: string;
    name: string;
    prefix: string;
    namingMode: "STANDARD" | "CUSTOM";
    sortOrder: number;
  }[];
  names: { id: string; name: string; namePrefix: string; sortOrder: number }[];
  brands: { id: string; name: string; sortOrder: number }[];
  units: { id: string; name: string; isDefault: boolean; sortOrder: number }[];
};

function isPcbKindName(name: string | null | undefined): boolean {
  return String(name ?? "")
    .trim()
    .toUpperCase() === "PCB";
}

function inferCustomNamePrefixFromCode(code: string): string {
  const seg = String(code ?? "")
    .split("-")
    .map((s) => s.trim())
    .filter(Boolean);
  if (seg.length >= 3) return seg[1] ?? "";
  return "";
}

const LS_MAT_COLS = "materials.table.visibleCols.mat.v2";
const LS_INV_COLS = "materials.table.visibleCols.inv.v2";

const MAT_COL_OPTIONS: { label: string; value: string }[] = [
  { label: "物料编号", value: "code" },
  { label: "物料名称", value: "name" },
  { label: "种类", value: "kind" },
  { label: "品牌", value: "brand" },
  { label: "部件描述", value: "partDescription" },
  { label: "物料图片", value: "sampleImages" },
  { label: "检料注意事项", value: "inspectionNotes" },
  { label: "建档日期", value: "createdAt" },
  { label: "供应商", value: "supplier" },
  { label: "库存数量", value: "totalQty" },
];

const INV_COL_OPTIONS: { label: string; value: string }[] = [
  { label: "物料编号", value: "code" },
  { label: "物料名称", value: "name" },
  { label: "种类", value: "kind" },
  { label: "部件描述", value: "partDescription" },
  { label: "物料图片", value: "sampleImages" },
  { label: "检料注意事项", value: "inspectionNotes" },
  { label: "建档日期", value: "createdAt" },
  { label: "供应商", value: "supplier" },
  { label: "库存数量", value: "totalQty" },
  { label: "最近入库", value: "lastReceivedAt" },
];

const MAT_ALL_KEYS = MAT_COL_OPTIONS.map((o) => o.value);
const INV_ALL_KEYS = INV_COL_OPTIONS.map((o) => o.value);
/** 库存表默认不展开「部件描述」，可在列设置中勾选显示 */
const INV_DEFAULT_KEYS = INV_ALL_KEYS.filter((k) => k !== "partDescription");

const DEFAULT_MAT_COL_WIDTH: Record<string, number> = {
  code: 128,
  name: 160,
  kind: 96,
  brand: 88,
  partDescription: 120,
  sampleImages: 108,
  inspectionNotes: 160,
  createdAt: 156,
  supplier: 140,
  totalQty: 96,
};

const DEFAULT_INV_COL_WIDTH: Record<string, number> = {
  code: 128,
  name: 160,
  kind: 96,
  partDescription: 132,
  sampleImages: 108,
  inspectionNotes: 160,
  createdAt: 156,
  supplier: 140,
  totalQty: 96,
  lastReceivedAt: 168,
};

const MAT_ADJ_OP_WIDTH = 168;
const MAT_ADJ_TABLE_WIDTH = 960;
const MAT_ADJ_UNIFORM_COL = Math.floor(
  (MAT_ADJ_TABLE_WIDTH - MAT_ADJ_OP_WIDTH) / 5,
);

const DEFAULT_MAT_ADJ_COL_WIDTH: Record<string, number> = {
  code: MAT_ADJ_UNIFORM_COL,
  name: MAT_ADJ_UNIFORM_COL,
  kind: MAT_ADJ_UNIFORM_COL,
  partDescription: MAT_ADJ_UNIFORM_COL,
  q: MAT_ADJ_UNIFORM_COL,
};

function attachResize<T extends object>(
  columns: ColumnsType<T>,
  widths: Record<string, number>,
  setWidths: Dispatch<SetStateAction<Record<string, number>>>,
  defaults: Record<string, number>,
): ColumnsType<T> {
  return columns.map((col) => {
    const key = col.key != null ? String(col.key) : "";
    if (!key || key === "op" || key === "d") {
      const w = key === "op" ? 168 : key === "d" ? 88 : (col.width as number) ?? 120;
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

function loadVisibleColKeys(
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
    const set = new Set(parsed.filter((x): x is string => typeof x === "string"));
    const kept = allKeys.filter((k) => set.has(k));
    return kept.length > 0 ? kept : fallback;
  } catch {
    return fallback;
  }
}

function ColumnSettingButton({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[];
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
          options={options}
        />
      }
    >
      <Button type="text" icon={<SettingOutlined />} aria-label="列设置" />
    </Popover>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip title={text} placement="top">
      <QuestionCircleOutlined
        style={{ color: "rgba(0,0,0,0.45)", fontSize: 14, cursor: "help" }}
      />
    </Tooltip>
  );
}

export function MaterialsPage() {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("add");

  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);

  const [presets, setPresets] = useState<PresetBundle | null>(null);

  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [loadingMat, setLoadingMat] = useState(false);

  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [loadingInv, setLoadingInv] = useState(false);

  const [addForm] = Form.useForm();
  const addFormFieldsPendingRef = useRef<Record<string, unknown> | null>(null);
  const [sampleUrls, setSampleUrls] = useState<string[]>([]);

  const [filterForm] = Form.useForm();
  const addIsCustomerSupplied = Form.useWatch("isCustomerSupplied", addForm);
  const addKindId = Form.useWatch("kindId", addForm) as string | undefined;

  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingMaterialInfo, setEditingMaterialInfo] = useState<{
    isDeprecated: boolean;
    code: string;
    name: string;
  } | null>(null);
  const [deprecating, setDeprecating] = useState(false);
  const [deletingFromEdit, setDeletingFromEdit] = useState(false);
  const [editForm] = Form.useForm();
  const editIsCustomerSupplied = Form.useWatch("isCustomerSupplied", editForm);
  const editKindId = Form.useWatch("kindId", editForm) as string | undefined;
  /** 弹窗带 destroyOnHidden 时，须在打开后再 setFieldsValue，否则表单未挂载会报警告 */
  const editFormFieldsPendingRef = useRef<Record<string, unknown> | null>(null);
  const [editSamples, setEditSamples] = useState<string[]>([]);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [usedByProductsOpen, setUsedByProductsOpen] = useState(false);

  const [addOpen, setAddOpen] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSubmitting, setImportSubmitting] = useState(false);

  const [stockAdjustOpen, setStockAdjustOpen] = useState(false);
  const [stockAdjustTarget, setStockAdjustTarget] = useState<InventoryRow | null>(null);
  const [stockAdjustForm] = Form.useForm<{ delta: number; remark?: string }>();
  const [stockAdjustSubmitting, setStockAdjustSubmitting] = useState(false);

  const [matColKeys, setMatColKeys] = useState<string[]>(MAT_ALL_KEYS);
  const [invColKeys, setInvColKeys] = useState<string[]>(INV_DEFAULT_KEYS);
  const [matColWidths, setMatColWidths] = useState<Record<string, number>>({});
  const [invColWidths, setInvColWidths] = useState<Record<string, number>>({});
  const [matAdjColWidths, setMatAdjColWidths] = useState<Record<string, number>>({});
  const skipMatColPersist = useRef(true);
  const skipInvColPersist = useRef(true);

  const [customerSupplyQueryForm] = Form.useForm<{
    customerId?: string;
    materialId?: string;
    partDescription?: string;
    keyword?: string;
  }>();
  const [customerSupplyBatchForm] = Form.useForm<{
    receivedAt: dayjs.Dayjs;
    remark?: string;
  }>();
  /** 筛选项下拉用（选客户后立即刷新；不驱动下方列表） */
  const [customerSupplyCatalog, setCustomerSupplyCatalog] = useState<
    CustomerSupplyMaterialOption[]
  >([]);
  /** 点「查询」后的列表数据 */
  const [customerSupplyQueryResults, setCustomerSupplyQueryResults] = useState<
    CustomerSupplyMaterialOption[]
  >([]);
  const [customerSupplyPartDescSuggestions, setCustomerSupplyPartDescSuggestions] =
    useState<string[]>([]);
  const [customerSupplyRows, setCustomerSupplyRows] = useState<
    CustomerSupplyInboundRow[]
  >([]);
  const [loadingCustomerSupplyCatalog, setLoadingCustomerSupplyCatalog] =
    useState(false);
  const [loadingCustomerSupply, setLoadingCustomerSupply] = useState(false);
  const [submittingCustomerSupply, setSubmittingCustomerSupply] = useState(false);
  const [customerSupplyInboundMode, setCustomerSupplyInboundMode] = useState(false);
  const [customerSupplySelectedMaterialIds, setCustomerSupplySelectedMaterialIds] =
    useState<string[]>([]);
  const [customerSupplyInboundQtyByMaterialId, setCustomerSupplyInboundQtyByMaterialId] =
    useState<Record<string, number>>({});
  const addSelectedKind = useMemo(
    () => (presets?.kinds ?? []).find((k) => k.id === addKindId),
    [addKindId, presets?.kinds],
  );
  const editSelectedKind = useMemo(
    () => (presets?.kinds ?? []).find((k) => k.id === editKindId),
    [editKindId, presets?.kinds],
  );

  useEffect(() => {
    setMatColKeys(loadVisibleColKeys(LS_MAT_COLS, MAT_ALL_KEYS, MAT_ALL_KEYS));
  }, []);

  useEffect(() => {
    setInvColKeys(loadVisibleColKeys(LS_INV_COLS, INV_ALL_KEYS, INV_DEFAULT_KEYS));
  }, []);

  useEffect(() => {
    if (skipMatColPersist.current) {
      skipMatColPersist.current = false;
      return;
    }
    localStorage.setItem(LS_MAT_COLS, JSON.stringify(matColKeys));
  }, [matColKeys]);

  useEffect(() => {
    if (skipInvColPersist.current) {
      skipInvColPersist.current = false;
      return;
    }
    localStorage.setItem(LS_INV_COLS, JSON.stringify(invColKeys));
  }, [invColKeys]);

  const loadPresets = useCallback(async () => {
    try {
      const data = await fetchJson<PresetBundle>("/api/material-presets", {
        credentials: "include",
      });
      setPresets(data);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载物料预设失败");
    }
  }, [message]);

  const loadSuppliers = useCallback(async () => {
    setLoadingSuppliers(true);
    try {
      const data = await fetchJson<{ list: SupplierOpt[] }>("/api/suppliers", {
        credentials: "include",
      });
      setSuppliers(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载供应商失败");
    } finally {
      setLoadingSuppliers(false);
    }
  }, [message]);

  const loadCustomers = useCallback(async () => {
    try {
      const data = await fetchJson<{ list: CustomerOpt[] }>("/api/customers", {
        credentials: "include",
      });
      setCustomers(data.list ?? []);
    } catch (e) {
      // 物料库存页并不依赖客户列表；缺少 customer.view 时静默降级，避免误报“没有操作权限”
      const msg = e instanceof Error ? e.message : "";
      if (!msg.includes("没有操作权限")) {
        message.error(msg || "加载客户失败");
      }
      setCustomers([]);
    }
  }, [message]);

  const loadMaterials = useCallback(async () => {
    setLoadingMat(true);
    try {
      const start = dayjs().startOf("day").toISOString();
      const end = dayjs().endOf("day").toISOString();
      const q = new URLSearchParams({
        createdFrom: start,
        createdTo: end,
      });
      const data = await fetchJson<{ list: MaterialRow[] }>(
        `/api/materials?${q.toString()}`,
        {
          credentials: "include",
        },
      );
      setMaterials(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoadingMat(false);
    }
  }, [message]);

  const buildInventoryQuery = (
    v: Record<string, unknown>,
    deprecatedOnly: boolean,
  ) => {
    const p = new URLSearchParams();
    p.set("deprecated", deprecatedOnly ? "1" : "0");
    if (v.code) p.set("code", String(v.code));
    if (v.name) p.set("name", String(v.name));
    if (v.kindId) p.set("kindId", String(v.kindId));
    if (v.supplierId) p.set("supplierId", String(v.supplierId));
    if (v.purchaseOrderNo) p.set("purchaseOrderNo", String(v.purchaseOrderNo));
    if (v.partDescription) p.set("partDescription", String(v.partDescription));
    if (v.stockMin !== undefined && v.stockMin !== null && v.stockMin !== "") {
      p.set("stockMin", String(v.stockMin));
    }
    if (v.stockMax !== undefined && v.stockMax !== null && v.stockMax !== "") {
      p.set("stockMax", String(v.stockMax));
    }
    const range = v.dateRange as [dayjs.Dayjs, dayjs.Dayjs] | undefined;
    if (range?.[0]) p.set("receivedFrom", range[0].startOf("day").toISOString());
    if (range?.[1]) p.set("receivedTo", range[1].endOf("day").toISOString());
    return p;
  };

  const loadCustomerSupplyCatalog = useCallback(
    async (customerId?: string) => {
      setLoadingCustomerSupplyCatalog(true);
      try {
        const q = new URLSearchParams();
        if (customerId) q.set("customerId", customerId);
        const data = await fetchJson<{
          customers: CustomerOpt[];
          materials: CustomerSupplyMaterialOption[];
          partDescriptionSuggestions?: string[];
        }>(`/api/materials/customer-supply?${q.toString()}`, {
          credentials: "include",
        });
        setCustomers((prev) => (prev.length > 0 ? prev : (data.customers ?? [])));
        setCustomerSupplyCatalog(data.materials ?? []);
        setCustomerSupplyPartDescSuggestions(data.partDescriptionSuggestions ?? []);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载客供料选项失败");
        setCustomerSupplyCatalog([]);
        setCustomerSupplyPartDescSuggestions([]);
      } finally {
        setLoadingCustomerSupplyCatalog(false);
      }
    },
    [message],
  );

  const runCustomerSupplyQuery = useCallback(async () => {
    setLoadingCustomerSupply(true);
    try {
      const formVals = (await customerSupplyQueryForm.validateFields().catch(() => ({}))) as {
        customerId?: string;
        materialId?: string;
        partDescription?: string;
        keyword?: string;
      };
      const q = new URLSearchParams();
      if (formVals.customerId) q.set("customerId", formVals.customerId);
      if (formVals.materialId) q.set("materialId", formVals.materialId);
      const keyword = formVals.keyword?.trim();
      const partDesc = formVals.partDescription?.trim();
      if (keyword) q.set("keyword", keyword);
      if (!keyword && partDesc) q.set("keyword", partDesc);
      const data = await fetchJson<{
        customers: CustomerOpt[];
        materials: CustomerSupplyMaterialOption[];
        partDescriptionSuggestions?: string[];
        list: CustomerSupplyInboundRow[];
      }>(`/api/materials/customer-supply?${q.toString()}`, {
        credentials: "include",
      });
      setCustomers((prev) => (prev.length > 0 ? prev : (data.customers ?? [])));
      setCustomerSupplyQueryResults(data.materials ?? []);
      setCustomerSupplyRows(data.list ?? []);
      setCustomerSupplyInboundMode(false);
      setCustomerSupplySelectedMaterialIds([]);
      setCustomerSupplyInboundQtyByMaterialId({});
    } catch (e) {
      message.error(e instanceof Error ? e.message : "查询失败");
      setCustomerSupplyQueryResults([]);
      setCustomerSupplyRows([]);
    } finally {
      setLoadingCustomerSupply(false);
    }
  }, [customerSupplyQueryForm, message]);

  const resetCustomerSupplyFilter = useCallback(() => {
    customerSupplyQueryForm.resetFields();
    setCustomerSupplyQueryResults([]);
    setCustomerSupplyRows([]);
    setCustomerSupplyInboundMode(false);
    setCustomerSupplySelectedMaterialIds([]);
    setCustomerSupplyInboundQtyByMaterialId({});
    void loadCustomerSupplyCatalog();
  }, [customerSupplyQueryForm, loadCustomerSupplyCatalog]);

  const loadInventory = useCallback(
    async (
      override?: Record<string, unknown>,
      opts?: { deprecatedOnly?: boolean },
    ) => {
      setLoadingInv(true);
      try {
        const v = override ?? (await filterForm.validateFields().catch(() => ({})));
        const deprecatedOnly = opts?.deprecatedOnly ?? tab === "deprecated";
        const q = buildInventoryQuery(v as Record<string, unknown>, deprecatedOnly);
        const data = await fetchJson<{ list: InventoryRow[] }>(
          `/api/materials/inventory?${q.toString()}`,
          { credentials: "include" },
        );
        setInventory(data.list ?? []);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "查询失败");
      } finally {
        setLoadingInv(false);
      }
    },
    [filterForm, message, tab],
  );

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  useEffect(() => {
    if (tab === "inventory" || tab === "stockAdjust" || tab === "deprecated") {
      void loadInventory({}, { deprecatedOnly: tab === "deprecated" });
    }
    if (tab === "customerSupply") {
      void loadCustomers();
      setCustomerSupplyQueryResults([]);
      setCustomerSupplyRows([]);
      void loadCustomerSupplyCatalog();
    }
  }, [tab, loadInventory, loadCustomerSupplyCatalog, loadCustomers]);

  useEffect(() => {
    if (tab !== "customerSupply") return;
    const t = window.setTimeout(() => {
      customerSupplyBatchForm.setFieldsValue({
        receivedAt: dayjs(),
        remark: "",
      });
    }, 0);
    return () => window.clearTimeout(t);
  }, [tab, customerSupplyBatchForm]);

  const uploadSample = async (
    file: File,
    opts: { code: string; existingUrls: string[] },
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("code", opts.code);
    fd.append("existingUrls", JSON.stringify(opts.existingUrls ?? []));
    const data = await fetchJson<{ url: string }>("/api/upload/material-sample", {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    return data.url;
  };

  const previewImageInNewTab = useCallback(
    (url?: string) => {
      if (!url) {
        message.warning("请先上传图片");
        return;
      }
      const normalized = /^https?:\/\//i.test(url)
        ? url
        : `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
      window.open(normalized, "_blank", "noopener,noreferrer");
    },
    [message],
  );

  const addUploadProps: UploadProps = useMemo(
    () => ({
      listType: "picture-card",
      accept: "image/jpeg,image/bmp",
      maxCount: 3,
      fileList: sampleUrls.map((url, i) => ({
        uid: `${url}-${i}`,
        name: `签样${i + 1}`,
        status: "done",
        url,
      })),
      beforeUpload: (file) => {
        if (sampleUrls.length >= 3) return Upload.LIST_IGNORE;
        const t = file.type;
        if (t !== "image/jpeg" && t !== "image/bmp") {
          message.error("仅支持 JPEG、BMP");
          return Upload.LIST_IGNORE;
        }
        return true;
      },
      customRequest: async ({ file, onError, onSuccess }) => {
        try {
          const addCode = String(addForm.getFieldValue("code") ?? "").trim();
          if (!addCode) {
            throw new Error("请先保存物料后，在“修改物料”中按物料编号上传图片");
          }
          const url = await uploadSample(file as File, {
            code: addCode,
            existingUrls: sampleUrls,
          });
          setSampleUrls((prev) => [...prev, url].slice(0, 3));
          onSuccess?.(url);
        } catch (e) {
          message.error(e instanceof Error ? e.message : "上传失败");
          onError?.(e as Error);
        }
      },
      onRemove: (file) => {
        const u = file.url;
        if (u) setSampleUrls((prev) => prev.filter((x) => x !== u));
      },
    }),
    [sampleUrls, message, addForm],
  );

  const closeAddModal = () => {
    setAddOpen(false);
    addForm.resetFields();
    setSampleUrls([]);
  };

  const openCreateMaterial = () => {
    void loadCustomers();
    setSampleUrls([]);
    const defUnit =
      presets?.units.find((u) => u.isDefault)?.name ??
      presets?.units.find((u) => u.name === "PCS")?.name ??
      "PCS";
    addFormFieldsPendingRef.current = {
      unit: defUnit,
      unitPrice: 0,
      safetyStock: 0,
      maxStock: 0,
      isCustomerSupplied: false,
      isPcbPurchase: false,
    };
    setAddOpen(true);
  };

  const downloadImportTemplate = async () => {
    try {
      const res = await fetch("/api/materials/import-template", {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          typeof err.error === "string" ? err.error : "下载失败",
        );
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "物料导入模板.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      message.success("模板已下载");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "下载失败");
    }
  };

  const openImportModal = () => {
    setImportFile(null);
    setImportOpen(true);
  };

  const closeImportModal = () => {
    setImportOpen(false);
    setImportFile(null);
  };

  const submitImport = async () => {
    if (!importFile) {
      message.error("请选择 Excel 文件");
      return;
    }
    setImportSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      const res = await fetch("/api/materials/import", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const data = (await res.json()) as {
        error?: string;
        message?: string;
        created?: number;
        validationErrors?: { row: number; message: string }[];
        failed?: { row: number; message: string }[];
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "导入失败",
        );
      }
      const ve = data.validationErrors ?? [];
      const fe = data.failed ?? [];
      if (ve.length === 0 && fe.length === 0) {
        message.success(data.message ?? `成功导入 ${data.created ?? 0} 条`);
      } else {
        const lines = [
          data.message ?? "",
          ...ve.map((x) => `第 ${x.row} 行：${x.message}`),
          ...fe.map((x) => `第 ${x.row} 行：${x.message}`),
        ].filter(Boolean);
        Modal.warning({
          title: "导入结果",
          width: 520,
          content: (
            <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
              {lines.join("\n")}
            </Typography.Paragraph>
          ),
        });
      }
      closeImportModal();
      await loadMaterials();
      await loadInventory({}, { deprecatedOnly: tab === "deprecated" });
      await loadPresets();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImportSubmitting(false);
    }
  };

  const submitAdd = async () => {
    let v: Record<string, unknown>;
    try {
      v = await addForm.validateFields();
    } catch {
      return;
    }
    try {
      await fetchJson<{ id: string }>("/api/materials", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...v,
          sampleImageUrls: sampleUrls,
        }),
      });
      message.success("物料已保存");
      closeAddModal();
      await loadMaterials();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    }
  };

  const openEdit = async (id: string) => {
    void loadCustomers();
    setEditingId(id);
    try {
      const d = await fetchJson<DetailPayload>(`/api/materials/${id}`, {
        credentials: "include",
      });
      const matchedPresetNameId = (presets?.names ?? []).find(
        (n) => n.name.trim() === d.name.trim(),
      )?.id;
      editFormFieldsPendingRef.current = {
        name: d.name,
        presetNameId: matchedPresetNameId,
        customName: d.name,
        customNamePrefix: inferCustomNamePrefixFromCode(d.code),
        partDescription: d.partDescription,
        brand: d.brand,
        unit: d.unit,
        unitPrice: Number(d.unitPrice),
        safetyStock: d.safetyStock ?? 0,
        maxStock: d.maxStock ?? 0,
        isCustomerSupplied: d.isCustomerSupplied,
        isPcbPurchase: Boolean(d.isPcbPurchase),
        customerId: d.customer?.id,
        kindId: d.kindId ?? undefined,
        supplierId: d.isCustomerSupplied ? undefined : d.supplier.id,
        inspectionNotes: d.inspectionNotes,
      };
      setEditSamples(d.sampleImageUrls);
      setEditingMaterialInfo({
        isDeprecated: d.isDeprecated,
        code: d.code,
        name: d.name,
      });
      setEditOpen(true);
    } catch (e) {
      editFormFieldsPendingRef.current = null;
      setEditingId(null);
      setEditingMaterialInfo(null);
      message.error(e instanceof Error ? e.message : "加载失败");
    }
  };

  const editUploadProps: UploadProps = useMemo(
    () => ({
      listType: "picture-card",
      accept: "image/jpeg,image/bmp",
      maxCount: 3,
      fileList: editSamples.map((url, i) => ({
        uid: `${url}-e-${i}`,
        name: `签样${i + 1}`,
        status: "done",
        url,
      })),
      beforeUpload: (file) => {
        if (editSamples.length >= 3) return Upload.LIST_IGNORE;
        const t = file.type;
        if (t !== "image/jpeg" && t !== "image/bmp") {
          message.error("仅支持 JPEG、BMP");
          return Upload.LIST_IGNORE;
        }
        return true;
      },
      customRequest: async ({ file, onError, onSuccess }) => {
        try {
          const editCode = editingMaterialInfo?.code?.trim() ?? "";
          if (!editCode) {
            throw new Error("缺少物料编号，无法上传");
          }
          const url = await uploadSample(file as File, {
            code: editCode,
            existingUrls: editSamples,
          });
          setEditSamples((prev) => [...prev, url].slice(0, 3));
          onSuccess?.(url);
        } catch (e) {
          message.error(e instanceof Error ? e.message : "上传失败");
          onError?.(e as Error);
        }
      },
      onRemove: (file) => {
        const u = file.url;
        if (u) setEditSamples((prev) => prev.filter((x) => x !== u));
      },
    }),
    [editSamples, message, editingMaterialInfo],
  );

  const submitEdit = async () => {
    const v = await editForm.validateFields();
    if (!editingId) return;
    const selectedKind = (presets?.kinds ?? []).find((k) => k.id === v.kindId);
    let resolvedName = String(v.name ?? "").trim();
    if (selectedKind?.namingMode === "CUSTOM") {
      resolvedName = String(v.customName ?? "").trim();
      if (!resolvedName) {
        message.error("请填写物料名称");
        return;
      }
    } else {
      const presetNameId = String(v.presetNameId ?? "").trim();
      if (presetNameId) {
        const p = (presets?.names ?? []).find((n) => n.id === presetNameId);
        if (!p) {
          message.error("所选物料名称无效，请重新选择");
          return;
        }
        resolvedName = p.name;
      } else if (!resolvedName) {
        message.error("请选择物料名称");
        return;
      }
    }
    const savedId = editingId;
    try {
      await fetchJson(`/api/materials/${savedId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...v,
          name: resolvedName,
          sampleImageUrls: editSamples,
        }),
      });
      message.success("已保存");
      setEditOpen(false);
      setEditingId(null);
      setEditingMaterialInfo(null);
      await loadMaterials();
      await loadInventory({}, { deprecatedOnly: tab === "deprecated" });
      if (detail?.id === savedId) {
        void openDetail(savedId);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  const onDelete = (r: MaterialRow) => {
    modal.confirm({
      title: "确认删除该物料？将同时删除其入库记录。",
      okType: "danger",
      onOk: async () => {
        try {
          await fetchJson(`/api/materials/${r.id}`, {
            method: "DELETE",
            credentials: "include",
          });
        } catch (e) {
          message.error(e instanceof Error ? e.message : "删除失败");
          return;
        }
        message.success("已删除");
        await loadMaterials();
        await loadInventory({}, { deprecatedOnly: tab === "deprecated" });
      },
    });
  };

  const deprecateFromEdit = () => {
    if (!editingId || !editingMaterialInfo) return;
    modal.confirm({
      title: `确认弃用物料「${editingMaterialInfo.code} ${editingMaterialInfo.name}」？`,
      content:
        "弃用后该物料将不再出现在常规物料列表，可在「弃用旧料查询」中查看。",
      okType: "danger",
      okText: "确认弃用",
      onOk: async () => {
        setDeprecating(true);
        try {
          await fetchJson(`/api/materials/${editingId}/deprecate`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          message.success("已弃用");
          setEditOpen(false);
          setEditingId(null);
          setEditingMaterialInfo(null);
          await loadMaterials();
          await loadInventory({}, { deprecatedOnly: tab === "deprecated" });
        } catch (e) {
          message.error(e instanceof Error ? e.message : "弃用失败");
        } finally {
          setDeprecating(false);
        }
      },
    });
  };

  const deleteFromEdit = () => {
    if (!editingId || !editingMaterialInfo) return;
    modal.confirm({
      title: `确认删除物料「${editingMaterialInfo.code} ${editingMaterialInfo.name}」？`,
      content: "删除会同时删除其入库记录；若已被业务数据引用，请改为弃用。",
      okType: "danger",
      okText: "确认删除",
      onOk: async () => {
        setDeletingFromEdit(true);
        try {
          await fetchJson(`/api/materials/${editingId}`, {
            method: "DELETE",
            credentials: "include",
          });
          message.success("已删除");
          setEditOpen(false);
          setEditingId(null);
          setEditingMaterialInfo(null);
          await loadMaterials();
          await loadInventory({}, { deprecatedOnly: tab === "deprecated" });
        } catch (e) {
          message.error(e instanceof Error ? e.message : "删除失败");
        } finally {
          setDeletingFromEdit(false);
        }
      },
    });
  };

  const openDetail = useCallback(async (id: string) => {
    setDetailOpen(true);
    setDetail(null);
    setLoadingDetail(true);
    try {
      const data = await fetchJson<DetailPayload>(`/api/materials/${id}`, {
        credentials: "include",
      });
      setDetail(data);
      // 同步列表中的库存数量，避免详情刷新后列表仍显示旧值
      setMaterials((prev) =>
        prev.map((row) =>
          row.id === data.id ? { ...row, totalQty: data.totalQty } : row,
        ),
      );
      setInventory((prev) =>
        prev.map((row) =>
          row.id === data.id ? { ...row, totalQty: data.totalQty } : row,
        ),
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoadingDetail(false);
    }
  }, [message]);

  const exportInboundExcel = useCallback(async () => {
    if (!detail) return;
    try {
      const XLSX = await import("xlsx");
      const opLabel = (r: InboundRow) =>
        r.operatorName
          ? r.operatorEmployeeNo
            ? `${r.operatorName}（${r.operatorEmployeeNo}）`
            : r.operatorName
          : "";
      const rows = detail.inbounds.map((r) => ({
        类型: materialInboundTypeLabel(r),
        数量: r.quantity,
        时间: dayjs(r.receivedAt).format("YYYY-MM-DD HH:mm:ss"),
        采购订单编号: r.purchaseOrderNo ?? "",
        操作员: opLabel(r),
        "备注/部件描述": r.partDescription ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "入库记录");
      const fname = `${detail.code}_入库记录_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`;
      XLSX.writeFile(wb, fname.replace(/[/\\?%*:|"<>]/g, "-"));
      message.success("已导出");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    }
  }, [detail, message]);

  const detailMaterialIdQ = searchParams.get("detailMaterialId");
  useEffect(() => {
    if (!detailMaterialIdQ) return;
    let cancelled = false;
    void (async () => {
      await openDetail(detailMaterialIdQ);
      if (!cancelled) router.replace(pathname, { scroll: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [detailMaterialIdQ, openDetail, pathname, router]);

  const renderSampleThumbs = (urls: string[]) => {
    if (!urls.length) return "—";
    return (
      <Image.PreviewGroup>
        <Space size={4} wrap>
          {urls.map((u) => (
            <Image
              key={u}
              src={u}
              alt=""
              width={40}
              height={40}
              style={{ objectFit: "cover", borderRadius: 4, cursor: "pointer" }}
            />
          ))}
        </Space>
      </Image.PreviewGroup>
    );
  };

  const matColumns: ColumnsType<MaterialRow> = [
    { key: "code", title: "物料编号", dataIndex: "code", ellipsis: true },
    {
      key: "name",
      title: "物料名称",
      dataIndex: "name",
      ellipsis: true,
    },
    {
      key: "kind",
      title: "种类",
      dataIndex: "kindName",
      ellipsis: true,
    },
    {
      key: "brand",
      title: "品牌",
      dataIndex: "brand",
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      key: "partDescription",
      title: "部件描述",
      dataIndex: "partDescription",
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      key: "sampleImages",
      title: "物料图片",
      dataIndex: "sampleImageUrls",
      render: (urls: string[]) => renderSampleThumbs(urls ?? []),
    },
    {
      key: "inspectionNotes",
      title: "检料注意事项",
      dataIndex: "inspectionNotes",
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      key: "createdAt",
      title: "建档日期",
      dataIndex: "createdAt",
      render: (t: string) => dayjs(t).format("YYYY-MM-DD HH:mm"),
    },
    {
      key: "supplier",
      title: "供应商",
      ellipsis: true,
      render: (_, r) =>
        r.isCustomerSupplied
          ? `客供：${r.customer?.name ?? "未设置客户"}`
          : r.supplier.name,
    },
    {
      key: "totalQty",
      title: "库存数量",
      dataIndex: "totalQty",
      render: (v: number, r) => {
        const safety = r.safetyStock ?? 0;
        const max = r.maxStock ?? 0;
        if (safety > 0 && v < safety) {
          return <Typography.Text type="danger">{v}</Typography.Text>;
        }
        if (max > 0 && v > max) {
          return <Typography.Text style={{ color: "#389e0d" }}>{v}</Typography.Text>;
        }
        return v;
      },
    },
    {
      title: "操作",
      key: "op",
      render: (_, r) => (
        <Space wrap>
          <Button type="link" size="small" onClick={() => void openEdit(r.id)}>
            编辑
          </Button>
          <Button type="link" size="small" danger onClick={() => onDelete(r)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const visibleMatColumns = matColumns.filter(
    (col) =>
      col.key === "op" ||
      (typeof col.key === "string" && matColKeys.includes(col.key)),
  );

  const invColumns: ColumnsType<InventoryRow> = [
    { key: "code", title: "物料编号", dataIndex: "code", ellipsis: true },
    {
      key: "name",
      title: "物料名称",
      dataIndex: "name",
      ellipsis: true,
    },
    {
      key: "kind",
      title: "种类",
      dataIndex: "kindName",
      ellipsis: true,
    },
    {
      key: "partDescription",
      title: "部件描述",
      dataIndex: "partDescription",
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      key: "sampleImages",
      title: "物料图片",
      dataIndex: "sampleImageUrls",
      render: (urls: string[]) => renderSampleThumbs(urls ?? []),
    },
    {
      key: "inspectionNotes",
      title: "检料注意事项",
      dataIndex: "inspectionNotes",
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      key: "createdAt",
      title: "建档日期",
      dataIndex: "createdAt",
      render: (t: string) => dayjs(t).format("YYYY-MM-DD HH:mm"),
    },
    {
      key: "supplier",
      title: "供应商",
      ellipsis: true,
      render: (_, r) =>
        r.isCustomerSupplied
          ? `客供：${r.customer?.name ?? "未设置客户"}`
          : r.supplier.name,
    },
    {
      key: "totalQty",
      title: "库存数量",
      dataIndex: "totalQty",
      render: (v: number, r) => {
        const safety = r.safetyStock ?? 0;
        const max = r.maxStock ?? 0;
        if (safety > 0 && v < safety) {
          return <Typography.Text type="danger">{v}</Typography.Text>;
        }
        if (max > 0 && v > max) {
          return <Typography.Text style={{ color: "#389e0d" }}>{v}</Typography.Text>;
        }
        return v;
      },
    },
    {
      key: "lastReceivedAt",
      title: "最近入库",
      dataIndex: "lastReceivedAt",
      render: (t: string | null) =>
        t ? dayjs(t).format("YYYY-MM-DD HH:mm") : "—",
    },
    {
      title: "操作",
      key: "d",
      render: (_, r) => (
        <Button type="link" size="small" onClick={() => void openDetail(r.id)}>
          详情
        </Button>
      ),
    },
  ];

  const visibleInvColumns = invColumns.filter(
    (col) =>
      col.key === "d" ||
      (typeof col.key === "string" && invColKeys.includes(col.key)),
  );

  const matTableColumns = attachResize(
    visibleMatColumns,
    matColWidths,
    setMatColWidths,
    DEFAULT_MAT_COL_WIDTH,
  );

  const invTableColumns = attachResize(
    visibleInvColumns,
    invColWidths,
    setInvColWidths,
    DEFAULT_INV_COL_WIDTH,
  );

  const exportInventoryExcel = useCallback(async () => {
    if (inventory.length === 0) {
      message.warning("当前无数据可导出");
      return;
    }
    const XLSX = await import("xlsx");
    const rows = inventory.map((r) => ({
      物料编号: r.code,
      物料名称: r.name,
      物料种类: r.kindName,
      部件描述: r.partDescription ?? "",
      品牌: r.brand ?? "",
      检料注意事项: r.inspectionNotes ?? "",
      建档日期: dayjs(r.createdAt).format("YYYY-MM-DD HH:mm:ss"),
      供应来源: r.isCustomerSupplied ? "客供" : "自购",
      客供客户: r.isCustomerSupplied
        ? `${r.customer?.code ?? ""} ${r.customer?.name ?? ""}`.trim()
        : "",
      供应商编号: r.isCustomerSupplied ? "" : r.supplier.code,
      供应商名称: r.isCustomerSupplied ? "" : r.supplier.name,
      单位: r.unit,
      单价: r.unitPrice,
      库存数量: r.totalQty,
      最近入库: r.lastReceivedAt
        ? dayjs(r.lastReceivedAt).format("YYYY-MM-DD HH:mm:ss")
        : "",
      物料图片链接: (r.sampleImageUrls ?? []).join("；"),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "物料库存");
    XLSX.writeFile(wb, `物料库存_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`);
    message.success("已导出");
  }, [inventory, message]);

  const customerSupplyFilterMaterialOptions = useMemo(
    () =>
      customerSupplyCatalog.map((m) => ({
        value: m.id,
        label: `${m.code} ${m.name}`,
      })),
    [customerSupplyCatalog],
  );

  const customerSupplyPartDescAutoOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of customerSupplyPartDescSuggestions) {
      if (s.trim()) set.add(s.trim());
    }
    for (const m of customerSupplyCatalog) {
      if (m.partDescription?.trim()) set.add(m.partDescription.trim());
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "zh-CN"))
      .map((value) => ({ value, label: value }));
  }, [customerSupplyCatalog, customerSupplyPartDescSuggestions]);

  const showInventoryFilter =
    tab === "inventory" || tab === "stockAdjust" || tab === "deprecated";

  const usedByProductUniqueCount = useMemo(() => {
    if (!detail?.usedByProducts?.length) return 0;
    return new Set(detail.usedByProducts.map((r) => r.productId)).size;
  }, [detail?.usedByProducts]);

  const usedByProductColumns: ColumnsType<UsedByProductRow> = useMemo(
    () => [
      {
        title: "客户",
        key: "customer",
        width: 140,
        ellipsis: true,
        render: (_, r) => `${r.customer.code} ${r.customer.name}`.trim(),
      },
      {
        title: "客户料号",
        dataIndex: "customerMaterialCode",
        width: 120,
        ellipsis: true,
        render: (t: string) => t?.trim() || "—",
      },
      {
        title: "商品型号",
        dataIndex: "model",
        width: 140,
        ellipsis: true,
        render: (t: string, r) => {
          const text = t?.trim() || "—";
          if (!r.isDeprecated) return text;
          return (
            <Typography.Text type="secondary">{text}（已弃用）</Typography.Text>
          );
        },
      },
      {
        title: "加工方式",
        key: "mode",
        width: 108,
        render: (_, r) => productProcessingModeLabel(r.processingMode),
      },
      {
        title: "BOM归属",
        key: "scope",
        width: 88,
        render: (_, r) => productBomScopeLabel(r.scope, r.processingMode),
      },
      {
        title: "用量",
        dataIndex: "usageQty",
        width: 80,
        align: "right",
      },
      {
        title: "单位",
        dataIndex: "unit",
        width: 56,
      },
      {
        title: "操作",
        key: "op",
        width: 88,
        render: (_, r) => (
          <Link
            href={`/dashboard/products?detailProductId=${encodeURIComponent(r.productId)}`}
          >
            查看商品
          </Link>
        ),
      },
    ],
    [],
  );

  const openStockAdjust = (r: InventoryRow) => {
    setStockAdjustTarget(r);
    stockAdjustForm.resetFields();
    setStockAdjustOpen(true);
  };

  const stockAdjustTableColumns = attachResize<InventoryRow>(
    [
      { title: "物料编号", dataIndex: "code", key: "code", ellipsis: true },
      { title: "物料名称", dataIndex: "name", key: "name", ellipsis: true },
      { title: "种类", dataIndex: "kindName", key: "kind", ellipsis: true },
      {
        title: "部件描述",
        dataIndex: "partDescription",
        key: "partDescription",
        ellipsis: true,
        render: (v: string | null) => v ?? "—",
      },
      { title: "当前库存", dataIndex: "totalQty", key: "q", align: "right" as const },
      {
        title: "操作",
        key: "op",
        render: (_, r) => (
          <Space size={0} wrap>
            <Button type="link" size="small" onClick={() => openStockAdjust(r)}>
              调整
            </Button>
            <Button type="link" size="small" onClick={() => void openEdit(r.id)}>
              修改物料
            </Button>
          </Space>
        ),
      },
    ],
    matAdjColWidths,
    setMatAdjColWidths,
    DEFAULT_MAT_ADJ_COL_WIDTH,
  );

  const submitStockAdjust = async () => {
    if (!stockAdjustTarget) return;
    let v: { delta: number; remark?: string };
    try {
      v = await stockAdjustForm.validateFields();
    } catch {
      return;
    }
    setStockAdjustSubmitting(true);
    try {
      await fetchJson(`/api/materials/${stockAdjustTarget.id}/stock-adjust`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delta: v.delta,
          remark: v.remark?.trim() || null,
        }),
      });
      message.success("库存已按盘点结果调整");
      const matId = stockAdjustTarget.id;
      setStockAdjustOpen(false);
      setStockAdjustTarget(null);
      await loadInventory(
        (await filterForm.validateFields().catch(() => ({}))) as Record<string, unknown>,
        { deprecatedOnly: tab === "deprecated" },
      );
      if (detail?.id === matId) {
        void openDetail(matId);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "调整失败");
    } finally {
      setStockAdjustSubmitting(false);
    }
  };

  const submitCustomerSupplyInbound = useCallback(async (materialIds: string[]) => {
    if (materialIds.length === 0) {
      message.warning("请先勾选需要入库的物料");
      return;
    }
    let formVals: { receivedAt: dayjs.Dayjs; remark?: string };
    try {
      formVals = await customerSupplyBatchForm.validateFields();
    } catch {
      return;
    }
    const payloads: {
      customerId: string;
      materialId: string;
      quantity: number;
      partDescription: string | null;
    }[] = [];
    for (const materialId of materialIds) {
      const qty = Math.trunc(Number(customerSupplyInboundQtyByMaterialId[materialId] ?? 0));
      if (!Number.isFinite(qty) || qty < 1) {
        message.warning("勾选的物料请填写大于 0 的入库数量");
        return;
      }
      const m = customerSupplyQueryResults.find((x) => x.id === materialId);
      if (!m?.customerId) {
        message.error("存在未绑定客供客户的物料，无法入库");
        return;
      }
      payloads.push({
        customerId: m.customerId,
        materialId: m.id,
        quantity: qty,
        partDescription: m.partDescription?.trim() || null,
      });
    }
    setSubmittingCustomerSupply(true);
    try {
      for (const p of payloads) {
        await fetchJson("/api/materials/customer-supply", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: p.customerId,
            materialId: p.materialId,
            quantity: p.quantity,
            receivedAt: formVals.receivedAt?.toISOString(),
            partDescription: p.partDescription,
            remark: formVals.remark?.trim() || null,
          }),
        });
      }
      message.success(`已完成 ${payloads.length} 条客供料入库`);
      setCustomerSupplySelectedMaterialIds((prev) =>
        prev.filter((id) => !materialIds.includes(id)),
      );
      setCustomerSupplyInboundQtyByMaterialId((prev) => {
        const next = { ...prev };
        for (const id of materialIds) delete next[id];
        return next;
      });
      await runCustomerSupplyQuery();
      const customerId = customerSupplyQueryForm.getFieldValue("customerId") as
        | string
        | undefined;
      void loadCustomerSupplyCatalog(customerId);
      if (tab === "inventory" || tab === "stockAdjust" || tab === "deprecated") {
        await loadInventory(
          filterForm.getFieldsValue() as Record<string, unknown>,
          { deprecatedOnly: tab === "deprecated" },
        );
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "客供料入库失败");
    } finally {
      setSubmittingCustomerSupply(false);
    }
  }, [
    customerSupplyBatchForm,
    customerSupplyInboundQtyByMaterialId,
    customerSupplyQueryResults,
    customerSupplyQueryForm,
    loadCustomerSupplyCatalog,
    runCustomerSupplyQuery,
    loadInventory,
    filterForm,
    message,
    tab,
  ]);

  const { loading: tabPermLoading, allowed } = useMeTabPermissions();

  const visibleMaterialTabKeys = useMemo(
    () =>
      (["add", "inventory", "customerSupply", "stockAdjust", "deprecated", "settings"] as const).filter((k) =>
        allowed([MATERIAL_TAB_PERM[k]]),
      ),
    [allowed],
  );

  useEffect(() => {
    if (tabPermLoading) return;
    if (visibleMaterialTabKeys.length === 0) return;
    const keys = visibleMaterialTabKeys as readonly string[];
    if (!keys.includes(tab)) {
      setTab(keys[0] ?? "add");
    }
  }, [tabPermLoading, visibleMaterialTabKeys, tab]);

  return (
    <Card title="物料信息">
      {tabPermLoading ? (
        <div style={{ padding: 56, textAlign: "center" }}>
          <Spin size="large" />
        </div>
      ) : visibleMaterialTabKeys.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          当前账号无可用的物料信息 TAB，请联系管理员在「员工管理 → 权限管理」中勾选对应 TAB。
        </Typography.Paragraph>
      ) : (
        <>
      {showInventoryFilter ? (
        <Form
          form={filterForm}
          layout="inline"
          style={{ marginBottom: 16, rowGap: 12 }}
          onFinish={(v) =>
            void loadInventory(v as Record<string, unknown>, {
              deprecatedOnly: tab === "deprecated",
            })
          }
        >
          <Form.Item name="dateRange" label="入库时间">
            <DatePicker.RangePicker />
          </Form.Item>
          <Form.Item name="purchaseOrderNo" label="采购订单编号">
            <Input allowClear placeholder="模糊" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="code" label="物料编号">
            <Input allowClear placeholder="模糊" style={{ width: 140 }} autoComplete="off" spellCheck={false} />
          </Form.Item>
          <Form.Item name="name" label="物料名称">
            <AutoComplete
              allowClear
              style={{ width: 160 }}
              options={(presets?.names ?? []).map((n) => ({
                value: n.name,
                label: n.name,
              }))}
              filterOption={(inputValue, option) =>
                String(option?.value ?? "")
                  .toLowerCase()
                  .includes(String(inputValue ?? "").trim().toLowerCase())
              }
            >
              <Input placeholder="模糊或选预设名称" autoComplete="off" spellCheck={false} />
            </AutoComplete>
          </Form.Item>
          <Form.Item name="kindId" label="物料种类">
            <Select
              allowClear
              placeholder="全部"
              style={{ width: 140 }}
              options={(presets?.kinds ?? []).map((k) => ({
                value: k.id,
                label: k.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="supplierId" label="供应商">
            <Select
              allowClear
              placeholder="全部"
              showSearch
              loading={loadingSuppliers}
              optionFilterProp="searchText"
              style={{ width: 200 }}
              options={suppliers.map((s) => ({
                value: s.id,
                label: `${s.name}${s.code ? `（${s.code}）` : ""}`,
                searchText: `${s.code} ${s.name} ${s.shortName ?? ""}`.toLowerCase(),
              }))}
            />
          </Form.Item>
          <Form.Item name="partDescription" label="部件描述">
            <Input
              allowClear
              placeholder="按档案部件描述，模糊"
              style={{ width: 160 }}
              autoComplete="off"
              spellCheck={false}
            />
          </Form.Item>
          <Form.Item label="库存数量">
            <Space>
              <Form.Item name="stockMin" noStyle>
                <InputNumber min={0} placeholder="最小" />
              </Form.Item>
              <span>—</span>
              <Form.Item name="stockMax" noStyle>
                <InputNumber min={0} placeholder="最大" />
              </Form.Item>
            </Space>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">
              查询
            </Button>
          </Form.Item>
          <Form.Item>
            <Button
              onClick={() => {
                filterForm.resetFields();
                  void loadInventory({}, { deprecatedOnly: tab === "deprecated" });
              }}
            >
              重置
            </Button>
          </Form.Item>
        </Form>
      ) : null}
      <Tabs
        activeKey={tab}
        destroyOnHidden
        onChange={(k) => {
          setTab(k);
          if (k === "add" || k === "inventory" || k === "stockAdjust") void loadPresets();
          if (k === "customerSupply") {
            setCustomerSupplyQueryResults([]);
            setCustomerSupplyRows([]);
            void loadCustomerSupplyCatalog();
          }
        }}
        items={[
          {
            key: "add",
            label: "新增物料",
            children: (
              <Space direction="vertical" size="large" style={{ width: "100%" }}>
                <Space style={{ marginBottom: 0 }} wrap>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={openCreateMaterial}
                  >
                    新增物料
                  </Button>
                  <Button icon={<DownloadOutlined />} onClick={() => void downloadImportTemplate()}>
                    下载导入模板
                  </Button>
                  <Button icon={<FileExcelOutlined />} onClick={openImportModal}>
                    Excel 导入
                  </Button>
                </Space>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    width: "100%",
                  }}
                >
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    已建档物料（当日）
                  </Typography.Title>
                  <Space size={8}>
                    <ColumnSettingButton
                      options={MAT_COL_OPTIONS}
                      value={matColKeys}
                      onChange={setMatColKeys}
                    />
                    <HelpTip text="下方列表仅显示当天新建的物料档案；物料编号与建档日期保存时自动生成（种类前缀-名称前缀-序号）。收料入库请在采购订单中操作。Excel 导入：供应商列填系统内编号或名称；标准种类「物料名称」须与物料设置中的名称预设一致；自定义种类须另填「名称前缀」列。" />
                  </Space>
                </div>
                <Table<MaterialRow>
                  rowKey="id"
                  loading={loadingMat}
                  columns={matTableColumns}
                  dataSource={materials}
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
            key: "inventory",
            label: "物料库存",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    width: "100%",
                  }}
                >
                  <ColumnSettingButton
                    options={INV_COL_OPTIONS}
                    value={invColKeys}
                    onChange={setInvColKeys}
                  />
                </div>
                <Table<InventoryRow>
                  rowKey="id"
                  loading={loadingInv}
                  columns={invTableColumns}
                  dataSource={inventory}
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
                <div>
                  <Button
                    icon={<FileExcelOutlined />}
                    onClick={() => void exportInventoryExcel()}
                  >
                    导出 Excel
                  </Button>
                </div>
              </Space>
            ),
          },
          {
            key: "customerSupply",
            label: "客供料入口",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
                  <HelpTip text="仅用于客供料收料入库。采购单不会生成客供料，请在本页登记收料。" />
                </div>
                <Card size="small" title="筛选入库">
                  <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                    <Form form={customerSupplyBatchForm} component={false} />
                    <Form
                      form={customerSupplyQueryForm}
                      layout="inline"
                      style={{ rowGap: 12 }}
                      onFinish={() => void runCustomerSupplyQuery()}
                    >
                      <Form.Item name="customerId" label="客供客户">
                        <Select
                          allowClear
                          showSearch
                          placeholder="全部"
                          optionFilterProp="searchText"
                          style={{ width: 220 }}
                          loading={loadingCustomerSupplyCatalog}
                          options={customers.map((c) => ({
                            value: c.id,
                            label: `${c.name}${c.code ? `（${c.code}）` : ""}`,
                            searchText: `${c.code} ${c.name} ${c.shortName ?? ""}`.toLowerCase(),
                          }))}
                          onChange={(customerId) => {
                            customerSupplyQueryForm.setFieldsValue({
                              materialId: undefined,
                              partDescription: undefined,
                            });
                            void loadCustomerSupplyCatalog(
                              customerId ? String(customerId) : undefined,
                            );
                          }}
                        />
                      </Form.Item>
                      <Form.Item name="materialId" label="客供料">
                        <Select
                          allowClear
                          showSearch
                          placeholder="全部"
                          optionFilterProp="label"
                          style={{ width: 260 }}
                          loading={loadingCustomerSupplyCatalog}
                          options={customerSupplyFilterMaterialOptions}
                        />
                      </Form.Item>
                      <Form.Item name="partDescription" label="部件描述">
                        <AutoComplete
                          allowClear
                          style={{ width: 280 }}
                          options={customerSupplyPartDescAutoOptions}
                          filterOption={(inputValue, option) =>
                            String(option?.value ?? "")
                              .toLowerCase()
                              .includes(String(inputValue ?? "").trim().toLowerCase()) ||
                            String(option?.label ?? "")
                              .toLowerCase()
                              .includes(String(inputValue ?? "").trim().toLowerCase())
                          }
                        >
                          <Input placeholder="输入部件描述筛选物料" autoComplete="off" />
                        </AutoComplete>
                      </Form.Item>
                      <Form.Item>
                        <Button type="primary" htmlType="submit">
                          查询
                        </Button>
                      </Form.Item>
                      <Form.Item>
                        <Button onClick={() => resetCustomerSupplyFilter()}>
                          重置
                        </Button>
                      </Form.Item>
                      <Form.Item>
                        <Button
                          type={customerSupplyInboundMode ? "default" : "primary"}
                          onClick={() => {
                            setCustomerSupplyInboundMode((prev) => !prev);
                            if (customerSupplyInboundMode) {
                              setCustomerSupplySelectedMaterialIds([]);
                              setCustomerSupplyInboundQtyByMaterialId({});
                            }
                          }}
                        >
                          入库
                        </Button>
                      </Form.Item>
                    </Form>

                    <Table<CustomerSupplyMaterialOption>
                      rowKey="id"
                      loading={loadingCustomerSupply}
                      dataSource={customerSupplyQueryResults}
                      locale={{ emptyText: "请先设置筛选条件并点击「查询」" }}
                      pagination={{ pageSize: 10 }}
                      rowSelection={
                        customerSupplyInboundMode
                          ? {
                              selectedRowKeys: customerSupplySelectedMaterialIds,
                              onChange: (keys) => {
                                const next = (keys as string[]).map(String);
                                setCustomerSupplySelectedMaterialIds(next);
                                setCustomerSupplyInboundQtyByMaterialId((prev) => {
                                  const keep: Record<string, number> = {};
                                  for (const id of next) {
                                    keep[id] = Math.max(1, Math.trunc(Number(prev[id] ?? 1)));
                                  }
                                  return keep;
                                });
                              },
                            }
                          : undefined
                      }
                      columns={[
                        {
                          title: "客供客户",
                          key: "customer",
                          width: 200,
                          render: (_, r) =>
                            r.customer
                              ? `${r.customer.name}${r.customer.code ? `（${r.customer.code}）` : ""}`
                              : "—",
                        },
                        {
                          title: "客供料",
                          key: "material",
                          width: 260,
                          render: (_, r) => `${r.code} ${r.name}`,
                        },
                        {
                          title: "部件描述",
                          dataIndex: "partDescription",
                          width: 180,
                          ellipsis: true,
                          render: (v: string | null) => v?.trim() || "—",
                        },
                        {
                          title: "入库数量",
                          key: "inboundQty",
                          width: 140,
                          render: (_, r) => {
                            const checked = customerSupplySelectedMaterialIds.includes(r.id);
                            if (!customerSupplyInboundMode || !checked) return "—";
                            return (
                              <InputNumber
                                min={1}
                                precision={0}
                                value={customerSupplyInboundQtyByMaterialId[r.id] ?? 1}
                                onChange={(v) => {
                                  const n = Math.max(
                                    1,
                                    Math.trunc(Number(v == null ? 1 : v) || 1),
                                  );
                                  setCustomerSupplyInboundQtyByMaterialId((prev) => ({
                                    ...prev,
                                    [r.id]: n,
                                  }));
                                }}
                              />
                            );
                          },
                        },
                        {
                          title: "操作",
                          key: "op",
                          width: 120,
                          render: (_, r) => {
                            const checked = customerSupplySelectedMaterialIds.includes(r.id);
                            if (!customerSupplyInboundMode || !checked) return "—";
                            return (
                              <Button
                                type="link"
                                size="small"
                                loading={submittingCustomerSupply}
                                onClick={() => void submitCustomerSupplyInbound([r.id])}
                              >
                                完成
                              </Button>
                            );
                          },
                        },
                      ]}
                    />

                    {customerSupplyInboundMode ? (
                      <Form
                        form={customerSupplyBatchForm}
                        layout="inline"
                        style={{ rowGap: 12, paddingTop: 4 }}
                      >
                        <Form.Item
                          name="receivedAt"
                          label="收料时间"
                          rules={[{ required: true, message: "请选择收料时间" }]}
                        >
                          <DatePicker showTime />
                        </Form.Item>
                        <Form.Item name="remark" label="备注">
                          <Input allowClear placeholder="可写来料批次等" style={{ width: 260 }} />
                        </Form.Item>
                        <Form.Item>
                          <Button
                            type="primary"
                            loading={submittingCustomerSupply}
                            onClick={() =>
                              void submitCustomerSupplyInbound(customerSupplySelectedMaterialIds)
                            }
                          >
                            统一完成
                          </Button>
                        </Form.Item>
                      </Form>
                    ) : null}
                  </Space>
                </Card>

                <Card size="small" title="收料记录">
                  <Space style={{ marginBottom: 12 }}>
                    <Button onClick={() => void runCustomerSupplyQuery()}>刷新记录</Button>
                    <Button onClick={() => resetCustomerSupplyFilter()}>清空筛选</Button>
                  </Space>

                  <Table<CustomerSupplyInboundRow>
                    rowKey="id"
                    loading={loadingCustomerSupply}
                    dataSource={customerSupplyRows}
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 980 }}
                    columns={[
                      {
                        title: "收料时间",
                        dataIndex: "receivedAt",
                        width: 160,
                        render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
                      },
                      {
                        title: "客供客户",
                        key: "customer",
                        width: 200,
                        render: (_, r) =>
                          r.customer
                            ? `${r.customer.name}${r.customer.code ? `（${r.customer.code}）` : ""}`
                            : "—",
                      },
                      {
                        title: "客供料",
                        key: "material",
                        width: 260,
                        render: (_, r) => `${r.material.code} ${r.material.name}`,
                      },
                      { title: "数量", dataIndex: "quantity", width: 100, align: "right" as const },
                      {
                        title: "部件描述",
                        dataIndex: "partDescription",
                        key: "partDescription",
                        width: 140,
                        ellipsis: true,
                        render: (v: string | null) => v?.trim() || "—",
                      },
                      {
                        title: "操作员",
                        key: "operator",
                        width: 150,
                        render: (_, row) =>
                          row.operatorName
                            ? row.operatorEmployeeNo
                              ? `${row.operatorName}（${row.operatorEmployeeNo}）`
                              : row.operatorName
                            : "—",
                      },
                      {
                        title: "备注",
                        dataIndex: "remark",
                        ellipsis: true,
                        render: (v: string | null) => v ?? "—",
                      },
                    ]}
                  />
                </Card>
              </Space>
            ),
          },
          {
            key: "stockAdjust",
            label: "手动调整",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
                  <HelpTip text="本页为库存盘点与档案维护入口：可录入与系统当前库存的差额（可增可减，保存后记为盘点调整流水），或打开“修改物料”编辑基础资料与签样。列表与上方查询条件、当前物料库存页数据一致。" />
                </div>
                <Table<InventoryRow>
                  rowKey="id"
                  loading={loadingInv}
                  columns={stockAdjustTableColumns}
                  dataSource={inventory}
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
            key: "deprecated",
            label: "弃用旧料查询",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
                  <HelpTip text="仅展示已弃用物料；用于查询历史旧料及其当前库存。弃用后常规列表不再展示。" />
                </div>
                <Table<InventoryRow>
                  rowKey="id"
                  loading={loadingInv}
                  columns={[
                    { title: "物料编号", dataIndex: "code", key: "code", ellipsis: true, width: 120 },
                    { title: "物料名称", dataIndex: "name", key: "name", ellipsis: true },
                    { title: "种类", dataIndex: "kindName", key: "kind", width: 96, ellipsis: true },
                    {
                      title: "部件描述",
                      dataIndex: "partDescription",
                      key: "partDescription",
                      ellipsis: true,
                      render: (v: string | null) => v ?? "—",
                    },
                    {
                      title: "供应商",
                      key: "supplier",
                      width: 140,
                      ellipsis: true,
                      render: (_, r) =>
                        r.isCustomerSupplied
                          ? `客供：${r.customer?.name ?? "—"}`
                          : (r.supplier?.name ?? "—"),
                    },
                    {
                      title: "当前库存",
                      dataIndex: "totalQty",
                      key: "q",
                      width: 96,
                      align: "right" as const,
                    },
                    {
                      title: "弃用时间",
                      key: "deprecatedAt",
                      width: 160,
                      render: (_, r) =>
                        r.deprecatedAt ? dayjs(r.deprecatedAt).format("YYYY-MM-DD HH:mm") : "—",
                    },
                    {
                      title: "弃用原因",
                      dataIndex: "deprecatedReason",
                      key: "deprecatedReason",
                      ellipsis: true,
                      render: (v: string | null) => v ?? "—",
                    },
                    {
                      title: "操作",
                      key: "op",
                      width: 88,
                      render: (_, r) => (
                        <Button type="link" size="small" onClick={() => void openDetail(r.id)}>
                          详情
                        </Button>
                      ),
                    },
                  ]}
                  dataSource={inventory}
                  pagination={{
                    defaultPageSize: 10,
                    showSizeChanger: true,
                    pageSizeOptions: [10, 20, 50, 100],
                  }}
                  scroll={{ x: 980 }}
                />
              </Space>
            ),
          },
          {
            key: "settings",
            label: "物料设置",
            children: <MaterialSettingsTab />,
          },
        ].filter((item) => {
          const code = MATERIAL_TAB_PERM[String(item.key)];
          return code ? allowed([code]) : false;
        })}
      />
        </>
      )}

      <Modal
        title="Excel 批量导入物料"
        open={importOpen}
        onCancel={closeImportModal}
        onOk={() => void submitImport()}
        confirmLoading={importSubmitting}
        destroyOnHidden
        width={560}
      >
        <div>
          <Typography.Paragraph style={{ marginBottom: 12 }}>
            请选择填写好的 Excel，表头中「供应商」列请填写系统中已存在的<strong>供应商编号</strong>或
            <strong>供应商名称</strong>（每行可不同）。
          </Typography.Paragraph>
          <Upload
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            maxCount={1}
            beforeUpload={(file) => {
              setImportFile(file);
              return false;
            }}
            onRemove={() => setImportFile(null)}
            fileList={
              importFile
                ? [
                    {
                      uid: "import-1",
                      name: importFile.name,
                      status: "done",
                    },
                  ]
                : []
            }
          >
            <Button icon={<UploadOutlined />}>选择文件</Button>
          </Upload>
          <Typography.Paragraph
            type="secondary"
            style={{ marginBottom: 0, marginTop: 8 }}
          >
            表头须包含：物料名称、物料种类、部件描述、品牌、供应商、单位、单价、备注；可选「名称前缀」（自定义名称种类必填）。物料编号按种类与名称前缀自动生成，规则与手动新建一致。「物料种类」须与「物料设置」中的种类名称一致；标准种类「物料名称」须为名称预设中的名称。请先点击「下载导入模板」获取标准表头。
          </Typography.Paragraph>
        </div>
      </Modal>

      <Modal
        title="手动调整库存"
        open={stockAdjustOpen}
        onCancel={() => {
          setStockAdjustOpen(false);
          setStockAdjustTarget(null);
        }}
        onOk={() => void submitStockAdjust()}
        confirmLoading={stockAdjustSubmitting}
        okText="确定调整"
        destroyOnHidden
        width={480}
      >
        {stockAdjustTarget ? (
          <Form form={stockAdjustForm} layout="vertical">
            <Typography.Paragraph>
              {stockAdjustTarget.code} {stockAdjustTarget.name}
            </Typography.Paragraph>
            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
              当前系统库存合计：<strong>{stockAdjustTarget.totalQty}</strong> {stockAdjustTarget.unit}（同物料库存与入库流水汇总规则）
            </Typography.Text>
            <Form.Item
              name="delta"
              label="调整数量"
              extra="正数为增加、负数为减少；保存后 = 原合计 + 本值。不得使库存为负。"
              rules={[
                { required: true, message: "请填写调整数量" },
                {
                  type: "number",
                  transform: (v) => (v === "" || v == null ? undefined : Number(v)),
                },
                {
                  validator: async (_, v) => {
                    if (v == null || Number.isNaN(Number(v))) {
                      return Promise.reject(new Error("须为有效数字"));
                    }
                    const d = Math.trunc(Number(v));
                    if (d === 0) {
                      return Promise.reject(new Error("不能为 0"));
                    }
                    if (stockAdjustTarget.totalQty + d < 0) {
                      return Promise.reject(
                        new Error(
                          `调整后不能为负（当前 ${stockAdjustTarget.totalQty}，最多可减少 ${stockAdjustTarget.totalQty}）`,
                        ),
                      );
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <InputNumber
                style={{ width: "100%" }}
                precision={0}
                step={1}
                placeholder="例如 盘盈填 +5，盘亏填 -3"
              />
            </Form.Item>
            <Form.Item name="remark" label="备注（可选）">
              <Input.TextArea rows={2} placeholder="可注明盘点人、单号等" allowClear maxLength={500} showCount />
            </Form.Item>
          </Form>
        ) : null}
      </Modal>

      <Modal
        title="新增物料"
        open={addOpen}
        onCancel={closeAddModal}
        onOk={() => void submitAdd()}
        width={720}
        destroyOnHidden
        afterOpenChange={(open) => {
          if (open && addFormFieldsPendingRef.current) {
            addForm.resetFields();
            addForm.setFieldsValue(addFormFieldsPendingRef.current);
            addFormFieldsPendingRef.current = null;
          }
        }}
      >
        <Form form={addForm} layout="vertical">
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            标准件：需先维护物料名称预设，编码为「种类前缀-名称前缀-三位序号」（起始 001）；自定义种类：建档时手填名称与名称前缀，编码为「种类前缀-名称前缀-两位序号」（起始 01）。
          </Typography.Paragraph>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="kindId"
                label="物料种类"
                rules={[{ required: true, message: "请选择物料种类" }]}
              >
                <Select
                  placeholder="选择种类"
                  onChange={(kindId) => {
                    const nextKind = (presets?.kinds ?? []).find((k) => k.id === kindId);
                    addForm.setFieldsValue({
                      presetNameId: undefined,
                      customName: undefined,
                      customNamePrefix: undefined,
                      isPcbPurchase: isPcbKindName(nextKind?.name),
                      ...(nextKind?.namingMode !== "CUSTOM" && !addIsCustomerSupplied
                        ? { customerId: undefined }
                        : {}),
                    });
                  }}
                  options={(presets?.kinds ?? []).map((k) => ({
                    value: k.id,
                    label: `${k.name}${k.prefix ? `（前缀 ${k.prefix}）` : ""}${k.namingMode === "CUSTOM" ? " · 自定义" : ""}`,
                  }))}
                />
              </Form.Item>
            </Col>
            {addSelectedKind?.namingMode === "CUSTOM" ? (
              <>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="customName"
                    label="物料名称（自定义）"
                    rules={[{ required: true, message: "请填写物料名称" }]}
                  >
                    <Input allowClear placeholder="如 FPC C62" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="customNamePrefix"
                    label="名称前缀"
                    rules={[{ required: true, message: "请填写名称前缀" }]}
                    extra="编码中的名称段，如 C62（将自动转大写）"
                  >
                    <Input allowClear placeholder="如 C62" />
                  </Form.Item>
                </Col>
                {!addIsCustomerSupplied ? (
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="customerId"
                      label="关联客户"
                      extra="选填，便于后续采购对账等按客户筛选"
                    >
                      <Select
                        allowClear
                        showSearch
                        optionFilterProp="searchText"
                        placeholder="选择关联客户（可选）"
                        options={customers.map((c) => ({
                          value: c.id,
                          label: `${c.name}${c.code ? `（${c.code}）` : ""}`,
                          searchText: `${c.code} ${c.name} ${c.shortName ?? ""}`.toLowerCase(),
                        }))}
                      />
                    </Form.Item>
                  </Col>
                ) : null}
              </>
            ) : (
              <Col xs={24} sm={12}>
                <Form.Item
                  name="presetNameId"
                  label="物料名称"
                  rules={[{ required: true, message: "请选择物料名称" }]}
                >
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="下拉选择或输入关键字筛选"
                    options={(presets?.names ?? []).map((n) => ({
                      value: n.id,
                      label: n.name,
                    }))}
                    filterOption={(input, option) =>
                      String(option?.label ?? "")
                        .toLowerCase()
                        .includes(String(input ?? "").trim().toLowerCase())
                    }
                  />
                </Form.Item>
              </Col>
            )}
            <Col span={24}>
              <Form.Item name="partDescription" label="部件描述">
                <Input.TextArea rows={2} allowClear placeholder="可选" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="brand" label="品牌">
                <Select
                  allowClear
                  placeholder="选择品牌"
                  options={(presets?.brands ?? []).map((b) => ({
                    value: b.name,
                    label: b.name,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="unit"
                label="单位"
                rules={[{ required: true, message: "请选择单位" }]}
              >
                <Select
                  placeholder="单位"
                  options={(presets?.units ?? []).map((u) => ({
                    value: u.name,
                    label: u.isDefault ? `${u.name}（默认）` : u.name,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="isPcbPurchase" valuePropName="checked">
                <Checkbox>属PCB采购（不进入销售拆分采购）</Checkbox>
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="isCustomerSupplied" valuePropName="checked">
                <Checkbox
                  onChange={(e) => {
                    if (e.target.checked) {
                      addForm.setFieldsValue({
                        supplierId: undefined,
                        unitPrice: 0,
                      });
                    } else if (addSelectedKind?.namingMode !== "CUSTOM") {
                      addForm.setFieldsValue({ customerId: undefined });
                    }
                  }}
                >
                  客供料（不参与采购）
                </Checkbox>
              </Form.Item>
            </Col>
            {addIsCustomerSupplied ? (
              <Col xs={24} sm={12}>
                <Form.Item
                  name="customerId"
                  label="客供客户"
                  rules={[{ required: true, message: "请选择客供客户" }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="searchText"
                    placeholder="选择客供客户"
                    options={customers.map((c) => ({
                      value: c.id,
                      label: `${c.name}${c.code ? `（${c.code}）` : ""}`,
                      searchText: `${c.code} ${c.name} ${c.shortName ?? ""}`.toLowerCase(),
                    }))}
                  />
                </Form.Item>
              </Col>
            ) : (
              <>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="unitPrice"
                    label="单价"
                    rules={[{ required: true, message: "请填写单价" }]}
                  >
                    <InputNumber min={0} precision={4} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="supplierId"
                    label="所属供应商"
                    rules={[{ required: true, message: "请选择供应商" }]}
                  >
                    <Select
                      loading={loadingSuppliers}
                      placeholder="选择供应商"
                      options={suppliers.map((s) => ({
                        value: s.id,
                        label: `${s.code} ${s.name}`,
                        searchText: `${s.code} ${s.name} ${s.shortName ?? ""}`.toLowerCase(),
                      }))}
                      showSearch
                      optionFilterProp="searchText"
                    />
                  </Form.Item>
                </Col>
              </>
            )}
            <Col xs={24} sm={12}>
              <Form.Item name="safetyStock" label="安全库存">
                <InputNumber min={0} precision={0} step={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="maxStock" label="最大库存">
                <InputNumber min={0} precision={0} step={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="inspectionNotes" label="检料注意事项">
                <Input.TextArea rows={3} placeholder="可选" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label="签样图片（JPEG / BMP，最多 3 张，点击缩略图可放大）">
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Upload {...addUploadProps}>
                    {sampleUrls.length >= 3 ? null : (
                      <div>
                        <UploadOutlined />
                        <div style={{ marginTop: 8 }}>上传</div>
                      </div>
                    )}
                  </Upload>
                  <Button
                    icon={<EyeOutlined />}
                    onClick={() =>
                      previewImageInNewTab(sampleUrls[sampleUrls.length - 1])
                    }
                    disabled={sampleUrls.length === 0}
                  >
                    预览
                  </Button>
                </Space>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title="编辑物料"
        open={editOpen}
        onCancel={() => {
          setEditOpen(false);
          setEditingId(null);
          setEditingMaterialInfo(null);
        }}
        onOk={() => void submitEdit()}
        okText="保存"
        footer={(_, { OkBtn, CancelBtn }) => (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%",
            }}
          >
            <Space>
              <Button
                danger
                loading={deletingFromEdit}
                onClick={() => deleteFromEdit()}
                disabled={!editingId}
              >
                删除
              </Button>
              <Button
                danger
                loading={deprecating}
                onClick={() => deprecateFromEdit()}
                disabled={!editingId || Boolean(editingMaterialInfo?.isDeprecated)}
              >
                弃用物料
              </Button>
            </Space>
            <Space>
              <CancelBtn />
              <OkBtn />
            </Space>
          </div>
        )}
        width={720}
        destroyOnHidden
        afterOpenChange={(open) => {
          if (open && editFormFieldsPendingRef.current) {
            editForm.setFieldsValue(editFormFieldsPendingRef.current);
            editFormFieldsPendingRef.current = null;
          }
        }}
      >
        <Form form={editForm} layout="vertical">
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            标准件：优先从预设名称选择；自定义种类：手填物料名称。编辑时仅更新档案信息，不重编物料编号。
          </Typography.Paragraph>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="kindId"
                label="物料种类"
                rules={[{ required: true, message: "请选择物料种类" }]}
              >
                <Select
                  placeholder="选择种类"
                  onChange={(kindId) => {
                    const nextKind = (presets?.kinds ?? []).find((k) => k.id === kindId);
                    editForm.setFieldsValue({
                      presetNameId: undefined,
                      customName: undefined,
                      customNamePrefix: undefined,
                      isPcbPurchase: isPcbKindName(nextKind?.name),
                      ...(nextKind?.namingMode !== "CUSTOM" && !editIsCustomerSupplied
                        ? { customerId: undefined }
                        : {}),
                    });
                  }}
                  options={(presets?.kinds ?? []).map((k) => ({
                    value: k.id,
                    label: `${k.name}${k.prefix ? `（前缀 ${k.prefix}）` : ""}${k.namingMode === "CUSTOM" ? " · 自定义" : ""}`,
                  }))}
                />
              </Form.Item>
            </Col>
            {editSelectedKind?.namingMode === "CUSTOM" ? (
              <>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="customName"
                    label="物料名称（自定义）"
                    rules={[{ required: true, message: "请填写物料名称" }]}
                  >
                    <Input allowClear />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="customNamePrefix"
                    label="名称前缀（编码参考）"
                    extra="仅用于查看原有编码段，编辑不会重编物料编号"
                  >
                    <Input allowClear />
                  </Form.Item>
                </Col>
                {!editIsCustomerSupplied ? (
                  <Col xs={24} sm={12}>
                    <Form.Item
                      name="customerId"
                      label="关联客户"
                      extra="选填，便于后续采购对账等按客户筛选"
                    >
                      <Select
                        allowClear
                        showSearch
                        optionFilterProp="searchText"
                        placeholder="选择关联客户（可选）"
                        options={customers.map((c) => ({
                          value: c.id,
                          label: `${c.name}${c.code ? `（${c.code}）` : ""}`,
                          searchText: `${c.code} ${c.name} ${c.shortName ?? ""}`.toLowerCase(),
                        }))}
                      />
                    </Form.Item>
                  </Col>
                ) : null}
              </>
            ) : (
              <Col xs={24} sm={12}>
                <Form.Item
                  name="presetNameId"
                  label="物料名称"
                  extra="可重新选择预设；不选择则沿用当前物料名称"
                >
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="下拉选择或输入关键字筛选"
                    options={(presets?.names ?? []).map((n) => ({
                      value: n.id,
                      label: n.name,
                    }))}
                    filterOption={(input, option) =>
                      String(option?.label ?? "")
                        .toLowerCase()
                        .includes(String(input ?? "").trim().toLowerCase())
                    }
                  />
                </Form.Item>
              </Col>
            )}
            <Form.Item name="name" hidden>
              <Input />
            </Form.Item>
            <Col span={24}>
              <Form.Item name="partDescription" label="部件描述">
                <Input.TextArea rows={2} allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="brand" label="品牌">
                <Select
                  allowClear
                  placeholder="选择品牌"
                  options={(presets?.brands ?? []).map((b) => ({
                    value: b.name,
                    label: b.name,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="unit"
                label="单位"
                rules={[{ required: true, message: "请选择单位" }]}
              >
                <Select
                  placeholder="单位"
                  options={(presets?.units ?? []).map((u) => ({
                    value: u.name,
                    label: u.name,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="isPcbPurchase" valuePropName="checked">
                <Checkbox>属PCB采购（不进入销售拆分采购）</Checkbox>
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="isCustomerSupplied" valuePropName="checked">
                <Checkbox
                  onChange={(e) => {
                    if (e.target.checked) {
                      editForm.setFieldsValue({
                        supplierId: undefined,
                        unitPrice: 0,
                      });
                    } else if (editSelectedKind?.namingMode !== "CUSTOM") {
                      editForm.setFieldsValue({ customerId: undefined });
                    }
                  }}
                >
                  客供料（不参与采购）
                </Checkbox>
              </Form.Item>
            </Col>
            {editIsCustomerSupplied ? (
              <Col xs={24} sm={12}>
                <Form.Item
                  name="customerId"
                  label="客供客户"
                  rules={[{ required: true, message: "请选择客供客户" }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="searchText"
                    placeholder="选择客供客户"
                    options={customers.map((c) => ({
                      value: c.id,
                      label: `${c.name}${c.code ? `（${c.code}）` : ""}`,
                      searchText: `${c.code} ${c.name} ${c.shortName ?? ""}`.toLowerCase(),
                    }))}
                  />
                </Form.Item>
              </Col>
            ) : (
              <Col xs={24} sm={12}>
                <Form.Item
                  name="unitPrice"
                  label="单价"
                  rules={[{ required: true, message: "请填写单价" }]}
                >
                  <InputNumber
                    min={0}
                    precision={4}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              </Col>
            )}
            {!editIsCustomerSupplied ? (
              <Col span={24}>
                <Form.Item
                  name="supplierId"
                  label="所属供应商"
                  rules={[{ required: true, message: "请选择供应商" }]}
                >
                  <Select
                    options={suppliers.map((s) => ({
                      value: s.id,
                      label: `${s.code} ${s.name}`,
                    }))}
                    showSearch
                    optionFilterProp="label"
                  />
                </Form.Item>
              </Col>
            ) : null}
            <Col xs={24} sm={12}>
              <Form.Item name="safetyStock" label="安全库存">
                <InputNumber min={0} precision={0} step={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="maxStock" label="最大库存">
                <InputNumber min={0} precision={0} step={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="inspectionNotes" label="检料注意事项">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label="签样图片（最多 3 张，点击缩略图可放大）">
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Upload {...editUploadProps}>
                    {editSamples.length >= 3 ? null : (
                      <div>
                        <UploadOutlined />
                        <div style={{ marginTop: 8 }}>上传</div>
                      </div>
                    )}
                  </Upload>
                  <Button
                    icon={<EyeOutlined />}
                    onClick={() =>
                      previewImageInNewTab(editSamples[editSamples.length - 1])
                    }
                    disabled={editSamples.length === 0}
                  >
                    预览
                  </Button>
                </Space>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title="物料详情"
        open={detailOpen}
        onCancel={() => {
          setDetailOpen(false);
          setUsedByProductsOpen(false);
        }}
        footer={
          loadingDetail || !detail ? null : (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
              }}
            >
              <Button
                type="default"
                icon={<FileExcelOutlined />}
                onClick={() => void exportInboundExcel()}
              >
                Excel 导出
              </Button>
              <Button onClick={() => setDetailOpen(false)}>关闭</Button>
            </div>
          )
        }
        width={980}
        destroyOnHidden
      >
        {loadingDetail ? (
          <Typography.Text type="secondary">加载中…</Typography.Text>
        ) : detail ? (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Row gutter={[24, 10]}>
              <Col xs={24} md={12}>
                <Space direction="vertical" size="small" style={{ width: "100%" }}>
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <strong>编号：</strong>
                    {detail.code}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <strong>名称：</strong>
                    {detail.name}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <strong>部件描述：</strong>
                    {detail.partDescription ?? "—"}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <strong>品牌：</strong>
                    {detail.brand ?? "—"}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 0 }}>
                    <strong>单位 / 单价：</strong>
                    {detail.unit} / {detail.unitPrice}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 0 }}>
                    <strong>安全库存 / 最大库存：</strong>
                    {(detail.safetyStock ?? 0) > 0 ? detail.safetyStock : "未设置"} /{" "}
                    {(detail.maxStock ?? 0) > 0 ? detail.maxStock : "未设置"}
                  </Typography.Paragraph>
                </Space>
              </Col>
              <Col xs={24} md={12}>
                <Space direction="vertical" size="small" style={{ width: "100%" }}>
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <strong>建档日期：</strong>
                    {dayjs(detail.createdAt).format("YYYY-MM-DD HH:mm")}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <strong>种类：</strong>
                    {detail.kindName}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <strong>{detail.isCustomerSupplied ? "客供客户" : "供应商"}：</strong>
                    {detail.isCustomerSupplied
                      ? detail.customer
                        ? `${detail.customer.code} ${detail.customer.name}`
                        : "—"
                      : `${detail.supplier.code} ${detail.supplier.name}`}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 0 }}>
                    <strong>库存合计：</strong>
                    {detail.totalQty}
                  </Typography.Paragraph>
                </Space>
              </Col>
              <Col span={24}>
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                  <strong>检料注意事项：</strong>
                  {detail.inspectionNotes ?? "—"}
                </Typography.Paragraph>
              </Col>
              <Col span={24}>
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                  <strong>共用此物料商品数：</strong>
                  {usedByProductUniqueCount === 0 ? (
                    "0"
                  ) : (
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, height: "auto", verticalAlign: "baseline" }}
                      onClick={() => setUsedByProductsOpen(true)}
                    >
                      {usedByProductUniqueCount}
                    </Button>
                  )}
                </Typography.Paragraph>
              </Col>
            </Row>
            {detail.sampleImageUrls.length > 0 ? (
              <div>
                <Typography.Text strong>签样图片（点击放大）</Typography.Text>
                <div style={{ marginTop: 8 }}>
                  <Image.PreviewGroup>
                    <Space wrap>
                      {detail.sampleImageUrls.map((u) => (
                        <Image
                          key={u}
                          src={u}
                          alt="签样"
                          width={120}
                          style={{ objectFit: "cover", borderRadius: 4 }}
                        />
                      ))}
                    </Space>
                  </Image.PreviewGroup>
                </div>
              </div>
            ) : null}
            <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 0 }}>
              入库记录
            </Typography.Title>
            <Table<InboundRow>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={detail.inbounds}
              scroll={{ x: 960 }}
              columns={[
                {
                  title: "类型",
                  key: "etype",
                  width: 96,
                  render: (_, row) => materialInboundTypeLabel(row),
                },
                {
                  title: "数量",
                  dataIndex: "quantity",
                  width: 72,
                  align: "right",
                },
                {
                  title: "时间",
                  dataIndex: "receivedAt",
                  width: 152,
                  render: (t: string) => dayjs(t).format("YYYY-MM-DD HH:mm"),
                },
                {
                  title: "操作员",
                  key: "operator",
                  width: 120,
                  ellipsis: true,
                  render: (_, row) =>
                    row.operatorName
                      ? row.operatorEmployeeNo
                        ? `${row.operatorName}（${row.operatorEmployeeNo}）`
                        : row.operatorName
                      : "—",
                },
                { title: "采购订单编号", dataIndex: "purchaseOrderNo", ellipsis: true, width: 150 },
                {
                  title: "备注/部件描述",
                  dataIndex: "partDescription",
                  ellipsis: true,
                  render: (v: string | null) => v ?? "—",
                },
              ]}
            />
          </Space>
        ) : (
          <Typography.Text type="secondary">无数据</Typography.Text>
        )}
      </Modal>

      <Modal
        title="共用此物料的商品"
        open={usedByProductsOpen}
        onCancel={() => setUsedByProductsOpen(false)}
        footer={<Button onClick={() => setUsedByProductsOpen(false)}>关闭</Button>}
        width={760}
        destroyOnHidden
      >
        <Table<UsedByProductRow>
          size="small"
          rowKey={(r) => `${r.productId}-${r.scope}`}
          pagination={false}
          locale={{ emptyText: "暂无商品 BOM 引用此物料" }}
          dataSource={detail?.usedByProducts ?? []}
          scroll={{ x: 880 }}
          columns={usedByProductColumns}
        />
      </Modal>
    </Card>
  );
}
