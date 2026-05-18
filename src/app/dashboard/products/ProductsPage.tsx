"use client";

import {
  DeleteOutlined,
  FileExcelOutlined,
  InboxOutlined,
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
  Radio,
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
import type { TableRowSelection } from "antd/es/table/interface";
import type { UploadProps } from "antd";
import dayjs from "dayjs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  Dispatch,
  Key,
  ReactNode,
  SetStateAction,
  SyntheticEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MaterialInventoryListRow } from "@/lib/materialInventoryQuery";
import { fetchJson } from "@/lib/fetch-json";
import { useMeTabPermissions } from "@/lib/use-me-tab-permissions";
import { ResizableTableTitle } from "@/components/ResizableTableTitle";

const PRODUCT_TAB_PERM: Record<string, string> = {
  add: "tab.prod.add",
  inventory: "tab.prod.inv",
  stockAdjust: "tab.prod.adjust",
  deprecated: "tab.prod.deprecated",
};

const LS_PROD_COLS = "products.table.visibleCols.mat.v1";
const LS_PROD_INV_COLS = "products.table.visibleCols.inv.v1";
const LS_BOM_MAT_COLS = "products.modal.bomMaterial.visibleCols.v1";

type ProductProcessingMode = "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";

const PRODUCT_PROCESSING_LABEL: Record<ProductProcessingMode, string> = {
  INHOUSE: "自加工",
  OUTSOURCE: "外发加工",
  OUTSOURCE_INHOUSE: "外发+自加工",
};

const PROD_COL_OPTIONS: { label: string; value: string }[] = [
  { label: "客户名称", value: "customer" },
  { label: "物料编号", value: "customerMaterialCode" },
  { label: "机型号", value: "machineModel" },
  { label: "商品型号", value: "model" },
  { label: "加工方式", value: "processingMode" },
  { label: "商品规格", value: "spec" },
  { label: "商品图片", value: "productImages" },
  { label: "单位", value: "unit" },
  { label: "价格", value: "price" },
  { label: "加工成本", value: "processingCost" },
  { label: "安全库存", value: "safetyStock" },
  { label: "最大库存", value: "maxStock" },
  { label: "日期", value: "createdAt" },
  { label: "注意事项", value: "inspectionNotes" },
  { label: "商品备注", value: "productRemark" },
];

const INV_COL_OPTIONS: { label: string; value: string }[] = [
  { label: "客户名称", value: "customer" },
  { label: "物料编号", value: "customerMaterialCode" },
  { label: "机型号", value: "machineModel" },
  { label: "商品型号", value: "model" },
  { label: "加工方式", value: "processingMode" },
  { label: "商品规格", value: "spec" },
  { label: "商品图片", value: "productImages" },
  { label: "单位", value: "unit" },
  { label: "价格", value: "price" },
  { label: "加工成本", value: "processingCost" },
  { label: "安全库存", value: "safetyStock" },
  { label: "最大库存", value: "maxStock" },
  { label: "日期", value: "createdAt" },
  { label: "注意事项", value: "inspectionNotes" },
  { label: "商品备注", value: "productRemark" },
  { label: "库存数量", value: "totalQty" },
  { label: "最近入库", value: "lastReceivedAt" },
];

const PROD_ALL_KEYS = PROD_COL_OPTIONS.map((o) => o.value);
const INV_ALL_KEYS = INV_COL_OPTIONS.map((o) => o.value);
const INV_DEFAULT_KEYS = INV_ALL_KEYS.filter((k) => k !== "spec");

/** 「商品包含物料」弹窗表格可配置列 */
const BOM_MATERIAL_COL_OPTIONS: { label: string; value: string }[] = [
  { label: "系统物料编号", value: "code" },
  { label: "BOM 归属", value: "bomScope" },
  { label: "物料名称", value: "name" },
  { label: "部件描述", value: "partDescription" },
  { label: "品牌", value: "brand" },
  { label: "单位", value: "unit" },
  { label: "单价", value: "unitPrice" },
  { label: "种类", value: "kindName" },
  { label: "供应商", value: "supplier" },
  { label: "用量", value: "usageQty" },
  { label: "库存", value: "totalQty" },
  { label: "建档日期", value: "createdAt" },
  { label: "检料注意事项", value: "inspectionNotes" },
  { label: "签样图", value: "sampleImages" },
];

const BOM_MATERIAL_ALL_KEYS = BOM_MATERIAL_COL_OPTIONS.map((o) => o.value);
const BOM_MATERIAL_DEFAULT_KEYS = BOM_MATERIAL_ALL_KEYS;

const DEFAULT_PROD_COL_WIDTH: Record<string, number> = {
  customer: 140,
  customerMaterialCode: 128,
  machineModel: 100,
  model: 120,
  processingMode: 100,
  spec: 120,
  productImages: 108,
  unit: 72,
  price: 96,
  processingCost: 96,
  safetyStock: 96,
  maxStock: 96,
  createdAt: 156,
  inspectionNotes: 160,
  productRemark: 140,
};

const DEFAULT_INV_COL_WIDTH: Record<string, number> = {
  customer: 140,
  customerMaterialCode: 128,
  machineModel: 100,
  model: 120,
  processingMode: 100,
  spec: 120,
  productImages: 108,
  unit: 72,
  price: 96,
  processingCost: 96,
  safetyStock: 96,
  maxStock: 96,
  createdAt: 156,
  inspectionNotes: 160,
  productRemark: 140,
  totalQty: 96,
  lastReceivedAt: 168,
};

const DEFAULT_BOM_EDITOR_COL_WIDTH: Record<string, number> = {
  materialName: 260,
  partDescription: 260,
  unit: 88,
  usageQty: 120,
  supplierLabel: 220,
  op: 64,
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
      const w = key === "op" ? 168 : key === "d" ? 88 : ((col.width as number) ?? 120);
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

type CustomerOpt = { id: string; code: string; name: string };
type UnitOpt = { id: string; name: string; isDefault: boolean; sortOrder: number };

type ProductPresetBundle = {
  customers: CustomerOpt[];
  units: UnitOpt[];
};

type ProductRow = {
  id: string;
  isDeprecated: boolean;
  deprecatedAt: string | null;
  deprecatedReason: string | null;
  customer: CustomerOpt;
  customerMaterialCode: string;
  processingMode: ProductProcessingMode;
  machineModel: string;
  model: string;
  spec: string;
  unit: string;
  price: string;
  processingCost: string;
  safetyStock: string;
  maxStock: string;
  inspectionNotes: string | null;
  productRemark: string | null;
  imageUrls: string[];
  totalQty: number;
  createdAt: string;
  updatedAt: string;
};

type InventoryRow = {
  id: string;
  isDeprecated: boolean;
  deprecatedAt: string | null;
  deprecatedReason: string | null;
  customer: CustomerOpt;
  customerMaterialCode: string;
  processingMode: ProductProcessingMode;
  machineModel: string;
  model: string;
  spec: string;
  unit: string;
  price: string;
  processingCost: string;
  safetyStock: string;
  maxStock: string;
  inspectionNotes: string | null;
  productRemark: string | null;
  imageUrls: string[];
  createdAt: string;
  totalQty: number;
  lastReceivedAt: string | null;
};

type ProductInboundRow = {
  id: string;
  quantity: string;
  entryType: "REGULAR" | "MANUAL_STOCK_ADJUST";
  receivedAt: string;
  purchaseOrderNo: string | null;
  partDescription: string | null;
  remark: string | null;
  operatorName?: string | null;
  operatorEmployeeNo?: string | null;
};

function productInboundTypeLabel(r: ProductInboundRow): string {
  const qty = Number(r.quantity || 0);
  if (r.entryType === "MANUAL_STOCK_ADJUST") {
    return qty >= 0 ? "盘点入库" : "盘点出库";
  }
  return qty >= 0 ? "入库" : "出库";
}

/** 销售送货/出货类流水在「关联销售订单」列显示客户订单号，否则无 */
function formatProductInboundSalesLink(r: ProductInboundRow): string {
  const fromSales =
    (r.remark?.includes("送货单") ?? false) ||
    (r.partDescription != null && /销售出货|送货单/.test(r.partDescription));
  const po = r.purchaseOrderNo?.trim();
  if (fromSales && po) return po;
  return "无";
}

type MaterialOption = {
  id: string;
  code: string;
  name: string;
  partDescription: string | null;
  unit: string;
  supplier: { code: string; name: string };
};

type BomLine = {
  key: string;
  materialId: string | undefined;
  usageQty: number;
  name: string;
  partDescription: string | null;
  unit: string;
  supplierLabel: string;
  /** 外发+自加工 拆栏时由父级传入，写入 API scope */
  bomScope?: "OUTSOURCE" | "INHOUSE";
};

const HYBRID_BOM_LABEL: Record<"OUTSOURCE" | "INHOUSE", string> = {
  OUTSOURCE: "外发物料",
  INHOUSE: "自加工物料",
};

function bomScopeColLabel(
  s: "DEFAULT" | "OUTSOURCE" | "INHOUSE" | undefined,
): string {
  if (s === "OUTSOURCE") return "外发";
  if (s === "INHOUSE") return "自加工";
  return "通用";
}

type ProductMaterialItem = {
  id: string;
  scope?: "DEFAULT" | "OUTSOURCE" | "INHOUSE";
  usageQty: string;
  material: {
    id: string;
    code: string;
    name: string;
    partDescription: string | null;
    brand: string | null;
    unit: string;
    unitPrice: string;
    kindName: string;
    supplier: { id: string; code: string; name: string };
    inspectionNotes: string | null;
    sampleImageUrls: string[];
    totalQty: number;
    createdAt: string;
    updatedAt: string;
  };
};

type DetailPayload = {
  id: string;
  isDeprecated: boolean;
  deprecatedAt: string | null;
  deprecatedReason: string | null;
  customerId: string;
  customer: CustomerOpt;
  customerMaterialCode: string;
  processingMode: ProductProcessingMode;
  machineModel: string;
  model: string;
  spec: string;
  unit: string;
  price: string;
  processingCost: string;
  safetyStock: string;
  maxStock: string;
  inspectionNotes: string | null;
  productRemark: string | null;
  imageUrls: string[];
  createdAt: string;
  updatedAt: string;
  totalQty: number;
  lastReceivedAt: string | null;
  inbounds: ProductInboundRow[];
  productMaterials: ProductMaterialItem[];
};

function newBomLineKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ProductBomTable({
  lines,
  setLines,
  materialOptions,
  sectionTitle,
  lineScope,
}: {
  lines: BomLine[];
  setLines: Dispatch<SetStateAction<BomLine[]>>;
  materialOptions: MaterialOption[];
  /** 外发+自加工 时「外发物料」「自加工物料」小标题 */
  sectionTitle?: string;
  /** 有值时新行、库存多选均带上 bomScope */
  lineScope?: "OUTSOURCE" | "INHOUSE";
}) {
  const { message } = App.useApp();
  const [bomPickerOpen, setBomPickerOpen] = useState(false);
  const [bomPickerForm] = Form.useForm();
  const [bomPickerRows, setBomPickerRows] = useState<MaterialInventoryListRow[]>(
    [],
  );
  const [bomPickerKinds, setBomPickerKinds] = useState<
    { id: string; name: string }[]
  >([]);
  const [bomPickerLoading, setBomPickerLoading] = useState(false);
  const [bomPickerSelectedKeys, setBomPickerSelectedKeys] = useState<Key[]>([]);
  const [bomPickerSuppliers, setBomPickerSuppliers] = useState<
    { id: string; code: string; name: string }[]
  >([]);
  const [bomPickerSuppliersLoading, setBomPickerSuppliersLoading] = useState(false);
  const [bomEditorColWidths, setBomEditorColWidths] = useState<Record<string, number>>({});

  const loadBomPickerSuppliers = useCallback(async () => {
    setBomPickerSuppliersLoading(true);
    try {
      const data = await fetchJson<{ list: { id: string; code: string; name: string }[] }>(
        "/api/suppliers",
        { credentials: "include" },
      );
      setBomPickerSuppliers(data.list ?? []);
    } catch {
      setBomPickerSuppliers([]);
    } finally {
      setBomPickerSuppliersLoading(false);
    }
  }, []);

  const [bomPickerPresetNames, setBomPickerPresetNames] = useState<
    { id: string; name: string }[]
  >([]);

  const loadBomPickerPresetNames = useCallback(async () => {
    try {
      const data = await fetchJson<{ names: { id: string; name: string }[] }>(
        "/api/material-presets",
        { credentials: "include" },
      );
      setBomPickerPresetNames(data.names ?? []);
    } catch {
      setBomPickerPresetNames([]);
    }
  }, []);

  const updateLine = (key: string, patch: Partial<BomLine>) => {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const clearLineMaterial = (key: string) => {
    updateLine(key, {
      materialId: undefined,
      name: "",
      partDescription: null,
      unit: "",
      supplierLabel: "",
    });
  };

  const applyMaterialToLine = (key: string, materialId?: string) => {
    if (!materialId) {
      clearLineMaterial(key);
      return;
    }
    const opt = materialOptions.find((o) => o.id === materialId);
    if (!opt) return;
    updateLine(key, {
      materialId: opt.id,
      name: opt.name,
      partDescription: opt.partDescription,
      unit: opt.unit,
      supplierLabel: `${opt.supplier.code} ${opt.supplier.name}`,
    });
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        key: newBomLineKey(),
        materialId: undefined,
        usageQty: 1,
        name: "",
        partDescription: null,
        unit: "",
        supplierLabel: "",
        ...(lineScope ? { bomScope: lineScope } : {}),
      },
    ]);
  };

  const buildBomPickerQuery = (v: Record<string, unknown>) => {
    const p = new URLSearchParams();
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
    return p.toString();
  };

  const loadBomPickerInventory = useCallback(
    async (override?: Record<string, unknown>) => {
      setBomPickerLoading(true);
      try {
        const v =
          override ??
          (await bomPickerForm.validateFields().catch(() => ({})));
        const q = buildBomPickerQuery(v as Record<string, unknown>);
        const data = await fetchJson<{
          list: MaterialInventoryListRow[];
          kinds: { id: string; name: string }[];
        }>(`/api/products/material-inventory${q ? `?${q}` : ""}`, {
          credentials: "include",
        });
        setBomPickerRows(data.list ?? []);
        setBomPickerKinds(data.kinds ?? []);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "查询失败");
      } finally {
        setBomPickerLoading(false);
      }
    },
    [bomPickerForm, message],
  );

  const openBomPicker = () => {
    bomPickerForm.resetFields();
    setBomPickerSelectedKeys([]);
    setBomPickerOpen(true);
    void loadBomPickerSuppliers();
    void loadBomPickerPresetNames();
    void loadBomPickerInventory({});
  };

  const confirmBomPicker = () => {
    const byId = new Map(bomPickerRows.map((r) => [r.id, r]));
    const taken = new Set(
      lines.filter((l) => l.materialId).map((l) => l.materialId as string),
    );
    const toAdd: BomLine[] = [];
    for (const key of bomPickerSelectedKeys) {
      if (typeof key !== "string") continue;
      if (taken.has(key)) continue;
      const row = byId.get(key);
      if (!row) continue;
      taken.add(key);
      toAdd.push({
        key: newBomLineKey(),
        materialId: row.id,
        usageQty: 1,
        name: row.name,
        partDescription: row.partDescription,
        unit: row.unit,
        supplierLabel: `${row.supplier.code} ${row.supplier.name}`,
        ...(lineScope ? { bomScope: lineScope } : {}),
      });
    }
    if (toAdd.length === 0) {
      message.warning(
        "未加入新行：请勾选尚未包含在列表中的物料（已添加的物料不可重复）",
      );
      return;
    }
    setLines((prev) => [...prev, ...toAdd]);
    setBomPickerOpen(false);
    setBomPickerSelectedKeys([]);
  };

  const bomPickerRowSelection: TableRowSelection<MaterialInventoryListRow> =
    useMemo(() => {
      const taken = new Set(
        lines.filter((l) => l.materialId).map((l) => l.materialId as string),
      );
      return {
        selectedRowKeys: bomPickerSelectedKeys,
        onChange: (keys) => setBomPickerSelectedKeys(keys),
        preserveSelectedRowKeys: true,
        getCheckboxProps: (record) => ({
          disabled: taken.has(record.id),
        }),
      };
    }, [lines, bomPickerSelectedKeys]);

  /** 已选物料行的用量合计（正整数） */
  const bomUsageTotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        if (!l.materialId) return sum;
        const q = Math.round(Number(l.usageQty));
        return sum + (Number.isFinite(q) && q > 0 ? q : 0);
      }, 0),
    [lines],
  );

  const bomEditorColumns = useMemo<ColumnsType<BomLine>>(
    () => [
      {
        key: "materialName",
        title: "物料名称",
        dataIndex: "name",
        width: bomEditorColWidths.materialName ?? DEFAULT_BOM_EDITOR_COL_WIDTH.materialName,
        onHeaderCell: () => ({
          width: bomEditorColWidths.materialName ?? DEFAULT_BOM_EDITOR_COL_WIDTH.materialName,
          onResize: (_e: SyntheticEvent, data: ResizeCallbackData) => {
            setBomEditorColWidths((prev) => ({ ...prev, materialName: data.size.width }));
          },
        }),
        render: (_, row) => {
          const taken = new Set(
            lines
              .filter((l) => l.key !== row.key && l.materialId)
              .map((l) => l.materialId as string),
          );
          const opts = materialOptions.filter(
            (o) => !taken.has(o.id) || o.id === row.materialId,
          );
          return (
            <Select
              placeholder="选择系统物料"
              allowClear
              showSearch
              style={{ width: "100%" }}
              optionFilterProp="label"
              value={row.materialId}
              options={opts.map((o) => ({
                value: o.id,
                label: o.name,
              }))}
              onChange={(mid) => applyMaterialToLine(row.key, mid)}
            />
          );
        },
      },
      {
        key: "partDescription",
        title: "部件描述",
        dataIndex: "partDescription",
        width: bomEditorColWidths.partDescription ?? DEFAULT_BOM_EDITOR_COL_WIDTH.partDescription,
        onHeaderCell: () => ({
          width:
            bomEditorColWidths.partDescription ??
            DEFAULT_BOM_EDITOR_COL_WIDTH.partDescription,
          onResize: (_e: SyntheticEvent, data: ResizeCallbackData) => {
            setBomEditorColWidths((prev) => ({ ...prev, partDescription: data.size.width }));
          },
        }),
        ellipsis: true,
        render: (_, row) => {
          const taken = new Set(
            lines
              .filter((l) => l.key !== row.key && l.materialId)
              .map((l) => l.materialId as string),
          );
          const opts = materialOptions.filter(
            (o) => !taken.has(o.id) || o.id === row.materialId,
          );
          return (
            <Select
              placeholder="输入部件描述自动筛选"
              allowClear
              showSearch
              style={{ width: "100%" }}
              optionFilterProp="label"
              value={row.materialId}
              options={opts.map((o) => ({
                value: o.id,
                label: o.partDescription?.trim() || "—",
              }))}
              onChange={(mid) => applyMaterialToLine(row.key, mid)}
            />
          );
        },
      },
      {
        key: "unit",
        title: "单位",
        dataIndex: "unit",
        width: bomEditorColWidths.unit ?? DEFAULT_BOM_EDITOR_COL_WIDTH.unit,
        onHeaderCell: () => ({
          width: bomEditorColWidths.unit ?? DEFAULT_BOM_EDITOR_COL_WIDTH.unit,
          onResize: (_e: SyntheticEvent, data: ResizeCallbackData) => {
            setBomEditorColWidths((prev) => ({ ...prev, unit: data.size.width }));
          },
        }),
        render: (t) => t || "—",
      },
      {
        key: "usageQty",
        title: "用量",
        dataIndex: "usageQty",
        width: bomEditorColWidths.usageQty ?? DEFAULT_BOM_EDITOR_COL_WIDTH.usageQty,
        onHeaderCell: () => ({
          width: bomEditorColWidths.usageQty ?? DEFAULT_BOM_EDITOR_COL_WIDTH.usageQty,
          onResize: (_e: SyntheticEvent, data: ResizeCallbackData) => {
            setBomEditorColWidths((prev) => ({ ...prev, usageQty: data.size.width }));
          },
        }),
        render: (_, row) => (
          <InputNumber
            min={1}
            max={999999999}
            precision={0}
            step={1}
            style={{ width: "100%" }}
            value={row.usageQty}
            onChange={(v) => {
              if (v === null || v === undefined) {
                updateLine(row.key, { usageQty: 1 });
                return;
              }
              const n = Math.round(Number(v));
              updateLine(row.key, {
                usageQty:
                  Number.isFinite(n) && n >= 1 ? n : 1,
              });
            }}
          />
        ),
      },
      {
        key: "supplierLabel",
        title: "供应商",
        dataIndex: "supplierLabel",
        width: bomEditorColWidths.supplierLabel ?? DEFAULT_BOM_EDITOR_COL_WIDTH.supplierLabel,
        onHeaderCell: () => ({
          width:
            bomEditorColWidths.supplierLabel ?? DEFAULT_BOM_EDITOR_COL_WIDTH.supplierLabel,
          onResize: (_e: SyntheticEvent, data: ResizeCallbackData) => {
            setBomEditorColWidths((prev) => ({ ...prev, supplierLabel: data.size.width }));
          },
        }),
        ellipsis: true,
        render: (t: string) => t || "—",
      },
      {
        title: "操作",
        key: "op",
        width: DEFAULT_BOM_EDITOR_COL_WIDTH.op,
        render: (_, row) => (
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            aria-label="删除"
            onClick={() => removeLine(row.key)}
          />
        ),
      },
    ],
    [bomEditorColWidths, lines, materialOptions],
  );

  return (
    <div>
      <Typography.Text strong>
        {sectionTitle ?? "BOM表"}
      </Typography.Text>
      <Table<BomLine>
        size="small"
        style={{ marginTop: 8 }}
        rowKey="key"
        pagination={false}
        dataSource={lines}
        locale={{ emptyText: "请点击下方按钮添加物料" }}
        columns={bomEditorColumns}
        scroll={{ x: "max-content" }}
        tableLayout="fixed"
        components={{
          header: { cell: ResizableTableTitle },
        }}
        summary={() => (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={3} align="right">
                <Typography.Text type="secondary">用量合计</Typography.Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3}>
                <Typography.Text strong>{bomUsageTotal}</Typography.Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} colSpan={2} />
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />
      <Space style={{ marginTop: 8 }} wrap>
        <Button type="dashed" onClick={addLine}>
          添加物料
        </Button>
        <Button icon={<InboxOutlined />} onClick={openBomPicker}>
          从物料库存多选
        </Button>
      </Space>

      <Modal
        title="从物料库存多选"
        open={bomPickerOpen}
        onCancel={() => {
          setBomPickerOpen(false);
          setBomPickerSelectedKeys([]);
        }}
        onOk={() => confirmBomPicker()}
        width={960}
        destroyOnHidden
        okText="加入已选"
        cancelText="关闭"
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          筛选条件与「物料信息 → 物料库存」一致；勾选多条后点「加入已选」一次加入 BOM。已在列表中的物料不可重复勾选。
        </Typography.Paragraph>
        <Form
          form={bomPickerForm}
          layout="inline"
          style={{ rowGap: 12, marginBottom: 12 }}
          onFinish={(v) => void loadBomPickerInventory(v as Record<string, unknown>)}
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
              options={bomPickerPresetNames.map((n) => ({
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
              options={bomPickerKinds.map((k) => ({
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
              loading={bomPickerSuppliersLoading}
              optionFilterProp="label"
              style={{ width: 200 }}
              options={bomPickerSuppliers.map((s) => ({
                value: s.id,
                label: `${s.name}${s.code ? `（${s.code}）` : ""}`,
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
                bomPickerForm.resetFields();
                void loadBomPickerInventory({});
              }}
            >
              重置
            </Button>
          </Form.Item>
        </Form>
        <Table<MaterialInventoryListRow>
          rowKey="id"
          size="small"
          loading={bomPickerLoading}
          dataSource={bomPickerRows}
          pagination={{ pageSize: 10 }}
          scroll={{ x: "max-content" }}
          rowSelection={bomPickerRowSelection}
          columns={[
            { title: "物料编号", dataIndex: "code", width: 120, ellipsis: true },
            { title: "物料名称", dataIndex: "name", width: 140, ellipsis: true },
            { title: "种类", dataIndex: "kindName", width: 88, ellipsis: true },
            {
              title: "部件描述",
              dataIndex: "partDescription",
              ellipsis: true,
              render: (v: string | null) => v ?? "—",
            },
            { title: "单位", dataIndex: "unit", width: 64 },
            { title: "库存数量", dataIndex: "totalQty", width: 88 },
            {
              title: "供应商",
              key: "supplier",
              ellipsis: true,
              render: (_, r) => `${r.supplier.code} ${r.supplier.name}`,
            },
          ]}
        />
      </Modal>
    </div>
  );
}

function renderProductThumbs(urls: string[]) {
  if (!urls?.length) return "—";
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
}

export function ProductsPage() {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("add");

  const [presets, setPresets] = useState<ProductPresetBundle | null>(null);
  const [loadingPresets, setLoadingPresets] = useState(true);

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loadingProd, setLoadingProd] = useState(false);

  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [loadingInv, setLoadingInv] = useState(false);

  const [filterForm] = Form.useForm();

  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();
  const addProcessingMode = Form.useWatch("processingMode", addForm) as
    | ProductProcessingMode
    | undefined;
  const addFormFieldsPendingRef = useRef<Record<string, unknown> | null>(null);
  const [sampleUrls, setSampleUrls] = useState<string[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingProductInfo, setEditingProductInfo] = useState<{
    isDeprecated: boolean;
    customerMaterialCode: string;
    model: string;
  } | null>(null);
  const [deprecating, setDeprecating] = useState(false);
  const [deletingFromEdit, setDeletingFromEdit] = useState(false);
  const [editForm] = Form.useForm();
  const editProcessingMode = Form.useWatch("processingMode", editForm) as
    | ProductProcessingMode
    | undefined;
  const editFormFieldsPendingRef = useRef<Record<string, unknown> | null>(null);
  const [editSamples, setEditSamples] = useState<string[]>([]);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [materialOptions, setMaterialOptions] = useState<MaterialOption[]>([]);
  const [addBomLines, setAddBomLines] = useState<BomLine[]>([]);
  const [addBomOutsource, setAddBomOutsource] = useState<BomLine[]>([]);
  const [addBomInhouse, setAddBomInhouse] = useState<BomLine[]>([]);
  const [editBomLines, setEditBomLines] = useState<BomLine[]>([]);
  const [editBomOutsource, setEditBomOutsource] = useState<BomLine[]>([]);
  const [editBomInhouse, setEditBomInhouse] = useState<BomLine[]>([]);
  const [materialsDetailOpen, setMaterialsDetailOpen] = useState(false);

  const [prodColKeys, setProdColKeys] = useState<string[]>(PROD_ALL_KEYS);
  const [invColKeys, setInvColKeys] = useState<string[]>(INV_DEFAULT_KEYS);
  const [bomMatColKeys, setBomMatColKeys] = useState<string[]>(
    BOM_MATERIAL_DEFAULT_KEYS,
  );
  const [prodColWidths, setProdColWidths] = useState<Record<string, number>>({});
  const [invColWidths, setInvColWidths] = useState<Record<string, number>>({});
  const skipProdColPersist = useRef(true);
  const skipInvColPersist = useRef(true);
  const skipBomMatColPersist = useRef(true);

  const [stockAdjustOpen, setStockAdjustOpen] = useState(false);
  const [stockAdjustTarget, setStockAdjustTarget] = useState<InventoryRow | null>(null);
  const [stockAdjustForm] = Form.useForm<{ delta: number; remark?: string }>();
  const [stockAdjustSubmitting, setStockAdjustSubmitting] = useState(false);

  const loadPresets = useCallback(async () => {
    setLoadingPresets(true);
    try {
      const data = await fetchJson<ProductPresetBundle>("/api/product-presets", {
        credentials: "include",
      });
      setPresets(data);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载选项失败");
    } finally {
      setLoadingPresets(false);
    }
  }, [message]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchJson<{ list: MaterialOption[] }>(
          "/api/products/material-options",
          { credentials: "include" },
        );
        setMaterialOptions(data.list ?? []);
      } catch {
        setMaterialOptions([]);
      }
    })();
  }, []);

  const loadProducts = useCallback(async () => {
    setLoadingProd(true);
    try {
      const start = dayjs().startOf("day").toISOString();
      const end = dayjs().endOf("day").toISOString();
      const q = new URLSearchParams({ createdFrom: start, createdTo: end });
      const data = await fetchJson<{ list: ProductRow[] }>(
        `/api/products?${q.toString()}`,
        { credentials: "include" },
      );
      setProducts(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoadingProd(false);
    }
  }, [message]);

  const buildInventoryQuery = (
    v: Record<string, unknown>,
    deprecatedOnly: boolean,
  ) => {
    const p = new URLSearchParams();
    p.set("deprecated", deprecatedOnly ? "1" : "0");
    if (v.productModel) p.set("productModel", String(v.productModel));
    if (v.productDescription) {
      p.set("productDescription", String(v.productDescription));
    }
    if (v.customerId) p.set("customerId", String(v.customerId));
    if (v.materialCode) p.set("materialCode", String(v.materialCode));
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

  const loadInventory = useCallback(
    async (
      override?: Record<string, unknown>,
      opts?: { deprecatedOnly?: boolean },
    ) => {
      setLoadingInv(true);
      try {
        const v =
          override ?? (await filterForm.validateFields().catch(() => ({})));
        const deprecatedOnly = opts?.deprecatedOnly ?? tab === "deprecated";
        const q = buildInventoryQuery(v as Record<string, unknown>, deprecatedOnly);
        const data = await fetchJson<{ list: InventoryRow[] }>(
          `/api/products/inventory?${q.toString()}`,
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
    void loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (tab === "inventory" || tab === "stockAdjust" || tab === "deprecated") {
      void loadInventory({}, { deprecatedOnly: tab === "deprecated" });
    }
  }, [tab, loadInventory]);

  useEffect(() => {
    setProdColKeys(loadVisibleColKeys(LS_PROD_COLS, PROD_ALL_KEYS, PROD_ALL_KEYS));
  }, []);

  useEffect(() => {
    setInvColKeys(loadVisibleColKeys(LS_PROD_INV_COLS, INV_ALL_KEYS, INV_DEFAULT_KEYS));
  }, []);

  useEffect(() => {
    setBomMatColKeys(
      loadVisibleColKeys(
        LS_BOM_MAT_COLS,
        BOM_MATERIAL_ALL_KEYS,
        BOM_MATERIAL_DEFAULT_KEYS,
      ),
    );
  }, []);

  useEffect(() => {
    if (skipProdColPersist.current) {
      skipProdColPersist.current = false;
      return;
    }
    localStorage.setItem(LS_PROD_COLS, JSON.stringify(prodColKeys));
  }, [prodColKeys]);

  useEffect(() => {
    if (skipInvColPersist.current) {
      skipInvColPersist.current = false;
      return;
    }
    localStorage.setItem(LS_PROD_INV_COLS, JSON.stringify(invColKeys));
  }, [invColKeys]);

  useEffect(() => {
    if (skipBomMatColPersist.current) {
      skipBomMatColPersist.current = false;
      return;
    }
    localStorage.setItem(LS_BOM_MAT_COLS, JSON.stringify(bomMatColKeys));
  }, [bomMatColKeys]);

  const bomMaterialColumnsAll = useMemo<ColumnsType<ProductMaterialItem>>(
    () => [
      {
        key: "code",
        title: "系统物料编号",
        width: 140,
        render: (_, r) => r.material.code,
      },
      {
        key: "bomScope",
        title: "BOM 归属",
        width: 88,
        render: (_, r) => bomScopeColLabel(r.scope),
      },
      {
        key: "name",
        title: "物料名称",
        width: 120,
        ellipsis: true,
        render: (_, r) => r.material.name,
      },
      {
        key: "partDescription",
        title: "部件描述",
        width: 140,
        ellipsis: true,
        render: (_, r) => r.material.partDescription ?? "—",
      },
      {
        key: "brand",
        title: "品牌",
        width: 88,
        render: (_, r) => r.material.brand ?? "—",
      },
      {
        key: "unit",
        title: "单位",
        width: 64,
        render: (_, r) => r.material.unit,
      },
      {
        key: "unitPrice",
        title: "单价",
        width: 96,
        render: (_, r) => r.material.unitPrice,
      },
      {
        key: "kindName",
        title: "种类",
        width: 96,
        render: (_, r) => r.material.kindName,
      },
      {
        key: "supplier",
        title: "供应商",
        width: 140,
        ellipsis: true,
        render: (_, r) =>
          `${r.material.supplier.code} ${r.material.supplier.name}`,
      },
      {
        key: "usageQty",
        title: "用量",
        width: 88,
        render: (_, r) => {
          const q = Math.round(Number(r.usageQty));
          return Number.isFinite(q) ? q : "—";
        },
      },
      {
        key: "totalQty",
        title: "库存",
        width: 80,
        render: (_, r) => r.material.totalQty,
      },
      {
        key: "createdAt",
        title: "建档日期",
        width: 140,
        render: (_, r) =>
          dayjs(r.material.createdAt).format("YYYY-MM-DD HH:mm"),
      },
      {
        key: "inspectionNotes",
        title: "检料注意事项",
        width: 180,
        ellipsis: true,
        render: (_, r) => r.material.inspectionNotes ?? "—",
      },
      {
        key: "sampleImages",
        title: "签样图",
        width: 120,
        render: (_, r) =>
          r.material.sampleImageUrls?.length ? (
            <Image.PreviewGroup>
              <Space size={4} wrap>
                {r.material.sampleImageUrls.map((u) => (
                  <Image
                    key={u}
                    src={u}
                    alt=""
                    width={40}
                    height={40}
                    style={{
                      objectFit: "cover",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  />
                ))}
              </Space>
            </Image.PreviewGroup>
          ) : (
            "—"
          ),
      },
    ],
    [],
  );

  const visibleBomMaterialColumns = useMemo(
    () =>
      bomMaterialColumnsAll.filter(
        (col) =>
          typeof col.key === "string" && bomMatColKeys.includes(col.key),
      ),
    [bomMaterialColumnsAll, bomMatColKeys],
  );

  const onBomMatColKeysChange = (keys: string[]) => {
    if (keys.length === 0) return;
    setBomMatColKeys(keys);
  };

  /** 查看 BOM 弹窗：用量列合计（整数） */
  const bomViewUsageTotal = useMemo(() => {
    if (!detail?.productMaterials?.length) return 0;
    return detail.productMaterials.reduce((sum, pm) => {
      const q = Math.round(Number(pm.usageQty));
      return sum + (Number.isFinite(q) ? q : 0);
    }, 0);
  }, [detail?.productMaterials]);

  /** 弹窗标题：商品型号/编号 + BOM表 */
  const bomModalTitle = useMemo(() => {
    if (!detail) return "BOM表";
    const name =
      detail.model?.trim() ||
      detail.customerMaterialCode?.trim() ||
      "商品";
    return `${name} BOM表`;
  }, [detail]);

  const renderBomModalSummary = useCallback(() => {
    const cols = visibleBomMaterialColumns;
    const uIdx = cols.findIndex((c) => c.key === "usageQty");
    if (uIdx < 0) return null;
    const cells: ReactNode[] = [];
    if (uIdx === 0) {
      cells.push(
        <Table.Summary.Cell key="bom-uq" index={0}>
          <Typography.Text type="secondary">用量合计 </Typography.Text>
          <Typography.Text strong>{bomViewUsageTotal}</Typography.Text>
        </Table.Summary.Cell>,
      );
      for (let i = 1; i < cols.length; i++) {
        cells.push(<Table.Summary.Cell key={`bom-rest-${i}`} index={i} />);
      }
    } else {
      cells.push(
        <Table.Summary.Cell key="bom-lbl" index={0} colSpan={uIdx} align="right">
          <Typography.Text type="secondary">用量合计</Typography.Text>
        </Table.Summary.Cell>,
      );
      for (let i = uIdx; i < cols.length; i++) {
        const col = cols[i];
        if (col.key === "usageQty") {
          cells.push(
            <Table.Summary.Cell key="bom-uq" index={i}>
              <Typography.Text strong>{bomViewUsageTotal}</Typography.Text>
            </Table.Summary.Cell>,
          );
        } else {
          cells.push(<Table.Summary.Cell key={`bom-rest-${i}`} index={i} />);
        }
      }
    }
    return (
      <Table.Summary fixed>
        <Table.Summary.Row>{cells}</Table.Summary.Row>
      </Table.Summary>
    );
  }, [visibleBomMaterialColumns, bomViewUsageTotal]);

  const uploadProductImage = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const data = await fetchJson<{ url: string }>("/api/upload/product-sample", {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    return data.url;
  };

  const addUploadProps: UploadProps = useMemo(
    () => ({
      listType: "picture-card",
      accept: "image/jpeg,image/bmp",
      maxCount: 5,
      fileList: sampleUrls.map((url, i) => ({
        uid: `${url}-${i}`,
        name: `图${i + 1}`,
        status: "done",
        url,
      })),
      beforeUpload: (file) => {
        if (sampleUrls.length >= 5) return Upload.LIST_IGNORE;
        const t = file.type;
        if (t !== "image/jpeg" && t !== "image/bmp") {
          message.error("仅支持 JPEG、BMP");
          return Upload.LIST_IGNORE;
        }
        return true;
      },
      customRequest: async ({ file, onError, onSuccess }) => {
        try {
          const url = await uploadProductImage(file as File);
          setSampleUrls((prev) => [...prev, url].slice(0, 5));
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
    [sampleUrls, message],
  );

  const editUploadProps: UploadProps = useMemo(
    () => ({
      listType: "picture-card",
      accept: "image/jpeg,image/bmp",
      maxCount: 5,
      fileList: editSamples.map((url, i) => ({
        uid: `${url}-e-${i}`,
        name: `图${i + 1}`,
        status: "done",
        url,
      })),
      beforeUpload: (file) => {
        if (editSamples.length >= 5) return Upload.LIST_IGNORE;
        const t = file.type;
        if (t !== "image/jpeg" && t !== "image/bmp") {
          message.error("仅支持 JPEG、BMP");
          return Upload.LIST_IGNORE;
        }
        return true;
      },
      customRequest: async ({ file, onError, onSuccess }) => {
        try {
          const url = await uploadProductImage(file as File);
          setEditSamples((prev) => [...prev, url].slice(0, 5));
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
    [editSamples, message],
  );

  const closeAddModal = () => {
    setAddOpen(false);
    addForm.resetFields();
    setSampleUrls([]);
    setAddBomLines([]);
    setAddBomOutsource([]);
    setAddBomInhouse([]);
  };

  const openCreateProduct = () => {
    setSampleUrls([]);
    setAddBomLines([]);
    setAddBomOutsource([]);
    setAddBomInhouse([]);
    const defUnit =
      presets?.units.find((u) => u.isDefault)?.name ??
      presets?.units.find((u) => u.name === "PCS")?.name ??
      "PCS";
    addFormFieldsPendingRef.current = {
      unit: defUnit,
      processingMode: "INHOUSE" as ProductProcessingMode,
    };
    setAddOpen(true);
  };

  const submitAdd = async () => {
    let v: Record<string, unknown>;
    try {
      v = await addForm.validateFields();
    } catch {
      return;
    }
    const mode = (v.processingMode as ProductProcessingMode) ?? "INHOUSE";
    const isHybrid = mode === "OUTSOURCE_INHOUSE";
    const filled = isHybrid
      ? {
          o: addBomOutsource.filter((l) => l.materialId),
          i: addBomInhouse.filter((l) => l.materialId),
        }
      : { o: addBomLines.filter((l) => l.materialId), i: [] as BomLine[] };
    const allFilled = isHybrid
      ? [...filled.o, ...filled.i]
      : filled.o;
    if (allFilled.length === 0) {
      message.error("请至少添加一条物料并选择系统物料");
      return;
    }
    if (isHybrid && (filled.o.length === 0 || filled.i.length === 0)) {
      message.error("外发+自加工 请在外发物料、自加工物料两栏中各至少添加一条");
      return;
    }
    if (
      allFilled.some((l) => {
        const q = Math.round(Number(l.usageQty));
        return !Number.isFinite(q) || q < 1;
      })
    ) {
      message.error("每条物料的用量须为正整数");
      return;
    }
    const materials = isHybrid
      ? [
          ...filled.o.map((l) => ({
            materialId: l.materialId as string,
            usageQty: Math.max(1, Math.round(Number(l.usageQty))),
            scope: "OUTSOURCE" as const,
          })),
          ...filled.i.map((l) => ({
            materialId: l.materialId as string,
            usageQty: Math.max(1, Math.round(Number(l.usageQty))),
            scope: "INHOUSE" as const,
          })),
        ]
      : filled.o.map((l) => ({
          materialId: l.materialId as string,
          usageQty: Math.max(1, Math.round(Number(l.usageQty))),
        }));
    try {
      await fetchJson<{ id: string }>("/api/products", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...v,
          imageUrls: sampleUrls,
          materials,
        }),
      });
      message.success("商品已保存");
      closeAddModal();
      await loadProducts();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    }
  };

  const openEdit = async (id: string) => {
    setEditingId(id);
    try {
      const d = await fetchJson<DetailPayload>(`/api/products/${id}`, {
        credentials: "include",
      });
      editFormFieldsPendingRef.current = {
        customerId: d.customerId,
        customerMaterialCode: d.customerMaterialCode,
        machineModel: d.machineModel,
        model: d.model,
        processingMode: d.processingMode ?? "INHOUSE",
        spec: d.spec,
        unit: d.unit,
        price: Number(d.price),
        processingCost: Number(d.processingCost),
        safetyStock: Number(d.safetyStock),
        maxStock: Number(d.maxStock),
        productRemark: d.productRemark,
        inspectionNotes: d.inspectionNotes,
      };
      setEditSamples(d.imageUrls ?? []);
      const pms = d.productMaterials ?? [];
      if (d.processingMode === "OUTSOURCE_INHOUSE") {
        setEditBomOutsource(
          pms
            .filter((pm) => pm.scope === "OUTSOURCE")
            .map((pm) => ({
              key: pm.id,
              materialId: pm.material.id,
              usageQty: Math.max(1, Math.round(Number(pm.usageQty))),
              name: pm.material.name,
              partDescription: pm.material.partDescription,
              unit: pm.material.unit,
              supplierLabel: `${pm.material.supplier.code} ${pm.material.supplier.name}`,
              bomScope: "OUTSOURCE" as const,
            })),
        );
        setEditBomInhouse(
          pms
            .filter((pm) => pm.scope === "INHOUSE")
            .map((pm) => ({
              key: pm.id,
              materialId: pm.material.id,
              usageQty: Math.max(1, Math.round(Number(pm.usageQty))),
              name: pm.material.name,
              partDescription: pm.material.partDescription,
              unit: pm.material.unit,
              supplierLabel: `${pm.material.supplier.code} ${pm.material.supplier.name}`,
              bomScope: "INHOUSE" as const,
            })),
        );
        setEditBomLines([]);
      } else {
        setEditBomLines(
          pms.map((pm) => ({
            key: pm.id,
            materialId: pm.material.id,
            usageQty: Math.max(1, Math.round(Number(pm.usageQty))),
            name: pm.material.name,
            partDescription: pm.material.partDescription,
            unit: pm.material.unit,
            supplierLabel: `${pm.material.supplier.code} ${pm.material.supplier.name}`,
          })),
        );
        setEditBomOutsource([]);
        setEditBomInhouse([]);
      }
      setEditingProductInfo({
        isDeprecated: d.isDeprecated,
        customerMaterialCode: d.customerMaterialCode,
        model: d.model,
      });
      setEditOpen(true);
    } catch (e) {
      editFormFieldsPendingRef.current = null;
      setEditingId(null);
      setEditingProductInfo(null);
      message.error(e instanceof Error ? e.message : "加载失败");
    }
  };

  const submitEdit = async () => {
    const v = await editForm.validateFields();
    if (!editingId) return;
    const savedId = editingId;
    const mode = (v.processingMode as ProductProcessingMode) ?? "INHOUSE";
    const isHybrid = mode === "OUTSOURCE_INHOUSE";
    const filled = isHybrid
      ? {
          o: editBomOutsource.filter((l) => l.materialId),
          i: editBomInhouse.filter((l) => l.materialId),
        }
      : { o: editBomLines.filter((l) => l.materialId), i: [] as BomLine[] };
    const allFilled = isHybrid ? [...filled.o, ...filled.i] : filled.o;
    if (isHybrid && (filled.o.length === 0 || filled.i.length === 0)) {
      message.error("外发+自加工 请在外发物料、自加工物料两栏中各至少保留一条");
      return;
    }
    if (!isHybrid && filled.o.length === 0) {
      message.error("请至少保留一条 BOM 物料");
      return;
    }
    if (
      allFilled.some((l) => {
        const q = Math.round(Number(l.usageQty));
        return !Number.isFinite(q) || q < 1;
      })
    ) {
      message.error("每条已选物料的用量须为正整数");
      return;
    }
    const materials = isHybrid
      ? [
          ...filled.o.map((l) => ({
            materialId: l.materialId as string,
            usageQty: Math.max(1, Math.round(Number(l.usageQty))),
            scope: "OUTSOURCE" as const,
          })),
          ...filled.i.map((l) => ({
            materialId: l.materialId as string,
            usageQty: Math.max(1, Math.round(Number(l.usageQty))),
            scope: "INHOUSE" as const,
          })),
        ]
      : filled.o.map((l) => ({
          materialId: l.materialId as string,
          usageQty: Math.max(1, Math.round(Number(l.usageQty))),
        }));
    try {
      await fetchJson(`/api/products/${savedId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...v,
          imageUrls: editSamples,
          materials,
        }),
      });
      message.success("已保存");
      setEditOpen(false);
      setEditingId(null);
      setEditingProductInfo(null);
      setEditBomLines([]);
      setEditBomOutsource([]);
      setEditBomInhouse([]);
      await loadProducts();
      await loadInventory({}, { deprecatedOnly: tab === "deprecated" });
      if (detail?.id === savedId) {
        void openDetail(savedId);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  const onDelete = (r: ProductRow) => {
    modal.confirm({
      title: "确认删除该商品？将同时删除其入库记录及包含物料关联。",
      okType: "danger",
      onOk: async () => {
        try {
          await fetchJson(`/api/products/${r.id}`, {
            method: "DELETE",
            credentials: "include",
          });
        } catch (e) {
          message.error(e instanceof Error ? e.message : "删除失败");
          return;
        }
        message.success("已删除");
        await loadProducts();
        await loadInventory({}, { deprecatedOnly: tab === "deprecated" });
      },
    });
  };

  const deprecateFromEdit = () => {
    if (!editingId || !editingProductInfo) return;
    modal.confirm({
      title: `确认弃用商品「${editingProductInfo.customerMaterialCode || "—"} ${editingProductInfo.model || ""}」？`,
      content: "弃用后该商品将不再出现在常规商品列表，可在「弃用商品查询」中查看。",
      okType: "danger",
      okText: "确认弃用",
      onOk: async () => {
        setDeprecating(true);
        try {
          await fetchJson(`/api/products/${editingId}/deprecate`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          message.success("已弃用");
          setEditOpen(false);
          setEditingId(null);
          setEditingProductInfo(null);
          setEditBomLines([]);
          setEditBomOutsource([]);
          setEditBomInhouse([]);
          await loadProducts();
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
    if (!editingId || !editingProductInfo) return;
    modal.confirm({
      title: `确认删除商品「${editingProductInfo.customerMaterialCode || "—"} ${editingProductInfo.model || ""}」？`,
      content: "删除会同时删除其库存流水及BOM关联；若已被业务数据引用，请改为弃用商品。",
      okType: "danger",
      okText: "确认删除",
      onOk: async () => {
        setDeletingFromEdit(true);
        try {
          await fetchJson(`/api/products/${editingId}`, {
            method: "DELETE",
            credentials: "include",
          });
          message.success("已删除");
          setEditOpen(false);
          setEditingId(null);
          setEditingProductInfo(null);
          setEditBomLines([]);
          setEditBomOutsource([]);
          setEditBomInhouse([]);
          await loadProducts();
          await loadInventory({}, { deprecatedOnly: tab === "deprecated" });
        } catch (e) {
          message.error(e instanceof Error ? e.message : "删除失败");
        } finally {
          setDeletingFromEdit(false);
        }
      },
    });
  };

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    setDetail(null);
    setLoadingDetail(true);
    try {
      const data = await fetchJson<DetailPayload>(`/api/products/${id}`, {
        credentials: "include",
      });
      setDetail(data);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoadingDetail(false);
    }
  };

  const detailProductIdQ = searchParams.get("detailProductId");
  useEffect(() => {
    if (!detailProductIdQ) return;
    let cancelled = false;
    void (async () => {
      await openDetail(detailProductIdQ);
      if (!cancelled) router.replace(pathname, { scroll: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [detailProductIdQ, pathname, router]);

  const prodColumns: ColumnsType<ProductRow> = [
    {
      key: "customer",
      title: "客户名称",
      dataIndex: ["customer", "name"],
      ellipsis: true,
    },
    {
      key: "customerMaterialCode",
      title: "物料编号",
      dataIndex: "customerMaterialCode",
      ellipsis: true,
    },
    {
      key: "machineModel",
      title: "机型号",
      dataIndex: "machineModel",
      ellipsis: true,
      render: (t) => t || "—",
    },
    {
      key: "model",
      title: "商品型号",
      dataIndex: "model",
      ellipsis: true,
      render: (t) => t || "—",
    },
    {
      key: "processingMode",
      title: "加工方式",
      dataIndex: "processingMode",
      width: 100,
      render: (m: ProductProcessingMode) => PRODUCT_PROCESSING_LABEL[m] ?? "—",
    },
    {
      key: "spec",
      title: "商品规格",
      dataIndex: "spec",
      ellipsis: true,
      render: (t) => t || "—",
    },
    {
      key: "productImages",
      title: "商品图片",
      dataIndex: "imageUrls",
      render: (urls: string[]) => renderProductThumbs(urls ?? []),
    },
    { key: "unit", title: "单位", dataIndex: "unit", width: 72 },
    { key: "price", title: "价格", dataIndex: "price", width: 100 },
    {
      key: "processingCost",
      title: "加工成本",
      dataIndex: "processingCost",
      width: 100,
    },
    { key: "safetyStock", title: "安全库存", dataIndex: "safetyStock", width: 100 },
    { key: "maxStock", title: "最大库存", dataIndex: "maxStock", width: 100 },
    {
      key: "createdAt",
      title: "日期",
      dataIndex: "createdAt",
      width: 160,
      render: (t: string) => dayjs(t).format("YYYY-MM-DD HH:mm"),
    },
    {
      key: "inspectionNotes",
      title: "注意事项",
      dataIndex: "inspectionNotes",
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      key: "productRemark",
      title: "商品备注",
      dataIndex: "productRemark",
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "操作",
      key: "op",
      width: 140,
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

  const invColumns: ColumnsType<InventoryRow> = [
    {
      key: "customer",
      title: "客户名称",
      dataIndex: ["customer", "name"],
      ellipsis: true,
    },
    {
      key: "customerMaterialCode",
      title: "物料编号",
      dataIndex: "customerMaterialCode",
      ellipsis: true,
    },
    {
      key: "machineModel",
      title: "机型号",
      dataIndex: "machineModel",
      ellipsis: true,
      render: (t) => t || "—",
    },
    {
      key: "model",
      title: "商品型号",
      dataIndex: "model",
      ellipsis: true,
      render: (t) => t || "—",
    },
    {
      key: "processingMode",
      title: "加工方式",
      dataIndex: "processingMode",
      width: 100,
      render: (m: ProductProcessingMode) => PRODUCT_PROCESSING_LABEL[m] ?? "—",
    },
    {
      key: "spec",
      title: "商品规格",
      dataIndex: "spec",
      ellipsis: true,
      render: (t) => t || "—",
    },
    {
      key: "productImages",
      title: "商品图片",
      dataIndex: "imageUrls",
      render: (urls: string[]) => renderProductThumbs(urls ?? []),
    },
    { key: "unit", title: "单位", dataIndex: "unit", width: 72 },
    { key: "price", title: "价格", dataIndex: "price", width: 100 },
    {
      key: "processingCost",
      title: "加工成本",
      dataIndex: "processingCost",
      width: 100,
    },
    { key: "safetyStock", title: "安全库存", dataIndex: "safetyStock", width: 100 },
    { key: "maxStock", title: "最大库存", dataIndex: "maxStock", width: 100 },
    {
      key: "createdAt",
      title: "日期",
      dataIndex: "createdAt",
      width: 160,
      render: (t: string) => dayjs(t).format("YYYY-MM-DD HH:mm"),
    },
    {
      key: "inspectionNotes",
      title: "注意事项",
      dataIndex: "inspectionNotes",
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      key: "productRemark",
      title: "商品备注",
      dataIndex: "productRemark",
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      key: "totalQty",
      title: "库存数量",
      dataIndex: "totalQty",
      width: 96,
      render: (v: number, r) => {
        const safety = Number(r.safetyStock ?? 0);
        const max = Number(r.maxStock ?? 0);
        if (Number.isFinite(safety) && safety > 0 && v < safety) {
          return <Typography.Text type="danger">{v}</Typography.Text>;
        }
        if (Number.isFinite(max) && max > 0 && v > max) {
          return <Typography.Text style={{ color: "#389e0d" }}>{v}</Typography.Text>;
        }
        return v;
      },
    },
    {
      key: "lastReceivedAt",
      title: "最近入库",
      dataIndex: "lastReceivedAt",
      width: 160,
      render: (t: string | null) =>
        t ? dayjs(t).format("YYYY-MM-DD HH:mm") : "—",
    },
    {
      title: "操作",
      key: "d",
      width: 80,
      render: (_, r) => (
        <Button type="link" size="small" onClick={() => void openDetail(r.id)}>
          详情
        </Button>
      ),
    },
  ];

  const visibleProdColumns = prodColumns.filter(
    (col) =>
      col.key === "op" ||
      (typeof col.key === "string" && prodColKeys.includes(col.key)),
  );

  const visibleInvColumns = invColumns.filter(
    (col) =>
      col.key === "d" ||
      (typeof col.key === "string" && invColKeys.includes(col.key)),
  );

  const prodTableColumns = attachResize(
    visibleProdColumns,
    prodColWidths,
    setProdColWidths,
    DEFAULT_PROD_COL_WIDTH,
  );

  const invTableColumns = attachResize(
    visibleInvColumns,
    invColWidths,
    setInvColWidths,
    DEFAULT_INV_COL_WIDTH,
  );

  const exportProductInventoryExcel = useCallback(async () => {
    if (inventory.length === 0) {
      message.warning("当前无数据可导出");
      return;
    }
    const XLSX = await import("xlsx");
    const rows = inventory.map((r) => ({
      客户名称: `${r.customer.code} ${r.customer.name}`,
      物料编号: r.customerMaterialCode,
      机型号: r.machineModel ?? "",
      商品型号: r.model ?? "",
      加工方式: PRODUCT_PROCESSING_LABEL[r.processingMode] ?? "",
      商品规格: r.spec ?? "",
      单位: r.unit,
      价格: r.price,
      加工成本: r.processingCost,
      安全库存: r.safetyStock,
      最大库存: r.maxStock,
      注意事项: r.inspectionNotes ?? "",
      商品备注: r.productRemark ?? "",
      建档日期: dayjs(r.createdAt).format("YYYY-MM-DD HH:mm:ss"),
      库存数量: r.totalQty,
      最近入库: r.lastReceivedAt
        ? dayjs(r.lastReceivedAt).format("YYYY-MM-DD HH:mm:ss")
        : "",
      商品图片链接: (r.imageUrls ?? []).join("；"),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "商品库存");
    XLSX.writeFile(wb, `商品库存_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`);
    message.success("已导出");
  }, [inventory, message]);

  const exportBomExcel = useCallback(async () => {
    if (!detail?.productMaterials?.length) {
      message.warning("暂无 BOM 数据可导出");
      return;
    }
    const XLSX = await import("xlsx");
    const raw =
      detail.model?.trim() ||
      detail.customerMaterialCode?.trim() ||
      "商品";
    const productLabel = raw.replace(/[\\/:*?"<>|]/g, "_");
    const rows = detail.productMaterials.map((pm) => ({
      系统物料编号: pm.material.code,
      BOM归属: bomScopeColLabel(pm.scope),
      物料名称: pm.material.name,
      部件描述: pm.material.partDescription ?? "",
      品牌: pm.material.brand ?? "",
      单位: pm.material.unit,
      单价: pm.material.unitPrice,
      种类: pm.material.kindName,
      供应商: `${pm.material.supplier.code} ${pm.material.supplier.name}`,
      用量: Math.round(Number(pm.usageQty)),
      库存: pm.material.totalQty,
      建档日期: dayjs(pm.material.createdAt).format("YYYY-MM-DD HH:mm"),
      检料注意事项: pm.material.inspectionNotes ?? "",
      签样图链接: (pm.material.sampleImageUrls ?? []).join("；"),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "BOM");
    XLSX.writeFile(
      wb,
      `${productLabel}_BOM_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`,
    );
    message.success("已导出");
  }, [detail, message]);

  const exportInboundExcel = useCallback(async () => {
    if (!detail?.inbounds?.length) {
      message.warning("暂无出入库记录可导出");
      return;
    }
    const XLSX = await import("xlsx");
    const raw =
      detail.model?.trim() ||
      detail.customerMaterialCode?.trim() ||
      "商品";
    const productLabel = raw.replace(/[\\/:*?"<>|]/g, "_");
    const opLabel = (r: ProductInboundRow) =>
      r.operatorName
        ? r.operatorEmployeeNo
          ? `${r.operatorName}（${r.operatorEmployeeNo}）`
          : r.operatorName
        : "";
    const rows = detail.inbounds.map((r) => ({
      类型: productInboundTypeLabel(r),
      数量: r.quantity,
      时间: dayjs(r.receivedAt).format("YYYY-MM-DD HH:mm:ss"),
      采购订单编号: r.purchaseOrderNo ?? "",
      关联销售订单: formatProductInboundSalesLink(r),
      部件描述: r.partDescription ?? "",
      备注: r.remark ?? "",
      操作员: opLabel(r),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "出入库");
    XLSX.writeFile(
      wb,
      `${productLabel}_出入库记录_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`,
    );
    message.success("已导出");
  }, [detail, message]);

  const showInventoryFilter =
    tab === "inventory" || tab === "stockAdjust" || tab === "deprecated";

  const openStockAdjust = (r: InventoryRow) => {
    setStockAdjustTarget(r);
    stockAdjustForm.resetFields();
    setStockAdjustOpen(true);
  };

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
      await fetchJson(`/api/products/${stockAdjustTarget.id}/stock-adjust`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delta: v.delta,
          remark: v.remark?.trim() || null,
        }),
      });
      message.success("库存已按盘点结果调整");
      const productId = stockAdjustTarget.id;
      setStockAdjustOpen(false);
      setStockAdjustTarget(null);
      await loadInventory(
        (await filterForm.validateFields().catch(() => ({}))) as Record<string, unknown>,
        { deprecatedOnly: tab === "deprecated" },
      );
      if (detail?.id === productId) {
        void openDetail(productId);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "调整失败");
    } finally {
      setStockAdjustSubmitting(false);
    }
  };

  const { loading: tabPermLoading, allowed } = useMeTabPermissions();

  const visibleProductTabKeys = useMemo(
    () =>
      (["add", "inventory", "stockAdjust", "deprecated"] as const).filter((k) =>
        allowed([PRODUCT_TAB_PERM[k]]),
      ),
    [allowed],
  );

  useEffect(() => {
    if (tabPermLoading) return;
    if (visibleProductTabKeys.length === 0) return;
    const keys = visibleProductTabKeys as readonly string[];
    if (!keys.includes(tab)) {
      setTab(keys[0] ?? "add");
    }
  }, [tabPermLoading, visibleProductTabKeys, tab]);

  return (
    <Card title="商品信息">
      {tabPermLoading ? (
        <div style={{ padding: 56, textAlign: "center" }}>
          <Spin size="large" />
        </div>
      ) : visibleProductTabKeys.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          当前账号无可用的商品信息 TAB，请联系管理员在「员工管理 → 权限管理」中勾选对应 TAB。
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
          <Form.Item name="customerId" label="客户">
            <Select
              allowClear
              placeholder="全部"
              style={{ width: 180 }}
              showSearch
              optionFilterProp="label"
              options={(presets?.customers ?? []).map((c) => ({
                value: c.id,
                label: `${c.code} ${c.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="productModel" label="商品型号">
            <Input allowClear placeholder="模糊" style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="materialCode" label="客户物料编号">
            <Input allowClear placeholder="模糊" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="productDescription" label="商品描述">
            <Input allowClear placeholder="模糊查询" style={{ width: 160 }} />
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
          if (k === "add" || k === "inventory" || k === "stockAdjust" || k === "deprecated") {
            void loadPresets();
          }
        }}
        items={[
          {
            key: "add",
            label: "新增商品",
            children: (
              <Space direction="vertical" size="large" style={{ width: "100%" }}>
                <Space style={{ marginBottom: 0 }} wrap>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={openCreateProduct}
                    disabled={loadingPresets}
                  >
                    新增商品
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
                    已建档商品（当日）
                  </Typography.Title>
                  <Space size={8}>
                    <ColumnSettingButton
                      options={PROD_COL_OPTIONS}
                      value={prodColKeys}
                      onChange={setProdColKeys}
                    />
                    <HelpTip text="下方列表仅显示当天新建的商品档案；日期在保存时自动生成。“物料编号”为客户下单提供编号（手工录入），非系统物料档案编号；商品图请在编辑中上传。" />
                  </Space>
                </div>
                <Table<ProductRow>
                  rowKey="id"
                  loading={loadingProd}
                  columns={prodTableColumns}
                  dataSource={products}
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
            label: "商品库存",
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
                    pageSize: 10,
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
                    onClick={() => void exportProductInventoryExcel()}
                  >
                    导出 Excel
                  </Button>
                </div>
              </Space>
            ),
          },
          {
            key: "stockAdjust",
            label: "手动调整",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
                  <HelpTip text="本页为成品库存盘点与档案维护入口：可录入与系统当前库存的差额（可增可减，保存后记为盘点调整流水），或打开“修改商品”编辑 BOM/图片等。列表与当前商品库存页查询条件保持一致。" />
                </div>
                <Table<InventoryRow>
                  rowKey="id"
                  loading={loadingInv}
                  columns={[
                    {
                      title: "客户",
                      key: "cust",
                      ellipsis: true,
                      render: (_, r) => r.customer.name,
                    },
                    {
                      title: "客户物料编号",
                      dataIndex: "customerMaterialCode",
                      key: "customerMaterialCode",
                      ellipsis: true,
                      width: 120,
                    },
                    { title: "商品型号", dataIndex: "model", key: "model", ellipsis: true, width: 120 },
                    {
                      title: "商品规格",
                      dataIndex: "spec",
                      key: "spec",
                      ellipsis: true,
                      render: (v: string) => v || "—",
                    },
                    {
                      title: "当前库存",
                      dataIndex: "totalQty",
                      key: "q",
                      width: 88,
                      align: "right" as const,
                    },
                    {
                      title: "操作",
                      key: "op",
                      width: 160,
                      render: (_, r) => (
                        <Space size={0} wrap>
                          <Button type="link" size="small" onClick={() => openStockAdjust(r)}>
                            调整
                          </Button>
                          <Button
                            type="link"
                            size="small"
                            onClick={() => void openEdit(r.id)}
                          >
                            修改商品
                          </Button>
                        </Space>
                      ),
                    },
                  ]}
                  dataSource={inventory}
                  pagination={{
                    pageSize: 10,
                    showSizeChanger: true,
                    pageSizeOptions: [10, 20, 50, 100],
                  }}
                  scroll={{ x: 900 }}
                />
              </Space>
            ),
          },
          {
            key: "deprecated",
            label: "弃用商品查询",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
                  <HelpTip text="仅展示已弃用商品；用于查询历史旧商品及其库存。" />
                </div>
                <Table<InventoryRow>
                  rowKey="id"
                  loading={loadingInv}
                  columns={[
                    {
                      title: "客户",
                      key: "cust",
                      ellipsis: true,
                      render: (_, r) => r.customer.name,
                    },
                    {
                      title: "客户物料编号",
                      dataIndex: "customerMaterialCode",
                      key: "customerMaterialCode",
                      ellipsis: true,
                      width: 120,
                    },
                    { title: "商品型号", dataIndex: "model", key: "model", ellipsis: true, width: 120 },
                    {
                      title: "商品规格",
                      dataIndex: "spec",
                      key: "spec",
                      ellipsis: true,
                      render: (v: string) => v || "—",
                    },
                    {
                      title: "当前库存",
                      dataIndex: "totalQty",
                      key: "q",
                      width: 88,
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
                    pageSize: 10,
                    showSizeChanger: true,
                    pageSizeOptions: [10, 20, 50, 100],
                  }}
                  scroll={{ x: 980 }}
                />
              </Space>
            ),
          },
        ].filter((item) => {
          const code = PRODUCT_TAB_PERM[String(item.key)];
          return code ? allowed([code]) : false;
        })}
      />
        </>
      )}

      <Modal
        title="手动调整商品库存"
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
              {stockAdjustTarget.customer.name} · {stockAdjustTarget.model}
            </Typography.Paragraph>
            <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
              当前系统成品库存合计：<strong>{stockAdjustTarget.totalQty}</strong> {stockAdjustTarget.unit}
              （与商品库存、出入库流水汇总规则一致）
            </Typography.Text>
            <Form.Item
              name="delta"
              label="调整数量"
              extra="正数为增加、负数为减少；保存后 = 原合计 + 本值。不得使库存为负。"
              rules={[
                { required: true, message: "请填写调整数量" },
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
            <Form.Item name="remark" label="备注（可选，记入流水备注）">
              <Input.TextArea rows={2} placeholder="可注明盘点人、单号等" allowClear maxLength={500} showCount />
            </Form.Item>
          </Form>
        ) : null}
      </Modal>

      <Modal
        title="新增商品"
        open={addOpen}
        onCancel={closeAddModal}
        onOk={() => void submitAdd()}
        width={addProcessingMode === "OUTSOURCE_INHOUSE" ? 1450 : 1080}
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
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="customerId"
                label="客户名称"
                rules={[{ required: true, message: "请选择客户" }]}
              >
                <Select
                  placeholder="选择客户"
                  showSearch
                  optionFilterProp="label"
                  options={(presets?.customers ?? []).map((c) => ({
                    value: c.id,
                    label: `${c.code} ${c.name}`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="customerMaterialCode"
                label="物料编号"
                rules={[{ required: true, message: "请填写客户物料编号" }]}
                extra="客户下单时提供的物料编号，非本系统物料档案中的编号"
              >
                <Input placeholder="手工录入客户侧编号" allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="machineModel" label="机型号">
                <Input placeholder="可选" allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="model" label="商品型号">
                <Input placeholder="可选" allowClear />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item
                name="processingMode"
                label="加工方式"
                initialValue="INHOUSE"
              >
                <Radio.Group optionType="button" buttonStyle="solid">
                  <Radio.Button value="INHOUSE">自加工</Radio.Button>
                  <Radio.Button value="OUTSOURCE">外发加工</Radio.Button>
                  <Radio.Button value="OUTSOURCE_INHOUSE">外发+自加工</Radio.Button>
                </Radio.Group>
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="spec" label="商品规格">
                <Input.TextArea rows={2} placeholder="可选" allowClear />
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
            <Col xs={24} sm={12}>
              <Form.Item
                name="price"
                label="价格"
                rules={[{ required: true, message: "请填写价格" }]}
              >
                <InputNumber
                  min={0}
                  precision={4}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="processingCost" label="加工成本">
                <InputNumber min={0} precision={4} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="safetyStock" label="安全库存">
                <InputNumber min={0} precision={0} step={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="maxStock" label="最大库存">
                <InputNumber min={0} precision={0} step={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="productRemark" label="商品备注">
                <Input.TextArea rows={2} placeholder="可选" allowClear />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="inspectionNotes" label="注意事项（检料查看）">
                <Input.TextArea rows={3} placeholder="可选" />
              </Form.Item>
            </Col>
          </Row>
          {addProcessingMode === "OUTSOURCE_INHOUSE" ? (
            <Row gutter={[16, 16]} style={{ width: "100%" }}>
              <Col xs={24} lg={12}>
                <ProductBomTable
                  sectionTitle="外发物料"
                  lineScope="OUTSOURCE"
                  lines={addBomOutsource}
                  setLines={setAddBomOutsource}
                  materialOptions={materialOptions}
                />
              </Col>
              <Col xs={24} lg={12}>
                <ProductBomTable
                  sectionTitle="自加工物料"
                  lineScope="INHOUSE"
                  lines={addBomInhouse}
                  setLines={setAddBomInhouse}
                  materialOptions={materialOptions}
                />
              </Col>
            </Row>
          ) : (
            <ProductBomTable
              lines={addBomLines}
              setLines={setAddBomLines}
              materialOptions={materialOptions}
            />
          )}
          <Form.Item label="商品图片（JPEG / BMP，最多 5 张）">
            <Upload {...addUploadProps}>
              {sampleUrls.length >= 5 ? null : (
                <div>
                  <UploadOutlined />
                  <div style={{ marginTop: 8 }}>上传</div>
                </div>
              )}
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑商品"
        open={editOpen}
        onCancel={() => {
          setEditOpen(false);
          setEditingId(null);
          setEditingProductInfo(null);
          setEditBomLines([]);
          setEditBomOutsource([]);
          setEditBomInhouse([]);
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
                disabled={!editingId || Boolean(editingProductInfo?.isDeprecated)}
              >
                弃用商品
              </Button>
            </Space>
            <Space>
              <CancelBtn />
              <OkBtn />
            </Space>
          </div>
        )}
        width={editProcessingMode === "OUTSOURCE_INHOUSE" ? 1100 : 800}
        destroyOnHidden
        afterOpenChange={(open) => {
          if (open && editFormFieldsPendingRef.current) {
            editForm.setFieldsValue(editFormFieldsPendingRef.current);
            editFormFieldsPendingRef.current = null;
          }
        }}
      >
        <Form form={editForm} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="customerId"
                label="客户名称"
                rules={[{ required: true, message: "请选择客户" }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={(presets?.customers ?? []).map((c) => ({
                    value: c.id,
                    label: `${c.code} ${c.name}`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="customerMaterialCode"
                label="物料编号"
                rules={[{ required: true, message: "请填写客户物料编号" }]}
                extra="客户下单时提供的物料编号，非本系统物料档案中的编号"
              >
                <Input allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="machineModel" label="机型号">
                <Input allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="model" label="商品型号">
                <Input allowClear />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="processingMode" label="加工方式">
                <Radio.Group optionType="button" buttonStyle="solid">
                  <Radio.Button value="INHOUSE">自加工</Radio.Button>
                  <Radio.Button value="OUTSOURCE">外发加工</Radio.Button>
                  <Radio.Button value="OUTSOURCE_INHOUSE">外发+自加工</Radio.Button>
                </Radio.Group>
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="spec" label="商品规格">
                <Input.TextArea rows={2} allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="unit"
                label="单位"
                rules={[{ required: true, message: "请选择单位" }]}
              >
                <Select
                  options={(presets?.units ?? []).map((u) => ({
                    value: u.name,
                    label: u.name,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="price"
                label="价格"
                rules={[{ required: true, message: "请填写价格" }]}
              >
                <InputNumber
                  min={0}
                  precision={4}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="processingCost" label="加工成本">
                <InputNumber min={0} precision={4} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="safetyStock" label="安全库存">
                <InputNumber min={0} precision={0} step={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="maxStock" label="最大库存">
                <InputNumber min={0} precision={0} step={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="productRemark" label="商品备注">
                <Input.TextArea rows={2} allowClear />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="inspectionNotes" label="注意事项（检料查看）">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
          </Row>
          {editProcessingMode === "OUTSOURCE_INHOUSE" ? (
            <Row gutter={[16, 16]} style={{ width: "100%" }}>
              <Col xs={24} lg={12}>
                <ProductBomTable
                  sectionTitle="外发物料"
                  lineScope="OUTSOURCE"
                  lines={editBomOutsource}
                  setLines={setEditBomOutsource}
                  materialOptions={materialOptions}
                />
              </Col>
              <Col xs={24} lg={12}>
                <ProductBomTable
                  sectionTitle="自加工物料"
                  lineScope="INHOUSE"
                  lines={editBomInhouse}
                  setLines={setEditBomInhouse}
                  materialOptions={materialOptions}
                />
              </Col>
            </Row>
          ) : (
            <ProductBomTable
              lines={editBomLines}
              setLines={setEditBomLines}
              materialOptions={materialOptions}
            />
          )}
          <Form.Item label="商品图片（最多 5 张）">
            <Upload {...editUploadProps}>
              {editSamples.length >= 5 ? null : (
                <div>
                  <UploadOutlined />
                  <div style={{ marginTop: 8 }}>上传</div>
                </div>
              )}
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="商品详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
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
                    <strong>客户：</strong>
                    {detail.customer.code} {detail.customer.name}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <strong>物料编号（客户下单编号）：</strong>
                    {detail.customerMaterialCode || "—"}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <strong>机型号：</strong>
                    {detail.machineModel?.trim() || "—"}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <strong>商品型号：</strong>
                    {detail.model || "—"}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 0 }}>
                    <strong>加工方式：</strong>
                    {PRODUCT_PROCESSING_LABEL[detail.processingMode] ?? "—"}
                  </Typography.Paragraph>
                </Space>
              </Col>
              <Col xs={24} md={12}>
                <Space direction="vertical" size="small" style={{ width: "100%" }}>
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <strong>商品规格：</strong>
                    {detail.spec || "—"}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <strong>单位 / 价格 / 加工成本：</strong>
                    {detail.unit} / {detail.price} / {detail.processingCost}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <strong>安全库存 / 最大库存：</strong>
                    {detail.safetyStock} / {detail.maxStock}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 4 }}>
                    <strong>建档日期：</strong>
                    {dayjs(detail.createdAt).format("YYYY-MM-DD HH:mm")}
                  </Typography.Paragraph>
                  <Typography.Paragraph style={{ marginBottom: 0 }}>
                    <strong>库存合计：</strong>
                    {detail.totalQty}
                  </Typography.Paragraph>
                </Space>
              </Col>
              <Col span={24}>
                <div style={{ marginBottom: 8 }}>
                  <Button
                    type="link"
                    style={{ paddingLeft: 0 }}
                    onClick={() => setMaterialsDetailOpen(true)}
                  >
                    查看BOM
                  </Button>
                  <Typography.Text type="secondary">
                    （{detail.productMaterials?.length ?? 0} 条）
                  </Typography.Text>
                </div>
                <Typography.Paragraph style={{ marginBottom: 8 }}>
                  <strong>商品备注：</strong>
                  {detail.productRemark?.trim() || "—"}
                </Typography.Paragraph>
                <Typography.Paragraph style={{ marginBottom: 0 }}>
                  <strong>注意事项：</strong>
                  {detail.inspectionNotes ?? "—"}
                </Typography.Paragraph>
              </Col>
            </Row>
            {detail.imageUrls.length > 0 ? (
              <div>
                <Typography.Text strong>商品图片</Typography.Text>
                <div style={{ marginTop: 8 }}>
                  <Image.PreviewGroup>
                    <Space wrap>
                      {detail.imageUrls.map((u) => (
                        <Image
                          key={u}
                          src={u}
                          alt="商品"
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
              出入库记录
            </Typography.Title>
            <Table<ProductInboundRow>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={detail.inbounds ?? []}
              scroll={{ x: 1100 }}
              columns={[
                {
                  title: "类型",
                  key: "etype",
                  width: 92,
                  render: (_, row) => productInboundTypeLabel(row),
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
                  width: 150,
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
                {
                  title: "采购订单编号",
                  dataIndex: "purchaseOrderNo",
                  width: 140,
                  ellipsis: true,
                  render: (v: string | null) => v ?? "—",
                },
                {
                  title: "关联销售订单",
                  key: "salesLink",
                  width: 140,
                  ellipsis: true,
                  render: (_: unknown, r: ProductInboundRow) =>
                    formatProductInboundSalesLink(r),
                },
                {
                  title: "部件描述",
                  dataIndex: "partDescription",
                  ellipsis: true,
                  render: (v: string | null) => v ?? "—",
                },
                {
                  title: "备注",
                  dataIndex: "remark",
                  ellipsis: true,
                  render: (v: string | null) => v ?? "—",
                },
              ]}
            />
          </Space>
        ) : null}
      </Modal>

      <Modal
        title={bomModalTitle}
        open={materialsDetailOpen}
        onCancel={() => setMaterialsDetailOpen(false)}
        footer={
          <Space>
            <Button
              icon={<FileExcelOutlined />}
              onClick={() => void exportBomExcel()}
            >
              导出BOM
            </Button>
            <Button type="primary" onClick={() => setMaterialsDetailOpen(false)}>
              关闭
            </Button>
          </Space>
        }
        width={1400}
        style={{ top: 32 }}
        styles={{ body: { maxHeight: "min(70vh, 720px)", overflowY: "auto" } }}
        destroyOnHidden
      >
        {detail ? (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                width: "100%",
              }}
            >
              <ColumnSettingButton
                options={BOM_MATERIAL_COL_OPTIONS}
                value={bomMatColKeys}
                onChange={onBomMatColKeysChange}
              />
            </div>
            <Table<ProductMaterialItem>
              size="small"
              rowKey="id"
              scroll={{ x: "max-content" }}
              pagination={false}
              dataSource={detail.productMaterials ?? []}
              columns={visibleBomMaterialColumns}
              summary={renderBomModalSummary}
            />
          </Space>
        ) : null}
      </Modal>
    </Card>
  );
}
