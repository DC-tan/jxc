"use client";

import { PlusOutlined, SettingOutlined } from "@ant-design/icons";
import {
  App,
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
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ResizeCallbackData } from "react-resizable";
import type {
  Dispatch,
  Key,
  ReactNode,
  SetStateAction,
  SyntheticEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ResizableTableTitle } from "@/components/ResizableTableTitle";
import { fetchJson } from "@/lib/fetch-json";
import { useMeTabPermissions } from "@/lib/use-me-tab-permissions";

const SALES_TAB_PERM: Record<string, string> = {
  add: "tab.sales.add",
  pending: "tab.sales.undelivered",
  query: "tab.sales.query",
};

type CustomerOpt = { id: string; code: string; name: string };

type ProductOpt = {
  id: string;
  customerId: string;
  customerMaterialCode: string;
  machineModel: string;
  model: string;
  spec: string;
  unit: string;
  price: string;
  inspectionNotes: string | null;
  productRemark: string | null;
  imageUrls: string[];
  customer: CustomerOpt;
};

type SalesPresetBundle = {
  customers: CustomerOpt[];
  products: ProductOpt[];
};

type SalesOrderRow = {
  id: string;
  customerOrderNo: string;
  customerModel: string;
  deliveryDueAt: string | null;
  actualDeliveredAt: string | null;
  totalAmount: string;
  remark: string | null;
  customer: CustomerOpt;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
};

type SoLine = {
  key: string;
  productId: string | undefined;
  quantity: number;
  unitPrice: number;
  remark: string;
};

type DetailLine = {
  id: string;
  quantity: string;
  unitPrice: string;
  remark: string | null;
  product: {
    id: string;
    customerMaterialCode: string;
    model: string;
    spec: string;
    unit: string;
    price: string;
    inspectionNotes: string | null;
    imageUrls: string[];
  };
};

type DetailPayload = {
  id: string;
  customerOrderNo: string;
  customerModel: string;
  deliveryDueAt: string | null;
  actualDeliveredAt: string | null;
  totalAmount: string;
  remark: string | null;
  customer: CustomerOpt;
  createdAt: string;
  updatedAt: string;
  lines: DetailLine[];
};

function newLineKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const LS_SO_LINE_COLS = "sales.soLine.visibleCols.v3";

const SO_LINE_COL_OPTIONS: { label: string; value: string }[] = [
  { label: "物料编号", value: "materialCode" },
  { label: "商品型号", value: "model" },
  { label: "商品规格", value: "spec" },
  { label: "商品图片", value: "productImages" },
  { label: "单位", value: "unit" },
  { label: "注意事项", value: "notes" },
  { label: "数量", value: "qty" },
  { label: "单价", value: "price" },
  { label: "金额", value: "lineAmount" },
  { label: "备注", value: "lineRemark" },
];

const SO_LINE_ALL_KEYS = SO_LINE_COL_OPTIONS.map((o) => o.value);

const DEFAULT_SO_LINE_COL_WIDTH: Record<string, number> = {
  materialCode: 168,
  model: 168,
  spec: 180,
  productImages: 108,
  unit: 64,
  notes: 140,
  qty: 104,
  price: 104,
  lineAmount: 104,
  lineRemark: 120,
  op: 72,
};

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
    const set = new Set(
      parsed.filter((x): x is string => typeof x === "string"),
    );
    const kept = allKeys.filter((k) => set.has(k));
    return kept.length > 0 ? kept : fallback;
  } catch {
    return fallback;
  }
}

function attachResizeSoLine<T extends object>(
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
          ? (widths.op ?? defaults.op ?? 72)
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

function SoLineColumnSettingButton({
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
          options={SO_LINE_COL_OPTIONS}
        />
      }
    >
      <Button type="text" icon={<SettingOutlined />} aria-label="列设置" />
    </Popover>
  );
}

function renderLineProductThumbs(urls: string[]) {
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

type ProductMatchField = "material" | "model" | "spec";

/** 按某一维做不区分大小写的前缀匹配（输入为空时不筛选，展示全部可选） */
function productMatchesFieldPrefix(
  p: ProductOpt,
  field: ProductMatchField,
  rawInput: string,
): boolean {
  const q = rawInput.trim();
  if (!q) return true;
  const needle = q.toLowerCase();
  if (field === "material") {
    return (p.customerMaterialCode ?? "")
      .trim()
      .toLowerCase()
      .startsWith(needle);
  }
  if (field === "model") {
    return (p.model ?? "").trim().toLowerCase().startsWith(needle);
  }
  return (p.spec ?? "").trim().toLowerCase().startsWith(needle);
}

/** 该列应展示的单品字段（与商品档案一致，不用拼接串） */
function productFieldDisplay(
  p: ProductOpt,
  field: ProductMatchField,
): string {
  if (field === "material") {
    return (p.customerMaterialCode ?? "").trim() || "—";
  }
  if (field === "model") {
    return (p.model ?? "").trim() || "—";
  }
  return (p.spec ?? "").trim() || "—";
}

/** 历时天数 = 结束日 − 创建日（日历日差） */
function elapsedDaysBetweenCreatedAnd(
  createdIso: string,
  endIso: string | null | undefined,
): string {
  if (!endIso) return "—";
  return String(
    dayjs(endIso)
      .startOf("day")
      .diff(dayjs(createdIso).startOf("day"), "day"),
  );
}

/** 当日 / 未交：可配置列（「操作」始终显示） */
const SALES_ORDER_LIST_COL_OPTIONS: { label: string; value: string }[] = [
  { label: "客户", value: "customer" },
  { label: "客户订单编号", value: "customerOrderNo" },
  { label: "客户机型", value: "customerModel" },
  { label: "金额", value: "totalAmount" },
  { label: "行数", value: "lineCount" },
  { label: "创建时间", value: "createdAt" },
  { label: "要求交货时间", value: "dueAt" },
  { label: "历时", value: "elapsed" },
];

const SALES_ORDER_LIST_ALL_KEYS = SALES_ORDER_LIST_COL_OPTIONS.map((o) => o.value);

/** 未交订单：数据列 + 详情 + 操作（修改/删除），便于后续按列做权限 */
const SALES_ORDER_LIST_COL_OPTIONS_PENDING: { label: string; value: string }[] =
  [
    ...SALES_ORDER_LIST_COL_OPTIONS,
    { label: "详情", value: "detail" },
    { label: "操作", value: "op" },
  ];

const SALES_ORDER_PENDING_LIST_ALL_KEYS =
  SALES_ORDER_LIST_COL_OPTIONS_PENDING.map((o) => o.value);

/** 订单查询：列为实际交货时间；尾列为「详情」 */
const SALES_ORDER_LIST_COL_OPTIONS_QUERY: { label: string; value: string }[] =
  [
    { label: "客户", value: "customer" },
    { label: "客户订单编号", value: "customerOrderNo" },
    { label: "客户机型", value: "customerModel" },
    { label: "金额", value: "totalAmount" },
    { label: "行数", value: "lineCount" },
    { label: "创建时间", value: "createdAt" },
    { label: "实际交货时间", value: "actualAt" },
    { label: "历时", value: "elapsed" },
    { label: "详情", value: "detail" },
  ];

const SALES_ORDER_QUERY_LIST_ALL_KEYS = SALES_ORDER_LIST_COL_OPTIONS_QUERY.map(
  (o) => o.value,
);

const LS_SALES_TODAY_COLS = "sales.orderList.today.cols.v2";
const LS_SALES_PENDING_COLS = "sales.orderList.pending.cols.v3";
const LS_SALES_QUERY_COLS = "sales.orderList.query.cols.v4";

const DEFAULT_SALES_TODAY_WIDTH: Record<string, number> = {
  customer: 168,
  customerOrderNo: 140,
  customerModel: 120,
  totalAmount: 112,
  lineCount: 80,
  createdAt: 168,
  dueAt: 128,
  elapsed: 88,
  op: 140,
};

const DEFAULT_SALES_PENDING_WIDTH: Record<string, number> = {
  ...DEFAULT_SALES_TODAY_WIDTH,
  detail: 72,
  op: 140,
};

const DEFAULT_SALES_QUERY_WIDTH: Record<string, number> = {
  ...DEFAULT_SALES_TODAY_WIDTH,
  actualAt: 128,
  detail: 88,
};

/** 在「金额」列下展示当前列表总金额（与列顺序、勾选列对齐） */
function renderSalesOrderTotalSummary(
  columns: ColumnsType<SalesOrderRow>,
  rows: SalesOrderRow[],
  options: { rowSelection: boolean },
): ReactNode {
  const total = rows.reduce((sum, r) => sum + Number(r.totalAmount || 0), 0);
  const { rowSelection } = options;
  const amountColIndex = columns.findIndex((c) => c.key === "totalAmount");
  const totalColIndex =
    amountColIndex >= 0 ? amountColIndex : Math.max(0, columns.length - 1);

  return (
    <Table.Summary fixed="bottom">
      <Table.Summary.Row>
        {rowSelection ? <Table.Summary.Cell index={0} /> : null}
        {columns.map((col, i) => {
          const index = rowSelection ? i + 1 : i;
          const key = col.key != null ? String(col.key) : "";
          const showTotal = i === totalColIndex;
          if (showTotal) {
            return (
              <Table.Summary.Cell key="total-summary" index={index} align="right">
                <Typography.Text type="secondary">总金额 </Typography.Text>
                <Typography.Text strong>{total.toFixed(4)}</Typography.Text>
              </Table.Summary.Cell>
            );
          }
          return (
            <Table.Summary.Cell key={key || `sum-${i}`} index={index} />
          );
        })}
      </Table.Summary.Row>
    </Table.Summary>
  );
}

function attachResizeSalesOrderList<T extends object>(
  columns: ColumnsType<T>,
  widths: Record<string, number>,
  setWidths: Dispatch<SetStateAction<Record<string, number>>>,
  defaults: Record<string, number>,
): ColumnsType<T> {
  return columns.map((col) => {
    const key = col.key != null ? String(col.key) : "";
    if (!key || key === "op" || key === "detail") {
      const w =
        key === "op"
          ? (widths.op ?? (col.width as number) ?? defaults.op ?? 88)
          : key === "detail"
            ? (widths.detail ??
              (col.width as number) ??
              defaults.detail ??
              72)
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

function SalesOrderListColumnSettingButton({
  value,
  onChange,
  options = SALES_ORDER_LIST_COL_OPTIONS,
}: {
  value: string[];
  onChange: (keys: string[]) => void;
  options?: { label: string; value: string }[];
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

type SalesOrderListVariant = "today" | "pending" | "query";

function makeSalesOrderListColumns(
  variant: SalesOrderListVariant,
  opts: {
    onDetail: (id: string) => void;
    onEdit?: (id: string) => void;
    onDelete?: (id: string) => void;
  },
): ColumnsType<SalesOrderRow> {
  /** 历时：当日/未交 = 要求交货时间−创建时间；查询 = 实际交货时间−创建时间 */
  const elapsedCell = (_: unknown, r: SalesOrderRow) => {
    if (variant === "query") {
      return elapsedDaysBetweenCreatedAnd(r.createdAt, r.actualDeliveredAt);
    }
    return elapsedDaysBetweenCreatedAnd(r.createdAt, r.deliveryDueAt);
  };

  const dueOrActualCol: ColumnsType<SalesOrderRow>[number] =
    variant === "query"
      ? {
          key: "actualAt",
          title: "实际交货时间",
          dataIndex: "actualDeliveredAt",
          render: (t: string | null) =>
            t ? dayjs(t).format("YYYY-MM-DD") : "—",
        }
      : {
          key: "dueAt",
          title: "要求交货时间",
          dataIndex: "deliveryDueAt",
          render: (t: string | null) =>
            t ? dayjs(t).format("YYYY-MM-DD") : "—",
        };

  const detailLinkCol: ColumnsType<SalesOrderRow>[number] = {
    key: "detail",
    title: "详情",
    width: 72,
    render: (_, r) => (
      <Button
        type="link"
        size="small"
        onClick={() => void opts.onDetail(r.id)}
      >
        详情
      </Button>
    ),
  };

  const dataCols: ColumnsType<SalesOrderRow> = [
    {
      key: "customer",
      title: "客户",
      ellipsis: true,
      render: (_, r) => `${r.customer.code} ${r.customer.name}`,
    },
    {
      key: "customerOrderNo",
      title: "客户订单编号",
      dataIndex: "customerOrderNo",
      ellipsis: true,
      render: (t: string) => t?.trim() || "—",
    },
    {
      key: "customerModel",
      title: "客户机型",
      dataIndex: "customerModel",
      ellipsis: true,
      render: (t: string) => t?.trim() || "—",
    },
    {
      key: "totalAmount",
      title: "金额",
      dataIndex: "totalAmount",
      align: "right",
      render: (t: string) => Number(t || 0).toFixed(4),
    },
    {
      key: "lineCount",
      title: "行数",
      dataIndex: "lineCount",
      render: (_: unknown, r: SalesOrderRow) => r.lineCount,
    },
    {
      key: "createdAt",
      title: "创建时间",
      dataIndex: "createdAt",
      render: (t: string) => dayjs(t).format("YYYY-MM-DD HH:mm"),
    },
    dueOrActualCol,
    {
      key: "elapsed",
      title: "历时",
      render: elapsedCell,
    },
  ];

  const showEditDelete = opts.onEdit && opts.onDelete;

  if (variant === "query") {
    return [...dataCols, detailLinkCol];
  }

  if (variant === "pending") {
    return [
      ...dataCols,
      detailLinkCol,
      {
        key: "op",
        title: "操作",
        width: 140,
        render: (_, r) =>
          showEditDelete ? (
            <Space size="small">
              <Button
                type="link"
                size="small"
                onClick={() => void opts.onEdit!(r.id)}
              >
                修改
              </Button>
              <Button
                type="link"
                size="small"
                danger
                onClick={() => opts.onDelete!(r.id)}
              >
                删除
              </Button>
            </Space>
          ) : null,
      },
    ];
  }

  /** 当日销售单：仅「操作」列（修改/删除） */
  return [
    ...dataCols,
    {
      key: "op",
      title: "操作",
      width: showEditDelete ? 140 : 88,
      render: (_, r) =>
        showEditDelete ? (
          <Space size="small">
            <Button
              type="link"
              size="small"
              onClick={() => void opts.onEdit!(r.id)}
            >
              修改
            </Button>
            <Button
              type="link"
              size="small"
              danger
              onClick={() => opts.onDelete!(r.id)}
            >
              删除
            </Button>
          </Space>
        ) : (
          <Button
            type="link"
            size="small"
            onClick={() => void opts.onDetail(r.id)}
          >
            详情
          </Button>
        ),
    },
  ];
}

function SoLinesEditor({
  lines,
  setLines,
  products,
  customerId,
}: {
  lines: SoLine[];
  setLines: Dispatch<SetStateAction<SoLine[]>>;
  products: ProductOpt[];
  customerId: string | undefined;
}) {
  const pool = useMemo(
    () =>
      customerId
        ? products.filter((p) => p.customerId === customerId)
        : [],
    [products, customerId],
  );

  const updateLine = useCallback(
    (key: string, patch: Partial<SoLine>) => {
      setLines((prev) =>
        prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
      );
    },
    [setLines],
  );
  const removeLine = useCallback(
    (key: string) => {
      setLines((prev) => prev.filter((l) => l.key !== key));
    },
    [setLines],
  );
  const addLine = useCallback(() => {
    setLines((prev) => [
      ...prev,
      {
        key: newLineKey(),
        productId: undefined,
        quantity: 1,
        unitPrice: 0,
        remark: "",
      },
    ]);
  }, [setLines]);

  const [soLineColKeys, setSoLineColKeys] = useState<string[]>(() =>
    loadVisibleColKeys(LS_SO_LINE_COLS, SO_LINE_ALL_KEYS, SO_LINE_ALL_KEYS),
  );
  const [soLineColWidths, setSoLineColWidths] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    try {
      localStorage.setItem(LS_SO_LINE_COLS, JSON.stringify(soLineColKeys));
    } catch {
      /* ignore */
    }
  }, [soLineColKeys]);

  const lineProduct = useCallback(
    (row: SoLine) =>
      row.productId
        ? pool.find((p) => p.id === row.productId)
        : undefined,
    [pool],
  );

  const renderProductFieldSelect = useCallback(
    (field: ProductMatchField, row: SoLine) => {
      if (!customerId) {
        return (
          <Typography.Text type="secondary">请先选择客户</Typography.Text>
        );
      }
      const taken = new Set(
        lines
          .filter((l) => l.key !== row.key && l.productId)
          .map((l) => l.productId as string),
      );
      const opts = pool.filter(
        (p) => !taken.has(p.id) || p.id === row.productId,
      );
      const placeholders: Record<ProductMatchField, string> = {
        material: "输入物料编号前缀匹配",
        model: "输入型号前缀匹配",
        spec: "输入规格前缀匹配",
      };
      return (
        <Select
          showSearch
          allowClear
          style={{ width: "100%" }}
          placeholder={placeholders[field]}
          value={row.productId}
          options={opts.map((p) => ({
            value: p.id,
            label: productFieldDisplay(p, field),
          }))}
          filterOption={(input, option) => {
            const p = pool.find((x) => x.id === option?.value);
            if (!p) return false;
            return productMatchesFieldPrefix(p, field, input);
          }}
          onChange={(pid) => {
            if (!pid) {
              updateLine(row.key, { productId: undefined, unitPrice: 0 });
              return;
            }
            const pr = pool.find((x) => x.id === pid);
            updateLine(row.key, {
              productId: pid,
              unitPrice: pr ? Number(pr.price) : 0,
            });
          }}
        />
      );
    },
    [customerId, lines, pool, updateLine],
  );

  const allColumns: ColumnsType<SoLine> = useMemo(
    () => [
      {
        key: "materialCode",
        title: "物料编号",
        ellipsis: true,
        render: (_, row) => renderProductFieldSelect("material", row),
      },
      {
        key: "model",
        title: "商品型号",
        ellipsis: true,
        render: (_, row) => renderProductFieldSelect("model", row),
      },
      {
        key: "spec",
        title: "商品规格",
        ellipsis: true,
        render: (_, row) => renderProductFieldSelect("spec", row),
      },
      {
        key: "productImages",
        title: "商品图片",
        render: (_, row) => {
          const pr = lineProduct(row);
          return renderLineProductThumbs(pr?.imageUrls ?? []);
        },
      },
      {
        key: "unit",
        title: "单位",
        render: (_, row) => {
          const pr = lineProduct(row);
          return pr?.unit ?? "—";
        },
      },
      {
        key: "notes",
        title: "注意事项",
        ellipsis: true,
        render: (_, row) => {
          const pr = lineProduct(row);
          const t = pr?.inspectionNotes?.trim();
          return t || "—";
        },
      },
      {
        key: "qty",
        title: "数量",
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
        key: "price",
        title: "单价",
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
        key: "lineAmount",
        title: "金额",
        render: (_, row) => {
          if (!row.productId) return "—";
          return (row.quantity * row.unitPrice).toFixed(4);
        },
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
    [removeLine, updateLine, lineProduct, renderProductFieldSelect],
  );

  const visibleColumns = useMemo(
    () =>
      allColumns.filter(
        (col) =>
          col.key === "op" ||
          (typeof col.key === "string" && soLineColKeys.includes(col.key)),
      ),
    [allColumns, soLineColKeys],
  );

  const columns = useMemo(
    () =>
      attachResizeSoLine(
        visibleColumns,
        soLineColWidths,
        setSoLineColWidths,
        DEFAULT_SO_LINE_COL_WIDTH,
      ),
    [visibleColumns, soLineColWidths],
  );

  const linesAmountTotal = useMemo(
    () =>
      lines.reduce(
        (sum, l) => sum + (l.productId ? l.quantity * l.unitPrice : 0),
        0,
      ),
    [lines],
  );

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
        <Typography.Text strong>销售明细</Typography.Text>
        <SoLineColumnSettingButton
          value={soLineColKeys}
          onChange={setSoLineColKeys}
        />
      </div>
      <Table<SoLine>
        size="small"
        style={{ marginTop: 8 }}
        rowKey="key"
        pagination={false}
        dataSource={lines}
        tableLayout="fixed"
        scroll={{ x: "max-content" }}
        components={{
          header: { cell: ResizableTableTitle },
        }}
        locale={{
          emptyText: customerId
            ? "请点击下方按钮添加一行"
            : "请先选择客户后再添加明细",
        }}
        columns={columns}
      />
      <Button
        type="dashed"
        onClick={addLine}
        style={{ marginTop: 8 }}
        disabled={!customerId}
      >
        添加一行
      </Button>
      <div
        style={{
          textAlign: "right",
          marginTop: 8,
          paddingRight: 4,
        }}
      >
        <Typography.Text type="secondary">总金额：</Typography.Text>{" "}
        <Typography.Text strong>{linesAmountTotal.toFixed(4)}</Typography.Text>
      </div>
    </div>
  );
}

export function SalesPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("add");

  const [presets, setPresets] = useState<SalesPresetBundle | null>(null);
  const [loadingPresets, setLoadingPresets] = useState(true);

  const [todayRows, setTodayRows] = useState<SalesOrderRow[]>([]);
  const [loadingToday, setLoadingToday] = useState(false);

  const [pendingRows, setPendingRows] = useState<SalesOrderRow[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);

  const [queryForm] = Form.useForm();
  const [queryRows, setQueryRows] = useState<SalesOrderRow[]>([]);
  const [loadingQuery, setLoadingQuery] = useState(false);

  const [todayListColKeys, setTodayListColKeys] = useState<string[]>(() =>
    loadVisibleColKeys(
      LS_SALES_TODAY_COLS,
      SALES_ORDER_LIST_ALL_KEYS,
      SALES_ORDER_LIST_ALL_KEYS,
    ),
  );
  const [todayListColWidths, setTodayListColWidths] = useState<
    Record<string, number>
  >({});

  const [pendingListColKeys, setPendingListColKeys] = useState<string[]>(() =>
    loadVisibleColKeys(
      LS_SALES_PENDING_COLS,
      SALES_ORDER_PENDING_LIST_ALL_KEYS,
      SALES_ORDER_PENDING_LIST_ALL_KEYS,
    ),
  );
  const [pendingListColWidths, setPendingListColWidths] = useState<
    Record<string, number>
  >({});

  const [queryListColKeys, setQueryListColKeys] = useState<string[]>(() =>
    loadVisibleColKeys(
      LS_SALES_QUERY_COLS,
      SALES_ORDER_QUERY_LIST_ALL_KEYS,
      SALES_ORDER_QUERY_LIST_ALL_KEYS,
    ),
  );
  const [queryListColWidths, setQueryListColWidths] = useState<
    Record<string, number>
  >({});

  const [todaySelectedKeys, setTodaySelectedKeys] = useState<Key[]>([]);
  const [pendingSelectedKeys, setPendingSelectedKeys] = useState<Key[]>([]);
  const [querySelectedKeys, setQuerySelectedKeys] = useState<Key[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [createForm] = Form.useForm();
  const [soLines, setSoLines] = useState<SoLine[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  /** 记录弹窗内已同步过的客户，仅在用户从「一个已选客户」切换到另一客户时清空明细 */
  const prevCustomerIdForLinesRef = useRef<string | undefined>(undefined);

  const createCustomerId = Form.useWatch("customerId", createForm) as
    | string
    | undefined;

  const loadPresets = useCallback(async () => {
    setLoadingPresets(true);
    try {
      const data = await fetchJson<SalesPresetBundle>("/api/sales-presets", {
        credentials: "include",
      });
      setPresets(data);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载选项失败");
      setPresets({ customers: [], products: [] });
    } finally {
      setLoadingPresets(false);
    }
  }, [message]);

  const buildCreatedRangeQuery = (
    createdFrom: string,
    createdTo: string,
    v: Record<string, unknown>,
  ) => {
    const p = new URLSearchParams();
    p.set("createdFrom", createdFrom);
    p.set("createdTo", createdTo);
    if (v.customerId) p.set("customerId", String(v.customerId));
    if (v.customerOrderNo) {
      p.set("customerOrderNo", String(v.customerOrderNo).trim());
    }
    return p.toString();
  };

  const buildDeliveredRangeQuery = (v: Record<string, unknown>) => {
    const p = new URLSearchParams();
    const range = v.dateRange as [dayjs.Dayjs, dayjs.Dayjs] | undefined;
    if (range?.[0] && range?.[1]) {
      p.set("deliveredFrom", range[0].startOf("day").toISOString());
      p.set("deliveredTo", range[1].endOf("day").toISOString());
    }
    if (v.customerId) p.set("customerId", String(v.customerId));
    if (v.customerOrderNo) {
      p.set("customerOrderNo", String(v.customerOrderNo).trim());
    }
    const cm = v.customerModel;
    if (cm !== undefined && cm !== null && String(cm).trim()) {
      p.set("customerModel", String(cm).trim());
    }
    return p.toString();
  };

  const loadTodayOrders = useCallback(async () => {
    setLoadingToday(true);
    try {
      const start = dayjs().startOf("day").toISOString();
      const end = dayjs().endOf("day").toISOString();
      const data = await fetchJson<{ list: SalesOrderRow[] }>(
        `/api/sales-orders?${buildCreatedRangeQuery(start, end, {})}`,
        { credentials: "include" },
      );
      setTodayRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
      setTodayRows([]);
    } finally {
      setLoadingToday(false);
    }
  }, [message]);

  const loadPendingOrders = useCallback(async () => {
    setLoadingPending(true);
    try {
      const p = new URLSearchParams();
      p.set("pending", "1");
      const data = await fetchJson<{ list: SalesOrderRow[] }>(
        `/api/sales-orders?${p.toString()}`,
        { credentials: "include" },
      );
      setPendingRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
      setPendingRows([]);
    } finally {
      setLoadingPending(false);
    }
  }, [message]);

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
        const data = await fetchJson<{ list: SalesOrderRow[] }>(
          `/api/sales-orders?${buildDeliveredRangeQuery(v)}`,
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
    [message],
  );

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_SALES_TODAY_COLS, JSON.stringify(todayListColKeys));
    } catch {
      /* ignore */
    }
  }, [todayListColKeys]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_SALES_PENDING_COLS,
        JSON.stringify(pendingListColKeys),
      );
    } catch {
      /* ignore */
    }
  }, [pendingListColKeys]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_SALES_QUERY_COLS, JSON.stringify(queryListColKeys));
    } catch {
      /* ignore */
    }
  }, [queryListColKeys]);

  useEffect(() => {
    if (tab === "add") void loadTodayOrders();
  }, [tab, loadTodayOrders]);

  useEffect(() => {
    if (tab === "pending") void loadPendingOrders();
  }, [tab, loadPendingOrders]);

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
    setEditingOrderId(null);
    createForm.resetFields();
    setSoLines([]);
    setCreateOpen(true);
  };

  /** 切换客户时清空明细；首次出现客户值（含修改订单回填）不清空，避免 useWatch 晚一帧误清空 */
  useEffect(() => {
    if (!createOpen) {
      prevCustomerIdForLinesRef.current = undefined;
      return;
    }
    const cur = createCustomerId;
    if (cur === undefined) return;

    const prev = prevCustomerIdForLinesRef.current;
    if (prev === undefined) {
      prevCustomerIdForLinesRef.current = cur;
      return;
    }
    if (prev !== cur) {
      setSoLines([]);
      prevCustomerIdForLinesRef.current = cur;
      return;
    }
  }, [createCustomerId, createOpen]);

  const submitCreate = async () => {
    const v = await createForm.validateFields();
    const filled = soLines.filter((l) => l.productId);
    if (filled.length === 0) {
      message.error("请至少添加一行并选定商品（物料编号/型号/规格中匹配）");
      return;
    }
    if (filled.some((l) => !l.quantity || l.quantity <= 0)) {
      message.error("每行数量须大于 0");
      return;
    }
    setSubmitting(true);
    try {
      const firstLine = soLines.find((l) => l.productId);
      const firstProduct = firstLine?.productId
        ? presets?.products.find((p) => p.id === firstLine.productId)
        : undefined;
      const customerModelFromProduct = (firstProduct?.machineModel ?? "")
        .trim();
      const payload = {
        customerId: v.customerId,
        customerOrderNo: String(v.customerOrderNo ?? "").trim(),
        customerModel: editingOrderId
          ? String(v.customerModel ?? "").trim()
          : customerModelFromProduct,
        deliveryDueAt: dayjs(v.deliveryDueAt as Dayjs).toISOString(),
        remark: v.remark ?? "",
        lines: filled.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          remark: l.remark || undefined,
        })),
      };
      if (editingOrderId) {
        await fetchJson(`/api/sales-orders/${editingOrderId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", ...payload }),
        });
        message.success("销售订单已更新");
        setCreateOpen(false);
        setEditingOrderId(null);
        await loadTodayOrders();
        await loadPendingOrders();
      } else {
        await fetchJson("/api/sales-orders", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        message.success("销售订单已保存");
        setCreateOpen(false);
        setTab("pending");
        await loadPendingOrders();
        await loadTodayOrders();
      }
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
        const data = await fetchJson<DetailPayload>(`/api/sales-orders/${id}`, {
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

  const detailSalesOrderIdQ = searchParams.get("detailSalesOrderId");
  useEffect(() => {
    if (!detailSalesOrderIdQ) return;
    let cancelled = false;
    void (async () => {
      await openDetail(detailSalesOrderIdQ);
      if (!cancelled) router.replace(pathname, { scroll: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [detailSalesOrderIdQ, pathname, router, openDetail]);

  const openEditOrder = useCallback(
    async (id: string) => {
      try {
        if (!presets) await loadPresets();
        const data = await fetchJson<DetailPayload>(`/api/sales-orders/${id}`, {
          credentials: "include",
        });
        if (data.actualDeliveredAt) {
          message.warning("已出货的订单不可修改");
          return;
        }
        setEditingOrderId(id);
        createForm.setFieldsValue({
          customerId: data.customer.id,
          customerOrderNo: data.customerOrderNo,
          customerModel: data.customerModel,
          deliveryDueAt: data.deliveryDueAt
            ? dayjs(data.deliveryDueAt)
            : undefined,
          remark: data.remark ?? "",
        });
        setSoLines(
          data.lines.map((l) => ({
            key: l.id,
            productId: l.product.id,
            quantity: Math.trunc(Number(l.quantity)),
            unitPrice: Number(l.unitPrice),
            remark: l.remark ?? "",
          })),
        );
        setCreateOpen(true);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载失败");
      }
    },
    [createForm, message, presets, loadPresets],
  );

  const deleteUndeliveredSalesOrder = useCallback(
    (id: string) => {
      Modal.confirm({
        title: "删除销售订单",
        content: "确定删除该订单？删除后不可恢复。",
        okText: "删除",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: async () => {
          try {
            await fetchJson(`/api/sales-orders/${id}`, {
              method: "DELETE",
              credentials: "include",
            });
            message.success("已删除");
            setTodaySelectedKeys((prev) => prev.filter((k) => k !== id));
            setPendingSelectedKeys((prev) => prev.filter((k) => k !== id));
            await loadTodayOrders();
            await loadPendingOrders();
          } catch (e) {
            message.error(e instanceof Error ? e.message : "删除失败");
            throw e;
          }
        },
      });
    },
    [message, loadTodayOrders, loadPendingOrders],
  );

  const todayListBaseCols = useMemo(
    () =>
      makeSalesOrderListColumns("today", {
        onDetail: openDetail,
        onEdit: openEditOrder,
        onDelete: deleteUndeliveredSalesOrder,
      }),
    [openDetail, openEditOrder, deleteUndeliveredSalesOrder],
  );

  const todayListColumns = useMemo(() => {
    const visible = todayListBaseCols.filter(
      (col) =>
        col.key === "op" ||
        (typeof col.key === "string" && todayListColKeys.includes(col.key)),
    );
    return attachResizeSalesOrderList(
      visible,
      todayListColWidths,
      setTodayListColWidths,
      DEFAULT_SALES_TODAY_WIDTH,
    );
  }, [todayListBaseCols, todayListColKeys, todayListColWidths]);

  const pendingListBaseCols = useMemo(
    () =>
      makeSalesOrderListColumns("pending", {
        onDetail: openDetail,
        onEdit: openEditOrder,
        onDelete: deleteUndeliveredSalesOrder,
      }),
    [openDetail, openEditOrder, deleteUndeliveredSalesOrder],
  );

  const pendingListColumns = useMemo(() => {
    const visible = pendingListBaseCols.filter(
      (col) =>
        typeof col.key === "string" && pendingListColKeys.includes(col.key),
    );
    return attachResizeSalesOrderList(
      visible,
      pendingListColWidths,
      setPendingListColWidths,
      DEFAULT_SALES_PENDING_WIDTH,
    );
  }, [pendingListBaseCols, pendingListColKeys, pendingListColWidths]);

  const queryListBaseCols = useMemo(
    () => makeSalesOrderListColumns("query", { onDetail: openDetail }),
    [openDetail],
  );

  const queryListColumns = useMemo(() => {
    const visible = queryListBaseCols.filter(
      (col) =>
        typeof col.key === "string" && queryListColKeys.includes(col.key),
    );
    return attachResizeSalesOrderList(
      visible,
      queryListColWidths,
      setQueryListColWidths,
      DEFAULT_SALES_QUERY_WIDTH,
    );
  }, [queryListBaseCols, queryListColKeys, queryListColWidths]);

  const { loading: tabPermLoading, allowed } = useMeTabPermissions();

  const visibleSalesTabKeys = useMemo(
    () =>
      (["add", "pending", "query"] as const).filter((k) =>
        allowed([SALES_TAB_PERM[k]]),
      ),
    [allowed],
  );

  useEffect(() => {
    if (tabPermLoading) return;
    if (visibleSalesTabKeys.length === 0) return;
    const keys = visibleSalesTabKeys as readonly string[];
    if (!keys.includes(tab)) {
      setTab(keys[0] ?? "add");
    }
  }, [tabPermLoading, visibleSalesTabKeys, tab]);

  return (
    <Card title="销售订单">
      {tabPermLoading ? (
        <div style={{ padding: 56, textAlign: "center" }}>
          <Spin size="large" />
        </div>
      ) : visibleSalesTabKeys.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          当前账号无可用的销售订单 TAB，请联系管理员在「员工管理 → 权限管理」中勾选对应 TAB。
        </Typography.Paragraph>
      ) : (
      <Tabs
        activeKey={tab}
        destroyOnHidden
        onChange={(k) => {
          setTab(k);
          if (k === "add" || k === "pending" || k === "query") void loadPresets();
        }}
        items={[
          {
            key: "add",
            label: "新增销售订单",
            children: (
              <Space direction="vertical" size="large" style={{ width: "100%" }}>
                <Space wrap>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={openCreate}
                    disabled={loadingPresets}
                  >
                    新增销售订单
                  </Button>
                  <Typography.Text type="secondary">
                    下方列表仅显示<strong>当天新建</strong>的销售订单；出货与查询请以<strong>客户订单编号</strong>为准。明细请在<strong>物料编号 / 商品型号 / 商品规格</strong>任一项中输入前缀，匹配选择该客户下的商品档案。
                  </Typography.Text>
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
                    当日销售单
                  </Typography.Title>
                  <SalesOrderListColumnSettingButton
                    value={todayListColKeys}
                    onChange={setTodayListColKeys}
                  />
                </div>
                <Table<SalesOrderRow>
                  rowKey="id"
                  loading={loadingToday}
                  columns={todayListColumns}
                  dataSource={todayRows}
                  rowSelection={{
                    selectedRowKeys: todaySelectedKeys,
                    onChange: (keys) => setTodaySelectedKeys(keys),
                  }}
                  pagination={{ pageSize: 8 }}
                  scroll={{ x: "max-content" }}
                  tableLayout="fixed"
                  components={{
                    header: { cell: ResizableTableTitle },
                  }}
                  summary={() =>
                    renderSalesOrderTotalSummary(todayListColumns, todayRows, {
                      rowSelection: true,
                    })
                  }
                />
              </Space>
            ),
          },
          {
            key: "pending",
            label: "销售未交订单",
            children: (
              <Space direction="vertical" size="large" style={{ width: "100%" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <Typography.Text type="secondary" style={{ flex: "1 1 280px" }}>
                    新建保存后的订单会出现在此列表；仓库完成出货并记录<strong>实际交货时间</strong>后，可在「销售订单查询」中检索。
                  </Typography.Text>
                  <SalesOrderListColumnSettingButton
                    value={pendingListColKeys}
                    onChange={setPendingListColKeys}
                    options={SALES_ORDER_LIST_COL_OPTIONS_PENDING}
                  />
                </div>
                <Table<SalesOrderRow>
                  rowKey="id"
                  loading={loadingPending}
                  columns={pendingListColumns}
                  dataSource={pendingRows}
                  rowSelection={{
                    selectedRowKeys: pendingSelectedKeys,
                    onChange: (keys) => setPendingSelectedKeys(keys),
                  }}
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
            label: "销售订单查询",
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
                    label="实际交货时间"
                    rules={[{ required: true, message: "请选择日期范围" }]}
                  >
                    <DatePicker.RangePicker />
                  </Form.Item>
                  <Form.Item name="customerId" label="客户">
                    <Select
                      allowClear
                      placeholder="全部"
                      style={{ width: 200 }}
                      showSearch
                      optionFilterProp="label"
                      options={(presets?.customers ?? []).map((c) => ({
                        value: c.id,
                        label: `${c.code} ${c.name}`,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name="customerOrderNo" label="客户订单编号">
                    <Input allowClear placeholder="模糊" style={{ width: 160 }} />
                  </Form.Item>
                  <Form.Item name="customerModel" label="客户机型">
                    <Input allowClear placeholder="模糊" style={{ width: 140 }} />
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
                          customerId: undefined,
                          customerOrderNo: undefined,
                          customerModel: undefined,
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
                    justifyContent: "flex-end",
                    alignItems: "center",
                    width: "100%",
                  }}
                >
                  <SalesOrderListColumnSettingButton
                    value={queryListColKeys}
                    onChange={setQueryListColKeys}
                    options={SALES_ORDER_LIST_COL_OPTIONS_QUERY}
                  />
                </div>
                <Table<SalesOrderRow>
                  rowKey="id"
                  loading={loadingQuery}
                  columns={queryListColumns}
                  dataSource={queryRows}
                  rowSelection={{
                    selectedRowKeys: querySelectedKeys,
                    onChange: (keys) => setQuerySelectedKeys(keys),
                  }}
                  pagination={{ pageSize: 10 }}
                  scroll={{ x: "max-content" }}
                  tableLayout="fixed"
                  components={{
                    header: { cell: ResizableTableTitle },
                  }}
                  summary={() =>
                    renderSalesOrderTotalSummary(queryListColumns, queryRows, {
                      rowSelection: true,
                    })
                  }
                />
              </Space>
            ),
          },
        ].filter((item) => {
          const code = SALES_TAB_PERM[String(item.key)];
          return code ? allowed([code]) : false;
        })}
      />
      )}

      <Modal
        title={editingOrderId ? "修改销售订单" : "新增销售订单"}
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          setEditingOrderId(null);
        }}
        onOk={() => void submitCreate()}
        confirmLoading={submitting}
        width={1180}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" autoComplete="off">
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="customerId"
                label="客户"
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
                name="customerOrderNo"
                label="客户订单编号"
                rules={[{ required: true, message: "请填写客户订单编号" }]}
                extra="客户侧提供的订单号，用于对账与追溯"
              >
                <Input placeholder="手工录入" allowClear autoComplete="off" />
              </Form.Item>
            </Col>
            {editingOrderId ? (
              <Col span={24}>
                <Form.Item name="customerModel" label="客户机型">
                  <Input placeholder="可选" allowClear />
                </Form.Item>
              </Col>
            ) : (
              <Col span={24}>
                <Typography.Paragraph
                  type="secondary"
                  style={{ marginBottom: 0 }}
                >
                  客户机型由下方明细中<strong>第一个已选商品</strong>的机型号自动带出并保存。
                </Typography.Paragraph>
              </Col>
            )}
            <Col xs={24} sm={12}>
              <Form.Item
                name="deliveryDueAt"
                label="要求交货时间"
                rules={[{ required: true, message: "请选择要求交货时间" }]}
              >
                <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} placeholder="可选" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
        <SoLinesEditor
          lines={soLines}
          setLines={setSoLines}
          products={presets?.products ?? []}
          customerId={createCustomerId}
        />
      </Modal>

      <Modal
        title={
          detail
            ? `销售订单 ${detail.customerOrderNo?.trim() || detail.id.slice(0, 8)}`
            : "销售订单详情"
        }
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
              <strong>客户：</strong>
              {detail.customer.code} {detail.customer.name}
            </Typography.Text>
            <Typography.Text>
              <strong>客户订单编号：</strong>
              {detail.customerOrderNo?.trim() || "—"}
            </Typography.Text>
            <Typography.Text>
              <strong>客户机型：</strong>
              {detail.customerModel?.trim() || "—"}
            </Typography.Text>
            <Typography.Text>
              <strong>要求交货时间：</strong>
              {detail.deliveryDueAt
                ? dayjs(detail.deliveryDueAt).format("YYYY-MM-DD")
                : "—"}
            </Typography.Text>
            <Typography.Text>
              <strong>实际交货时间：</strong>
              {detail.actualDeliveredAt
                ? dayjs(detail.actualDeliveredAt).format("YYYY-MM-DD")
                : "—"}
            </Typography.Text>
            <Typography.Text>
              <strong>订单总金额：</strong>
              {Number(detail.totalAmount || 0).toFixed(4)}
            </Typography.Text>
            <Typography.Text>
              <strong>备注：</strong>
              {detail.remark ?? "—"}
            </Typography.Text>
            <Typography.Text type="secondary">
              创建时间：{dayjs(detail.createdAt).format("YYYY-MM-DD HH:mm:ss")}
            </Typography.Text>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={detail.lines}
              scroll={{ x: 1400 }}
              columns={[
                {
                  title: "物料编号",
                  width: 120,
                  ellipsis: true,
                  render: (_, r) => r.product.customerMaterialCode || "—",
                },
                {
                  title: "商品型号",
                  width: 120,
                  ellipsis: true,
                  render: (_, r) => r.product.model || "—",
                },
                {
                  title: "商品规格",
                  ellipsis: true,
                  render: (_, r) => r.product.spec || "—",
                },
                {
                  title: "商品图片",
                  width: 120,
                  render: (_, r) =>
                    renderLineProductThumbs(r.product.imageUrls ?? []),
                },
                { title: "单位", width: 64, render: (_, r) => r.product.unit },
                {
                  title: "注意事项",
                  width: 140,
                  ellipsis: true,
                  render: (_, r) =>
                    r.product.inspectionNotes?.trim() || "—",
                },
                { title: "数量", width: 100, render: (_, r) => r.quantity },
                { title: "单价", width: 100, render: (_, r) => r.unitPrice },
                {
                  title: "金额",
                  width: 100,
                  render: (_, r) =>
                    (
                      Number(r.quantity) * Number(r.unitPrice)
                    ).toFixed(4),
                },
                {
                  title: "行备注",
                  ellipsis: true,
                  render: (_, r) => r.remark ?? "—",
                },
              ]}
            />
            <div
              style={{
                textAlign: "right",
                marginTop: 8,
                paddingRight: 4,
              }}
            >
              <Typography.Text type="secondary">总金额：</Typography.Text>{" "}
              <Typography.Text strong>
                {Number(detail.totalAmount || 0).toFixed(4)}
              </Typography.Text>
            </div>
          </Space>
        ) : null}
      </Modal>
    </Card>
  );
}
