"use client";

import { QuestionCircleOutlined } from "@ant-design/icons";
import {
  App,
  AutoComplete,
  Button,
  Card,
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
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { useMeTabPermissions } from "@/lib/use-me-tab-permissions";
import { inhouseMaterialRowsForProductSets } from "@/lib/inhouse-bom-display";
import { formatOutsourceRecoveryMaterialCode } from "@/lib/outsource-recovery-display";
import {
  ceilOutsourceMaterialQty,
  computeOutsourceLinesFromBom,
} from "@/lib/outsource-lines";

const OUTSOURCE_TAB_PERM: Record<string, string> = {
  add: "tab.os.add",
  open: "tab.os.open",
  query: "tab.os.query",
  stock: "tab.os.stock",
  recovery: "tab.os.recovery",
  settings: "tab.os.settings",
};
import { OutsourceOrderSlipPreviewModal } from "./OutsourceOrderSlipPreviewModal";
import { OutsourceSettingsTab } from "./OutsourceSettingsTab";

type OutsourceProductBomRow = {
  materialId: string;
  usageQty: string;
  material: {
    id: string;
    code: string;
    name: string;
    unit: string;
    partDescription: string | null;
  };
};

type OutsourceProductHit = {
  id: string;
  customerMaterialCode: string;
  model: string;
  spec: string;
  unit: string;
  customer: { id: string; code: string; name: string };
  processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
  /** 外发+自加工：厂内需扣/备的 BOM（不随本外发单发料） */
  inhouseBom: OutsourceProductBomRow[];
  bom: OutsourceProductBomRow[];
};

type EditableLine = {
  materialId: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
};

/** 当日订单编辑弹窗中的明细行（含 lineId 供 PATCH） */
type EditOrderLine = {
  lineId: string;
  materialId: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
};

type SupplierOpt = { id: string; code: string; name: string; shortName: string | null };

/** 列表/导出：加工方以中文名称为准 */
function formatSupplierChinese(
  s: Pick<SupplierOpt, "name" | "shortName" | "code">,
): string {
  const name = s.name?.trim();
  if (name) return name;
  const sn = s.shortName?.trim();
  if (sn) return sn;
  return s.code?.trim() || "—";
}

/** 下拉框：名称在前，括号内编号便于检索区分 */
function formatSupplierSelectLabel(s: SupplierOpt): string {
  const name = s.name?.trim();
  const code = s.code?.trim() || "";
  if (name) return code ? `${name}（${code}）` : name;
  return s.shortName?.trim() || code || "—";
}

function HelpTip({ text }: { text: ReactNode }) {
  return (
    <Tooltip title={<span style={{ whiteSpace: "normal" }}>{text}</span>} placement="topLeft">
      <QuestionCircleOutlined style={{ color: "#8c8c8c", cursor: "help" }} />
    </Tooltip>
  );
}

type OutsourceOrderRow = {
  id: string;
  orderNo: string;
  status: "OPEN" | "CLOSED" | "CANCELLED";
  productQty: number;
  remark: string | null;
  receivedAt: string | null;
  createdAt: string;
  canCancel?: boolean;
  supplier: SupplierOpt | null;
  product: {
    id: string;
    model: string;
    customerMaterialCode: string;
    unit: string;
    customer: { code: string; name: string };
  };
  lines: {
    id: string;
    quantity: number;
    material: { id: string; code: string; name: string; unit: string };
  }[];
};

const STATUS_TAG: Record<OutsourceOrderRow["status"], { color: string; text: string }> = {
  OPEN: { color: "orange", text: "未回收" },
  CLOSED: { color: "green", text: "已回收" },
  CANCELLED: { color: "default", text: "已取消" },
};

type OutsourceReturnBatch = {
  materialId: string;
  quantity: number;
  receivedAt: string;
};

type OutsourceDetailMaterial = {
  id: string;
  code: string;
  name: string;
  unit: string;
  partDescription: string | null;
  brand: string | null;
  kind: string | null;
  presetKind: { name: string } | null;
};

type OutsourceDetailLine = {
  id: string;
  /** 外发出单时的数量（固定值，不随回收进度变化） */
  issuedQuantity?: number;
  quantity: number;
  material: OutsourceDetailMaterial;
};

type OutsourceDetailPayload = {
  id: string;
  orderNo: string;
  status: string;
  productId: string;
  productQty: number;
  remark: string | null;
  createdAt: string;
  supplier: OutsourceOrderRow["supplier"];
  product: OutsourceOrderRow["product"] & {
    processingMode?: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
    productMaterials?: { materialId: string; usageQty: string | number }[];
    inhouseBom?: {
      materialId: string;
      usageQty: number;
      material: {
        id: string;
        code: string;
        name: string;
        unit: string;
        partDescription?: string | null;
      };
    }[];
  };
  lines: OutsourceDetailLine[];
  materialReturnBatches?: OutsourceReturnBatch[];
  /** 成品按套入库批次（收回明细），与物料回冲记录分离 */
  productRecoveryBatches?: {
    quantity: number;
    receivedAt: string;
    partDescription: string | null;
  }[];
};

type OutsourceMaterialStockRow = {
  supplierId: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  openQty: number;
  closedCarryQty: number;
  orderCount: number;
};

type OutsourceStockReturnInput = {
  key: string;
  supplierId: string | null;
  supplierName: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  maxReturnQty: number;
  returnQty: number;
  scrapQty: number;
};

type OutsourceStockHistoryRow = {
  id: string;
  receivedAt: string;
  orderNo: string;
  quantity: number;
  direction: "IN" | "OUT";
  partDescription: string;
  operatorName: string;
};

type OutsourceRecoveryStockRow = {
  productId: string;
  customerCode: string;
  customerName: string;
  customerMaterialCode: string;
  recoveryMaterialCode: string;
  model: string;
  unit: string;
  quantity: number;
  lastReceivedAt: string | null;
};

function stockRowKey(r: Pick<OutsourceMaterialStockRow, "supplierId" | "materialId">): string {
  return `${r.supplierId ?? "NONE"}-${r.materialId}`;
}

type CloseLineInput = {
  lineId: string;
  materialId: string;
  code: string;
  name: string;
  unit: string;
  currentQty: number;
  /** 按损耗套数自动折算（只读） */
  lossBySets: number;
  returnQty: number;
};

function returnBatchesForMaterial(
  batches: OutsourceReturnBatch[] | undefined,
  materialId: string,
): OutsourceReturnBatch[] {
  return (batches ?? []).filter((b) => b.materialId === materialId);
}

function totalReturnedMaterial(
  batches: OutsourceReturnBatch[] | undefined,
  materialId: string,
): number {
  return returnBatchesForMaterial(batches, materialId).reduce(
    (s, b) => s + b.quantity,
    0,
  );
}

/** 本行原始外发物料数量 = 当前待回收 + 已累计回收入库 */
function orderMaterialQty(
  line: OutsourceDetailLine,
  batches: OutsourceReturnBatch[] | undefined,
): number {
  if (typeof line.issuedQuantity === "number" && line.issuedQuantity > 0) {
    return line.issuedQuantity;
  }
  return line.quantity + totalReturnedMaterial(batches, line.material.id);
}

function bomPerSetMap(
  bom: { materialId: string; usageQty: string | number }[] | undefined,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of bom ?? []) {
    m.set(row.materialId, ceilOutsourceMaterialQty(Number(row.usageQty) * 1));
  }
  return m;
}

/** 单行物料：单套用量（无 BOM 时用本行原始应发/外发套数反推） */
function perSetForLine(
  line: OutsourceDetailLine,
  detail: OutsourceDetailPayload,
  bomPerSet: Map<string, number>,
): number {
  const fromBom = bomPerSet.get(line.material.id);
  if (fromBom !== undefined && fromBom > 0) return fromBom;
  const orig = orderMaterialQty(line, detail.materialReturnBatches);
  if (detail.productQty <= 0) return 1;
  return ceilOutsourceMaterialQty(orig / detail.productQty);
}

/** 按各物料剩余量折算：尚可回收的成品套数（短板） */
function setsPendingByMaterials(detail: OutsourceDetailPayload): number {
  const bom = bomPerSetMap(detail.product.productMaterials);
  let min = Infinity;
  for (const l of detail.lines) {
    const p = perSetForLine(l, detail, bom);
    if (p <= 0) continue;
    const s = Math.floor(l.quantity / p);
    min = Math.min(min, s);
  }
  return min === Infinity ? 0 : min;
}

/** 本单已按套入库的成品数量（与库存侧「外发单号」下成品正入库流水一致） */
function productSetsAlreadyInbounded(detail: OutsourceDetailPayload): number {
  return (detail.productRecoveryBatches ?? []).reduce(
    (s, b) => s + (typeof b.quantity === "number" ? b.quantity : 0),
    0,
  );
}

/** 相对「外发加工套数」尚允许回收的套数，不含物料短板；与 productQty 对齐 */
function maxRecycleSetsByOutsourceQty(detail: OutsourceDetailPayload): number {
  return Math.max(0, detail.productQty - productSetsAlreadyInbounded(detail));
}

/** 按各物料已回库量折算：已累计完成的成品套数（短板） */
function setsRecoveredSoFar(detail: OutsourceDetailPayload): number {
  return Math.min(detail.productQty, productSetsAlreadyInbounded(detail));
}

function productLabel(p: OutsourceProductHit): string {
  return `${p.customer.code} ${p.customer.name} · ${p.customerMaterialCode || "—"} · ${p.model || "—"}`;
}

export function OutsourcePage() {
  const { message } = App.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [slipPreviewOpen, setSlipPreviewOpen] = useState(false);
  const [slipPreviewId, setSlipPreviewId] = useState<string | null>(null);
  const [slipPreviewOrderNo, setSlipPreviewOrderNo] = useState<string | null>(null);
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [recycleLoading, setRecycleLoading] = useState(false);
  const [recycleSubmitting, setRecycleSubmitting] = useState(false);
  const [recycleOrderId, setRecycleOrderId] = useState<string | null>(null);
  const [recycleOrderNo, setRecycleOrderNo] = useState<string | null>(null);
  const [recycleDetail, setRecycleDetail] = useState<OutsourceDetailPayload | null>(null);
  /** 本次确认回收的成品套数（弹窗内换算为各物料行 receivedQty） */
  const [recycleSetsThis, setRecycleSetsThis] = useState(0);
  const [exportingQuery, setExportingQuery] = useState(false);
  const [stockKeyword, setStockKeyword] = useState("");
  const [stockSupplierId, setStockSupplierId] = useState<string | undefined>();
  const [stockMaterialId, setStockMaterialId] = useState<string | undefined>();
  const [stockRows, setStockRows] = useState<OutsourceMaterialStockRow[]>([]);
  const [stockSelectedRowKeys, setStockSelectedRowKeys] = useState<string[]>([]);
  const [loadingStockTab, setLoadingStockTab] = useState(false);
  const [stockReturnOpen, setStockReturnOpen] = useState(false);
  const [stockReturning, setStockReturning] = useState(false);
  const [stockReturnLines, setStockReturnLines] = useState<OutsourceStockReturnInput[]>([]);
  const [stockHistoryOpen, setStockHistoryOpen] = useState(false);
  const [stockHistoryLoading, setStockHistoryLoading] = useState(false);
  const [stockHistoryExporting, setStockHistoryExporting] = useState(false);
  const [stockHistoryRows, setStockHistoryRows] = useState<OutsourceStockHistoryRow[]>([]);
  const [stockHistoryTarget, setStockHistoryTarget] = useState<OutsourceMaterialStockRow | null>(
    null,
  );
  const [recoveryKeyword, setRecoveryKeyword] = useState("");
  const [recoveryRows, setRecoveryRows] = useState<OutsourceRecoveryStockRow[]>([]);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryAdjustOpen, setRecoveryAdjustOpen] = useState(false);
  const [recoveryAdjusting, setRecoveryAdjusting] = useState(false);
  const [recoveryAdjustTarget, setRecoveryAdjustTarget] = useState<OutsourceRecoveryStockRow | null>(null);
  const [recoveryAdjustQty, setRecoveryAdjustQty] = useState(0);
  const [recoveryAdjustReason, setRecoveryAdjustReason] = useState("");
  const recoveryKeywordRef = useRef("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeLoading, setCloseLoading] = useState(false);
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [closeOrder, setCloseOrder] = useState<OutsourceOrderRow | null>(null);
  const [closeDetail, setCloseDetail] = useState<OutsourceDetailPayload | null>(null);
  const [closeLossSets, setCloseLossSets] = useState(0);
  const [closeLines, setCloseLines] = useState<CloseLineInput[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editDetail, setEditDetail] = useState<OutsourceDetailPayload | null>(null);
  /** 已有物料/成品回收入库流水时仅允许改备注与加工方 */
  const [editLocked, setEditLocked] = useState(false);
  /** 非 OPEN（已完结/已取消）：仅展示，不保存、不可改表单项 */
  const [editViewOnly, setEditViewOnly] = useState(false);
  const [editLines, setEditLines] = useState<EditOrderLine[]>([]);
  const [editForm] = Form.useForm<{
    productQty: number;
    remark?: string;
    supplierId?: string;
  }>();
  const [editStockByMaterial, setEditStockByMaterial] = useState<Record<string, number>>(
    {},
  );
  const [editLoadingStock, setEditLoadingStock] = useState(false);
  const [tab, setTab] = useState("add");
  const [form] = Form.useForm<{
    productQty: number;
    remark?: string;
    supplierId?: string;
  }>();
  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([]);

  const stockMaterialOptions = useMemo(
    () =>
      [...stockRows]
        .sort((a, b) => a.materialCode.localeCompare(b.materialCode, "zh-Hans-CN"))
        .map((r) => ({
          value: r.materialId,
          label: `${r.materialCode} ${r.materialName}`,
        }))
        .filter((item, idx, arr) => arr.findIndex((x) => x.value === item.value) === idx),
    [stockRows],
  );

  const [searchText, setSearchText] = useState("");
  const [productHits, setProductHits] = useState<OutsourceProductHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<OutsourceProductHit | null>(null);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [stockByMaterial, setStockByMaterial] = useState<Record<string, number>>({});
  const [loadingStock, setLoadingStock] = useState(false);

  const productQty = Form.useWatch("productQty", form) ?? 1;

  const hasStockShortage = useMemo(() => {
    if (lines.length === 0) return false;
    return lines.some(
      (l) => l.quantity > (stockByMaterial[l.materialId] ?? 0),
    );
  }, [lines, stockByMaterial]);

  const inhouseCreateRows = useMemo(
    () =>
      selectedProduct?.processingMode === "OUTSOURCE_INHOUSE" &&
      (selectedProduct.inhouseBom?.length ?? 0) > 0
        ? inhouseMaterialRowsForProductSets(
            selectedProduct.inhouseBom,
            productQty,
          )
        : [],
    [selectedProduct, productQty],
  );

  const recycleCap = useMemo(() => {
    if (!recycleDetail) return 0;
    return Math.min(
      setsPendingByMaterials(recycleDetail),
      maxRecycleSetsByOutsourceQty(recycleDetail),
    );
  }, [recycleDetail]);

  const recycleOkDisabled = useMemo(() => {
    if (recycleLoading || !recycleDetail) return true;
    if (recycleCap <= 0) return true;
    const n = Math.round(Number(recycleSetsThis)) || 0;
    if (n <= 0) return true;
    return n > recycleCap;
  }, [recycleLoading, recycleDetail, recycleCap, recycleSetsThis]);

  const runProductSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (q.length < 1) {
      setProductHits([]);
      return;
    }
    setSearchLoading(true);
    try {
      const data = await fetchJson<{ list: OutsourceProductHit[] }>(
        `/api/outsource-products?search=${encodeURIComponent(q)}`,
        { credentials: "include" },
      );
      setProductHits(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "检索失败");
      setProductHits([]);
    } finally {
      setSearchLoading(false);
    }
  }, [message]);

  const onSearchChange = (text: string) => {
    setSearchText(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      void runProductSearch(text);
    }, 320);
  };

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchJson<{ list: SupplierOpt[] }>(
          "/api/suppliers?outsourceOnly=true",
          {
            credentials: "include",
          },
        );
        if (!cancelled) setSuppliers(data.list ?? []);
      } catch {
        if (!cancelled) setSuppliers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedProduct) {
      setLines([]);
      return;
    }
    const qty = Math.max(1, Math.trunc(Number(productQty)) || 1);
    const computed = computeOutsourceLinesFromBom(
      selectedProduct.bom.map((b) => ({
        materialId: b.materialId,
        usageQty: b.usageQty,
      })),
      qty,
    );
    setLines(
      computed.map((row) => {
        const b = selectedProduct.bom.find((x) => x.materialId === row.materialId)!;
        return {
          materialId: row.materialId,
          code: b.material.code,
          name: b.material.name,
          unit: b.material.unit,
          quantity: row.quantity,
        };
      }),
    );
  }, [selectedProduct, productQty]);

  useEffect(() => {
    if (lines.length === 0) {
      setStockByMaterial({});
      setLoadingStock(false);
      return;
    }
    let cancelled = false;
    const ids = lines.map((l) => l.materialId);
    const sp = new URLSearchParams();
    sp.set("ids", ids.join(","));
    setLoadingStock(true);
    void (async () => {
      try {
        const data = await fetchJson<{ stocks: Record<string, number> }>(
          `/api/materials/stock-by-ids?${sp.toString()}`,
          { credentials: "include" },
        );
        if (!cancelled) setStockByMaterial(data.stocks ?? {});
      } catch {
        if (!cancelled) setStockByMaterial({});
      } finally {
        if (!cancelled) setLoadingStock(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lines]);

  const editHasStockShortage = useMemo(() => {
    if (editLines.length === 0) return false;
    return editLines.some(
      (l) => l.quantity > (editStockByMaterial[l.materialId] ?? 0),
    );
  }, [editLines, editStockByMaterial]);

  useEffect(() => {
    if (!editOpen || editLocked || editViewOnly || editLines.length === 0) {
      setEditStockByMaterial({});
      setEditLoadingStock(false);
      return;
    }
    let cancelled = false;
    const ids = editLines.map((l) => l.materialId);
    const sp = new URLSearchParams();
    sp.set("ids", ids.join(","));
    setEditLoadingStock(true);
    void (async () => {
      try {
        const data = await fetchJson<{ stocks: Record<string, number> }>(
          `/api/materials/stock-by-ids?${sp.toString()}`,
          { credentials: "include" },
        );
        if (!cancelled) setEditStockByMaterial(data.stocks ?? {});
      } catch {
        if (!cancelled) setEditStockByMaterial({});
      } finally {
        if (!cancelled) setEditLoadingStock(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editOpen, editLocked, editViewOnly, editLines]);

  const autoOptions = useMemo(
    () =>
      productHits.map((p) => ({
        value: p.id,
        label: productLabel(p),
      })),
    [productHits],
  );

  const onPickProduct = (productId: string) => {
    const hit = productHits.find((p) => p.id === productId);
    if (hit) {
      setSelectedProduct(hit);
      setSearchText(productLabel(hit));
    }
  };

  const resetAddForm = () => {
    form.resetFields();
    form.setFieldsValue({ productQty: 1, supplierId: undefined });
    setSearchText("");
    setProductHits([]);
    setSelectedProduct(null);
    setLines([]);
    setStockByMaterial({});
  };

  const submitCreate = async () => {
    if (!selectedProduct) {
      message.warning("请先检索并选择外发加工商品");
      return;
    }
    if (lines.length === 0) {
      message.warning("该商品无 BOM 行");
      return;
    }
    if (loadingStock) {
      message.warning("正在校验库存，请稍候");
      return;
    }
    if (hasStockShortage) {
      message.error("存在物料库存不足，请调减外发数量后再保存");
      return;
    }
    let v: { productQty: number; remark?: string; supplierId?: string };
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    const productQtyN = Math.max(1, Math.trunc(Number(v.productQty)) || 1);
    setSubmitting(true);
    try {
      await fetchJson("/api/outsource-orders", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProduct.id,
          productQty: productQtyN,
          supplierId: v.supplierId?.trim() || undefined,
          remark: v.remark?.trim() || undefined,
          lines: lines.map((l) => ({
            materialId: l.materialId,
            quantity: l.quantity,
          })),
        }),
      });
      message.success("外发单已创建");
      resetAddForm();
      void loadTodayOrders();
      setTab("open");
      void loadOpenOrders();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  const [openOrders, setOpenOrders] = useState<OutsourceOrderRow[]>([]);
  const [loadingOpen, setLoadingOpen] = useState(false);

  const loadOpenOrders = useCallback(async () => {
    setLoadingOpen(true);
    try {
      const data = await fetchJson<{ list: OutsourceOrderRow[] }>(
        "/api/outsource-orders?status=OPEN",
        { credentials: "include" },
      );
      setOpenOrders(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoadingOpen(false);
    }
  }, [message]);

  useEffect(() => {
    if (tab === "open") void loadOpenOrders();
  }, [tab, loadOpenOrders]);

  const [todayOrders, setTodayOrders] = useState<OutsourceOrderRow[]>([]);
  const [loadingTodayOrders, setLoadingTodayOrders] = useState(false);

  const loadTodayOrders = useCallback(async () => {
    setLoadingTodayOrders(true);
    try {
      const p = new URLSearchParams();
      p.set("from", dayjs().startOf("day").toISOString());
      p.set("to", dayjs().endOf("day").toISOString());
      const data = await fetchJson<{ list: OutsourceOrderRow[] }>(
        `/api/outsource-orders?${p.toString()}`,
        { credentials: "include" },
      );
      setTodayOrders(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoadingTodayOrders(false);
    }
  }, [message]);

  useEffect(() => {
    if (tab === "add") void loadTodayOrders();
  }, [tab, loadTodayOrders]);

  const closeTodayEdit = useCallback(() => {
    setEditOpen(false);
    setEditDetail(null);
    setEditLines([]);
    setEditLocked(false);
    setEditViewOnly(false);
    editForm.resetFields();
    setEditStockByMaterial({});
  }, [editForm]);

  const applyOutsourceDetailToEditModal = useCallback(
    (d: OutsourceDetailPayload) => {
      setEditDetail(d);
      const viewOnly = d.status !== "OPEN";
      setEditViewOnly(viewOnly);
      const matRecv = (d.materialReturnBatches ?? []).some((b) => b.quantity > 0);
      const prodRecv = (d.productRecoveryBatches ?? []).length > 0;
      setEditLocked(viewOnly || matRecv || prodRecv);
      editForm.setFieldsValue({
        productQty: d.productQty,
        remark: d.remark ?? undefined,
        supplierId: d.supplier?.id,
      });
      setEditLines(
        d.lines.map((l) => ({
          lineId: l.id,
          materialId: l.material.id,
          code: l.material.code,
          name: l.material.name,
          unit: l.material.unit,
          quantity: l.quantity,
        })),
      );
    },
    [editForm],
  );

  const openTodayEdit = useCallback(
    async (r: OutsourceOrderRow) => {
      if (r.status !== "OPEN") return;
      setEditOpen(true);
      setEditLoading(true);
      setEditDetail(null);
      setEditLines([]);
      try {
        const d = await fetchJson<OutsourceDetailPayload>(
          `/api/outsource-orders/${r.id}`,
          { credentials: "include" },
        );
        applyOutsourceDetailToEditModal(d);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载失败");
        closeTodayEdit();
      } finally {
        setEditLoading(false);
      }
    },
    [message, applyOutsourceDetailToEditModal, closeTodayEdit],
  );

  const openOutsourceOrderById = useCallback(
    async (orderId: string) => {
      setEditOpen(true);
      setEditLoading(true);
      setEditDetail(null);
      setEditLines([]);
      setEditViewOnly(false);
      setEditLocked(false);
      try {
        const d = await fetchJson<OutsourceDetailPayload>(
          `/api/outsource-orders/${orderId}`,
          { credentials: "include" },
        );
        applyOutsourceDetailToEditModal(d);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载失败");
        closeTodayEdit();
      } finally {
        setEditLoading(false);
      }
    },
    [message, applyOutsourceDetailToEditModal, closeTodayEdit],
  );

  const detailOutsourceOrderIdQ = searchParams.get("detailOutsourceOrderId");
  const outsourceLinkDone = useRef(false);
  useEffect(() => {
    if (!detailOutsourceOrderIdQ) {
      outsourceLinkDone.current = false;
      return;
    }
    if (outsourceLinkDone.current) return;
    outsourceLinkDone.current = true;
    const id = detailOutsourceOrderIdQ;
    void (async () => {
      try {
        await openOutsourceOrderById(id);
      } finally {
        router.replace(pathname, { scroll: false });
      }
    })();
  }, [detailOutsourceOrderIdQ, openOutsourceOrderById, pathname, router]);

  const submitTodayEdit = useCallback(async () => {
    if (!editDetail || editViewOnly) return;
    let v: { productQty: number; remark?: string; supplierId?: string };
    try {
      v = await editForm.validateFields();
    } catch {
      return;
    }
    if (!editLocked) {
      if (editLoadingStock) {
        message.warning("正在校验库存，请稍候");
        return;
      }
      if (editHasStockShortage) {
        message.error("存在物料外发数量大于当前库存，请调减后再保存");
        return;
      }
    }
    setEditSubmitting(true);
    try {
      const supplierId = v.supplierId?.trim() || null;
      const remarkTrim = v.remark?.trim();
      const remarkPayload = remarkTrim ? remarkTrim : null;
      if (editLocked) {
        await fetchJson(`/api/outsource-orders/${editDetail.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierId,
            remark: remarkPayload,
          }),
        });
      } else {
        const productQtyN = Math.max(1, Math.trunc(Number(v.productQty)) || 1);
        await fetchJson(`/api/outsource-orders/${editDetail.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierId,
            remark: remarkPayload,
            productQty: productQtyN,
            lines: editLines.map((l) => ({
              lineId: l.lineId,
              quantity: l.quantity,
            })),
          }),
        });
      }
      message.success("已保存");
      closeTodayEdit();
      void loadTodayOrders();
      void loadOpenOrders();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setEditSubmitting(false);
    }
  }, [
    editDetail,
    editLocked,
    editViewOnly,
    editForm,
    editLines,
    editLoadingStock,
    editHasStockShortage,
    message,
    closeTodayEdit,
    loadTodayOrders,
    loadOpenOrders,
  ]);

  const confirmCancelTodayOrder = useCallback(
    (r: OutsourceOrderRow) => {
      if (r.status !== "OPEN") return;
      if (r.canCancel === false) {
        message.warning("该外发单已有出货/回收入库记录，不可取消");
        return;
      }
      Modal.confirm({
        title: "取消此外发单？",
        content: `单号 ${r.orderNo} 将作废。`,
        okType: "danger",
        onOk: async () => {
          await fetchJson(`/api/outsource-orders/${r.id}`, {
            method: "DELETE",
            credentials: "include",
          });
          message.success("已取消");
          void loadTodayOrders();
          void loadOpenOrders();
        },
      });
    },
    [message, loadTodayOrders, loadOpenOrders],
  );

  const loadOutsourceMaterialStock = useCallback(
    async (params?: { keyword?: string; supplierId?: string; materialId?: string }) => {
      setLoadingStockTab(true);
      try {
        const keyword = params?.keyword ?? stockKeyword;
        const supplierId = params?.supplierId ?? stockSupplierId;
        const materialId = params?.materialId ?? stockMaterialId;
        const p = new URLSearchParams();
        if (keyword?.trim()) p.set("keyword", keyword.trim());
        if (supplierId?.trim()) p.set("supplierId", supplierId.trim());
        if (materialId?.trim()) p.set("materialId", materialId.trim());
        const data = await fetchJson<{ list: OutsourceMaterialStockRow[] }>(
          `/api/outsource-material-stock${p.toString() ? `?${p.toString()}` : ""}`,
          { credentials: "include" },
        );
        setStockRows(data.list ?? []);
        setStockSelectedRowKeys((prev) => {
          const keySet = new Set((data.list ?? []).map((x) => stockRowKey(x)));
          return prev.filter((k) => keySet.has(k));
        });
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载外发物料库存失败");
      } finally {
        setLoadingStockTab(false);
      }
    },
    [message, stockKeyword, stockSupplierId, stockMaterialId],
  );

  useEffect(() => {
    if (tab === "stock") {
      void loadOutsourceMaterialStock();
    }
  }, [tab, loadOutsourceMaterialStock]);

  const loadRecoveryStock = useCallback(
    async (keyword = "") => {
      setRecoveryLoading(true);
      try {
        const p = new URLSearchParams();
        if (keyword.trim()) p.set("keyword", keyword.trim());
        const data = await fetchJson<{ list: OutsourceRecoveryStockRow[] }>(
          `/api/outsource-recovery-stock${p.toString() ? `?${p.toString()}` : ""}`,
          { credentials: "include" },
        );
        setRecoveryRows(data.list ?? []);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载外发回收库失败");
      } finally {
        setRecoveryLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    recoveryKeywordRef.current = recoveryKeyword;
  }, [recoveryKeyword]);

  useEffect(() => {
    if (tab === "recovery") {
      void loadRecoveryStock(recoveryKeywordRef.current);
    }
  }, [tab, loadRecoveryStock]);

  const openRecoveryAdjust = useCallback((row: OutsourceRecoveryStockRow) => {
    setRecoveryAdjustTarget(row);
    setRecoveryAdjustQty(0);
    setRecoveryAdjustReason("");
    setRecoveryAdjustOpen(true);
  }, []);

  const submitRecoveryAdjust = useCallback(async () => {
    if (!recoveryAdjustTarget) return;
    const qty = Math.trunc(Number(recoveryAdjustQty));
    if (!Number.isFinite(qty) || qty === 0) {
      message.warning("请输入非 0 的调整数量（正数增加，负数减少）");
      return;
    }
    const reason = recoveryAdjustReason.trim();
    if (!reason) {
      message.warning("请填写调整原因");
      return;
    }
    setRecoveryAdjusting(true);
    try {
      await fetchJson<{ ok: true; currentQty: number }>(
        "/api/outsource-recovery-stock/adjust",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: recoveryAdjustTarget.productId,
            quantity: qty,
            reason,
          }),
        },
      );
      message.success("回收库库存已调整");
      setRecoveryAdjustOpen(false);
      setRecoveryAdjustTarget(null);
      await loadRecoveryStock(recoveryKeyword);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "调整失败");
    } finally {
      setRecoveryAdjusting(false);
    }
  }, [
    loadRecoveryStock,
    message,
    recoveryAdjustQty,
    recoveryAdjustReason,
    recoveryAdjustTarget,
    recoveryKeyword,
  ]);

  const openStockReturnModal = useCallback(() => {
    const selected = stockRows.filter((r) =>
      stockSelectedRowKeys.includes(stockRowKey(r)),
    );
    const candidates = selected
      .filter((r) => r.closedCarryQty > 0)
      .map((r) => ({
        key: stockRowKey(r),
        supplierId: r.supplierId,
        supplierName:
          r.supplierName?.trim() || r.supplierCode?.trim() || "未指定加工方",
        materialId: r.materialId,
        materialCode: r.materialCode,
        materialName: r.materialName,
        unit: r.unit,
        maxReturnQty: r.closedCarryQty,
        returnQty: r.closedCarryQty,
        scrapQty: 0,
      }));
    if (candidates.length === 0) {
      message.warning("请先勾选可退料行（已结单未退回数量需大于 0）");
      return;
    }
    setStockReturnLines(candidates);
    setStockReturnOpen(true);
  }, [stockRows, stockSelectedRowKeys, message]);

  const submitStockReturn = useCallback(async () => {
    const payloadLines = stockReturnLines
      .map((x) => ({
        supplierId: x.supplierId,
        materialId: x.materialId,
        returnQty: Math.max(0, Math.trunc(Number(x.returnQty) || 0)),
        scrapQty: Math.max(0, Math.trunc(Number(x.scrapQty) || 0)),
      }))
      .filter((x) => x.returnQty > 0 || x.scrapQty > 0);
    if (payloadLines.length === 0) {
      message.warning("请至少填写一行退料或报废数量（大于 0）");
      return;
    }
    setStockReturning(true);
    try {
      const res = await fetchJson<{ totalReturned?: number; totalScrapped?: number }>(
        "/api/outsource-material-stock/return",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines: payloadLines }),
        },
      );
      message.success(
        `处理成功：退料入库 ${Math.max(0, Number(res.totalReturned ?? 0))}，报废 ${Math.max(0, Number(res.totalScrapped ?? 0))}`,
      );
      setStockReturnOpen(false);
      setStockReturnLines([]);
      setStockSelectedRowKeys([]);
      await loadOutsourceMaterialStock({
        keyword: stockKeyword,
        supplierId: stockSupplierId,
        materialId: stockMaterialId,
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "退料失败");
    } finally {
      setStockReturning(false);
    }
  }, [
    stockReturnLines,
    message,
    loadOutsourceMaterialStock,
    stockKeyword,
    stockSupplierId,
    stockMaterialId,
  ]);

  const openStockHistory = useCallback(
    async (row: OutsourceMaterialStockRow) => {
      setStockHistoryTarget(row);
      setStockHistoryRows([]);
      setStockHistoryOpen(true);
      setStockHistoryLoading(true);
      try {
        const p = new URLSearchParams();
        p.set("materialId", row.materialId);
        p.set("supplierId", row.supplierId ?? "NONE");
        const data = await fetchJson<{ list: OutsourceStockHistoryRow[] }>(
          `/api/outsource-material-stock/history?${p.toString()}`,
          { credentials: "include" },
        );
        setStockHistoryRows(data.list ?? []);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载出入库明细失败");
        setStockHistoryRows([]);
      } finally {
        setStockHistoryLoading(false);
      }
    },
    [message],
  );

  const exportStockHistoryToExcel = useCallback(async () => {
    if (!stockHistoryTarget || stockHistoryRows.length === 0) return;
    setStockHistoryExporting(true);
    try {
      const XLSX = await import("xlsx");
      const rows = stockHistoryRows.map((x) => ({
        时间: dayjs(x.receivedAt).format("YYYY-MM-DD HH:mm:ss"),
        方向: x.direction === "IN" ? "入库" : "出库",
        数量: x.quantity,
        外发单号: x.orderNo || "—",
        说明: x.partDescription || "—",
        操作人: x.operatorName || "—",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "出入库明细");
      XLSX.writeFile(
        wb,
        `外发库存明细_${stockHistoryTarget.materialCode}_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`,
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setStockHistoryExporting(false);
    }
  }, [stockHistoryRows, stockHistoryTarget, message]);

  const applyLossSetsToCloseLines = useCallback(
    (detail: OutsourceDetailPayload, lossSets: number, prev: CloseLineInput[]) => {
      const bom = bomPerSetMap(detail.product.productMaterials);
      const sets = Math.max(0, Math.trunc(Number(lossSets) || 0));
      return prev.map((x) => {
        const dLine = detail.lines.find((l) => l.id === x.lineId);
        if (!dLine) return x;
        const perSet = perSetForLine(dLine, detail, bom);
        const lossBySets = Math.max(0, perSet) * sets;
        const maxReturn = Math.max(0, x.currentQty - lossBySets);
        const returnQty = Math.min(Math.max(0, Math.trunc(Number(x.returnQty) || 0)), maxReturn);
        return { ...x, lossBySets, returnQty };
      });
    },
    [],
  );

  const openCloseModal = useCallback(
    async (r: OutsourceOrderRow) => {
      if (r.status !== "OPEN") return;
      setCloseOrder(r);
      setCloseDetail(null);
      setCloseOpen(true);
      setCloseLoading(true);
      setCloseLossSets(0);
      setCloseLines([]);
      try {
        const d = await fetchJson<OutsourceDetailPayload>(`/api/outsource-orders/${r.id}`, {
          credentials: "include",
        });
        setCloseDetail(d);
        const base = d.lines.map((l) => ({
            lineId: l.id,
            materialId: l.material.id,
            code: l.material.code,
            name: l.material.name,
            unit: l.material.unit,
            currentQty: Math.max(0, Math.trunc(Number(l.quantity) || 0)),
            lossBySets: 0,
            returnQty: 0,
          }));
        setCloseLines(applyLossSetsToCloseLines(d, 0, base));
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载结单明细失败");
        setCloseOpen(false);
        setCloseOrder(null);
        setCloseDetail(null);
      } finally {
        setCloseLoading(false);
      }
    },
    [message, applyLossSetsToCloseLines],
  );

  const submitCloseOrder = useCallback(async () => {
    if (!closeOrder) return;
    for (const row of closeLines) {
      const ret = Math.max(0, Math.trunc(Number(row.returnQty) || 0));
      if (row.lossBySets + ret > row.currentQty) {
        message.error(`${row.code}：损耗+退回不能超过当前在外数量`);
        return;
      }
    }
    setCloseSubmitting(true);
    try {
      const res = await fetchJson<{
        ok?: boolean;
        lossSets?: number;
        returnedQtyTotal?: number;
        lossQtyTotal?: number;
      }>(
        `/api/outsource-orders/${closeOrder.id}/close`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lossSets: Math.max(0, Math.trunc(Number(closeLossSets) || 0)),
            lines: closeLines.map((x) => ({
              lineId: x.lineId,
              returnQty: Math.max(0, Math.trunc(Number(x.returnQty) || 0)),
            })),
          }),
        },
      );
      const returned = Math.max(0, Math.trunc(Number(res.returnedQtyTotal ?? 0)));
      const loss = Math.max(0, Math.trunc(Number(res.lossQtyTotal ?? 0)));
      const lossSetsDone = Math.max(0, Math.trunc(Number(res.lossSets ?? closeLossSets)));
      message.success(`已结单（损耗 ${lossSetsDone} 套，折算损耗物料 ${loss}，退回 ${returned}）`);
      setCloseOpen(false);
      setCloseOrder(null);
      setCloseDetail(null);
      setCloseLossSets(0);
      setCloseLines([]);
      void loadTodayOrders();
      void loadOpenOrders();
      if (tab === "stock") {
        void loadOutsourceMaterialStock({
          keyword: stockKeyword,
          supplierId: stockSupplierId,
          materialId: stockMaterialId,
        });
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "结单失败");
    } finally {
      setCloseSubmitting(false);
    }
  }, [
    closeOrder,
    closeLines,
    closeLossSets,
    message,
    loadTodayOrders,
    loadOpenOrders,
    tab,
    loadOutsourceMaterialStock,
    stockKeyword,
    stockSupplierId,
    stockMaterialId,
  ]);

  const [queryOrders, setQueryOrders] = useState<OutsourceOrderRow[]>([]);
  const [loadingQuery, setLoadingQuery] = useState(false);
  const [queryForm] = Form.useForm<{
    keyword?: string;
    range?: [dayjs.Dayjs, dayjs.Dayjs];
  }>();

  const runQuery = async () => {
    const v = (await queryForm.validateFields().catch(() => ({}))) as {
      keyword?: string;
      range?: [dayjs.Dayjs, dayjs.Dayjs];
    };
    const p = new URLSearchParams();
    /** 加工单查询仅收录已回收（CLOSED） */
    p.set("status", "CLOSED");
    if (v.keyword?.trim()) p.set("keyword", v.keyword.trim());
    const range = v.range as [dayjs.Dayjs, dayjs.Dayjs] | undefined;
    if (range?.[0]) p.set("from", range[0].startOf("day").toISOString());
    if (range?.[1]) p.set("to", range[1].endOf("day").toISOString());
    setLoadingQuery(true);
    try {
      const data = await fetchJson<{ list: OutsourceOrderRow[] }>(
        `/api/outsource-orders?${p.toString()}`,
        { credentials: "include" },
      );
      setQueryOrders(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "查询失败");
    } finally {
      setLoadingQuery(false);
    }
  };

  useEffect(() => {
    if (tab !== "query") return;
    void (async () => {
      setLoadingQuery(true);
      try {
        const data = await fetchJson<{ list: OutsourceOrderRow[] }>(
          "/api/outsource-orders?status=CLOSED",
          { credentials: "include" },
        );
        setQueryOrders(data.list ?? []);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoadingQuery(false);
      }
    })();
  }, [tab, message]);

  const openSlipPreview = useCallback((r: OutsourceOrderRow) => {
    setSlipPreviewId(r.id);
    setSlipPreviewOrderNo(r.orderNo);
    setSlipPreviewOpen(true);
  }, []);

  const openRecycleModal = useCallback(
    async (r: OutsourceOrderRow) => {
      if (r.status !== "OPEN") return;
      setRecycleOrderId(r.id);
      setRecycleOrderNo(r.orderNo);
      setRecycleDetail(null);
      setRecycleSetsThis(0);
      setRecycleOpen(true);
      setRecycleLoading(true);
      try {
        const d = await fetchJson<OutsourceDetailPayload>(
          `/api/outsource-orders/${r.id}`,
          { credentials: "include" },
        );
        setRecycleDetail(d);
        setRecycleSetsThis(
          Math.min(
            setsPendingByMaterials(d),
            maxRecycleSetsByOutsourceQty(d),
          ),
        );
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载失败");
        setRecycleOpen(false);
        setRecycleOrderId(null);
        setRecycleOrderNo(null);
      } finally {
        setRecycleLoading(false);
      }
    },
    [message],
  );

  const submitRecycle = useCallback(async () => {
    if (!recycleDetail || !recycleOrderId) {
      return Promise.reject(new Error("未就绪"));
    }
    const maxByMaterials = setsPendingByMaterials(recycleDetail);
    const maxByOutsource = maxRecycleSetsByOutsourceQty(recycleDetail);
    const sets = Math.round(Number(recycleSetsThis)) || 0;
    if (sets <= 0) {
      message.warning("本次回收套数须大于 0");
      return Promise.reject(new Error("validation"));
    }
    if (sets > maxByOutsource) {
      message.warning("数量超过外发数量");
      return Promise.reject(new Error("validation"));
    }
    if (sets > maxByMaterials) {
      message.warning(`本次回收套数不能超过待收套数（${maxByMaterials}）`);
      return Promise.reject(new Error("validation"));
    }
    const bom = bomPerSetMap(recycleDetail.product.productMaterials);
    const linesPayload = recycleDetail.lines.map((l) => {
      const perSet = perSetForLine(l, recycleDetail, bom);
      const need = perSet > 0 ? perSet * sets : 0;
      const receivedQty = Math.min(l.quantity, need);
      return { lineId: l.id, receivedQty };
    });
    setRecycleSubmitting(true);
    try {
      const res = await fetchJson<{ ok?: boolean; fullyClosed?: boolean }>(
        `/api/outsource-orders/${recycleOrderId}/receive`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lines: linesPayload,
          }),
        },
      );
      if (res.fullyClosed) {
        message.success("已全部回收；物料已回库，成品已按加工套数入库");
      } else {
        message.success(
          "本次回收已入库物料；未回收数量仍保留在本单，可再次点击「确认回收」",
        );
      }
      setRecycleOpen(false);
      setRecycleOrderId(null);
      setRecycleOrderNo(null);
      setRecycleDetail(null);
      setRecycleSetsThis(0);
      void loadOpenOrders();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "回收失败");
      return Promise.reject(e instanceof Error ? e : new Error("fail"));
    } finally {
      setRecycleSubmitting(false);
    }
  }, [
    message,
    recycleDetail,
    recycleOrderId,
    recycleSetsThis,
    loadOpenOrders,
  ]);

  const exportQueryToExcel = useCallback(async () => {
    if (queryOrders.length === 0) {
      message.warning("暂无数据可导出");
      return;
    }
    setExportingQuery(true);
    try {
      const XLSX = await import("xlsx");
      const rows = queryOrders.map((r) => ({
        外发单号: r.orderNo,
        加工方: r.supplier ? formatSupplierChinese(r.supplier) : "—",
        状态: STATUS_TAG[r.status].text,
        客户代码: r.product.customer.code,
        客户名称: r.product.customer.name,
        物料编号: r.product.customerMaterialCode || "—",
        型号: r.product.model || "—",
        加工套数: r.productQty,
        建单时间: dayjs(r.createdAt).format("YYYY-MM-DD HH:mm"),
        回收时间: r.receivedAt ? dayjs(r.receivedAt).format("YYYY-MM-DD HH:mm") : "—",
        外发物料: r.lines.map((l) => `${l.material.code}×${l.quantity}`).join("；"),
        备注: r.remark?.trim() || "—",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "已回收外发单");
      XLSX.writeFile(
        wb,
        `外发加工单查询_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`,
      );
      message.success("已导出");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExportingQuery(false);
    }
  }, [message, queryOrders]);

  const orderColumns: ColumnsType<OutsourceOrderRow> = useMemo(
    () => [
    { title: "外发单号", dataIndex: "orderNo", width: 160, ellipsis: true },
    {
      title: "加工方",
      key: "supplier",
      width: 160,
      ellipsis: true,
      render: (_, r) => (r.supplier ? formatSupplierChinese(r.supplier) : "—"),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 88,
      render: (s: OutsourceOrderRow["status"]) => {
        const t = STATUS_TAG[s];
        return <Tag color={t.color}>{t.text}</Tag>;
      },
    },
    {
      title: "客户名称 / 型号",
      key: "p",
      ellipsis: true,
      render: (_, r) =>
        `${r.product.customer.name || "—"} / ${r.product.model?.trim() || "—"}`,
    },
    { title: "加工套数", dataIndex: "productQty", width: 96 },
    {
      title: "建单时间",
      dataIndex: "createdAt",
      width: 168,
      render: (t: string) => dayjs(t).format("YYYY-MM-DD HH:mm"),
    },
    {
      title: "回收时间",
      dataIndex: "receivedAt",
      width: 168,
      render: (t: string | null) => (t ? dayjs(t).format("YYYY-MM-DD HH:mm") : "—"),
    },
    {
      title: "外发物料",
      key: "lines",
      width: 108,
      align: "center",
      render: (_, r) => {
        const kindCount = new Set(r.lines.map((l) => l.material.id)).size;
        return kindCount;
      },
    },
    {
      title: "备注",
      dataIndex: "remark",
      ellipsis: true,
      render: (t: string | null) => t?.trim() || "—",
    },
    {
      key: "slipPreview",
      title: "外发单预览",
      width: 104,
      fixed: "right",
      render: (_, r) => (
        <Button
          type="link"
          size="small"
          style={{ padding: 0, height: "auto" }}
          onClick={() => openSlipPreview(r)}
        >
          预览
        </Button>
      ),
    },
    ],
    [openSlipPreview],
  );

  const openActionColumn: ColumnsType<OutsourceOrderRow>[number] = {
    title: "操作",
    key: "op",
    width: 260,
    fixed: "right",
    render: (_, r) => {
      const canModifyOrCancel = r.canCancel !== false;
      return (
        <Space>
          <Button
            type="link"
            size="small"
            onClick={() => void openRecycleModal(r)}
          >
            确认回收
          </Button>
          {canModifyOrCancel ? (
            <>
              <Button
                type="link"
                size="small"
                onClick={() => void openTodayEdit(r)}
              >
                修改
              </Button>
              <Button
                type="link"
                size="small"
                danger
                onClick={() => {
                  Modal.confirm({
                    title: "取消此外发单？",
                    content: `单号 ${r.orderNo} 将作废。`,
                    okType: "danger",
                    onOk: async () => {
                      await fetchJson(`/api/outsource-orders/${r.id}`, {
                        method: "DELETE",
                        credentials: "include",
                      });
                      message.success("已取消");
                      void loadOpenOrders();
                    },
                  });
                }}
              >
                取消
              </Button>
            </>
          ) : null}
          <Button
            type="link"
            size="small"
            style={{ padding: 0, height: "auto" }}
            onClick={() => void openCloseModal(r)}
          >
            结单
          </Button>
        </Space>
      );
    },
  };

  const applyBomToEditLines = useCallback(() => {
    if (!editDetail || editLocked) return;
    const qty = Math.max(
      1,
      Math.trunc(Number(editForm.getFieldValue("productQty"))) || 1,
    );
    const bom = editDetail.product.productMaterials ?? [];
    if (bom.length === 0) return;
    const computed = computeOutsourceLinesFromBom(
      bom.map((m) => ({
        materialId: m.materialId,
        usageQty: m.usageQty,
      })),
      qty,
    );
    setEditLines(
      computed.map((row) => {
        const src = editDetail.lines.find((l) => l.material.id === row.materialId)!;
        return {
          lineId: src.id,
          materialId: row.materialId,
          code: src.material.code,
          name: src.material.name,
          unit: src.material.unit,
          quantity: row.quantity,
        };
      }),
    );
  }, [editDetail, editLocked, editForm]);

  const todayActionColumn: ColumnsType<OutsourceOrderRow>[number] = useMemo(
    () => ({
      title: "操作",
      key: "todayOp",
      width: 140,
      fixed: "right",
      render: (_, r) => {
        if (r.status !== "OPEN") {
          return <Typography.Text type="secondary">—</Typography.Text>;
        }
        const canModifyOrCancel = r.canCancel !== false;
        return (
          <Space size={0} wrap>
            {canModifyOrCancel ? (
              <>
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: "auto" }}
                  onClick={() => void openTodayEdit(r)}
                >
                  编辑
                </Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  style={{ padding: 0, height: "auto" }}
                  onClick={() => confirmCancelTodayOrder(r)}
                >
                  取消
                </Button>
              </>
            ) : null}
          </Space>
        );
      },
    }),
    [openTodayEdit, confirmCancelTodayOrder],
  );

  const lineEditColumns: ColumnsType<EditableLine> = [
    { title: "物料编号", dataIndex: "code", width: 120 },
    { title: "物料名称", dataIndex: "name", ellipsis: true },
    { title: "单位", dataIndex: "unit", width: 64 },
    {
      title: "可用库存",
      key: "stock",
      width: 96,
      render: (_, row) =>
        loadingStock ? (
          <Typography.Text type="secondary">…</Typography.Text>
        ) : (
          <Typography.Text>{stockByMaterial[row.materialId] ?? 0}</Typography.Text>
        ),
    },
    {
      title: "外发数量",
      dataIndex: "quantity",
      width: 140,
      render: (_, row, index) => {
        const avail = stockByMaterial[row.materialId] ?? 0;
        const over = !loadingStock && row.quantity > avail;
        return (
          <div>
            <InputNumber
              min={1}
              max={999999999}
              precision={0}
              value={row.quantity}
              status={over ? "error" : undefined}
              onChange={(v) => {
                const n =
                  v === null || v === undefined
                    ? 1
                    : Math.max(1, Math.trunc(Number(v)));
                setLines((prev) =>
                  prev.map((l, i) => (i === index ? { ...l, quantity: n } : l)),
                );
              }}
            />
            {over ? (
              <div>
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  超出库存（可用 {avail}）
                </Typography.Text>
              </div>
            ) : null}
          </div>
        );
      },
    },
  ];

  const { loading: tabPermLoading, allowed } = useMeTabPermissions();
  const canAdjustRecovery = allowed(["outsource.recovery.adjust"]);

  const visibleOutsourceTabKeys = useMemo(
    () =>
      (["add", "open", "query", "stock", "recovery", "settings"] as const).filter((k) =>
        allowed([OUTSOURCE_TAB_PERM[k]]),
      ),
    [allowed],
  );

  useEffect(() => {
    if (tabPermLoading) return;
    if (visibleOutsourceTabKeys.length === 0) return;
    const keys = visibleOutsourceTabKeys as readonly string[];
    if (!keys.includes(tab)) {
      setTab(keys[0] ?? "add");
    }
  }, [tabPermLoading, visibleOutsourceTabKeys, tab]);

  return (
    <Card title="物料外发">
      {tabPermLoading ? (
        <div style={{ padding: 56, textAlign: "center" }}>
          <Spin size="large" />
        </div>
      ) : visibleOutsourceTabKeys.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          当前账号无可用的物料外发 TAB，请联系管理员在「员工管理 → 权限管理」中勾选对应 TAB。
        </Typography.Paragraph>
      ) : (
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "add",
            label: "新增外发订单",
            children: (
              <Form form={form} layout="vertical" initialValues={{ productQty: 1 }}>
                <Space direction="vertical" size="large" style={{ width: "100%" }}>
                  <div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Typography.Text strong>选择商品</Typography.Text>
                      <HelpTip
                        text={
                          <>
                            仅展示在「商品信息」中标记为<strong>外发加工</strong>
                            的商品。输入关键字自动匹配，填写加工套数后按 BOM 用量推算外发物料数量（可逐行修改），保存生成外发单。选择
                            <strong>加工方（供应商）</strong>
                            后，外发单号按「外发单设置 → 外发物料单模版」中的规则生成（含供应商简称、日期与年度流水）；不选则沿用按日流水单号。
                          </>
                        }
                      />
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <AutoComplete
                        style={{ width: "100%", maxWidth: 720 }}
                        options={autoOptions}
                        value={searchText}
                        onSearch={onSearchChange}
                        onSelect={(id) => onPickProduct(String(id))}
                        placeholder="输入型号、客户物料编号、规格、客户名称等"
                        allowClear
                        onClear={() => {
                          setSelectedProduct(null);
                          setSearchText("");
                          setProductHits([]);
                        }}
                        notFoundContent={searchLoading ? "检索中…" : "无匹配商品"}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: 20 }}>
                    <Space align="center" style={{ marginBottom: 8 }}>
                      <Typography.Text strong>当日外发订单</Typography.Text>
                      <Button size="small" onClick={() => void loadTodayOrders()}>
                        刷新
                      </Button>
                    </Space>
                    <Table<OutsourceOrderRow>
                      rowKey="id"
                      size="small"
                      loading={loadingTodayOrders}
                      dataSource={todayOrders}
                      columns={[...orderColumns, todayActionColumn]}
                      scroll={{ x: "max-content" }}
                      pagination={{ pageSize: 8, showSizeChanger: false }}
                      locale={{ emptyText: "今日尚无外发单" }}
                    />
                  </div>
                  {selectedProduct ? (
                    <>
                      <Form.Item name="supplierId" label="加工方（供应商）">
                        <Select
                          allowClear
                          placeholder="可选；用于外发物料单抬头与单号规则"
                          style={{ maxWidth: 480 }}
                          showSearch
                          optionFilterProp="label"
                          options={suppliers.map((s) => ({
                            value: s.id,
                            label: formatSupplierSelectLabel(s),
                          }))}
                        />
                      </Form.Item>
                      <Space wrap align="start">
                        <Form.Item
                          name="productQty"
                          label="外发加工套数"
                          rules={[{ required: true, message: "请填写套数" }]}
                        >
                          <InputNumber min={1} max={999999999} precision={0} style={{ width: 160 }} />
                        </Form.Item>
                        <Form.Item name="remark" label="备注" style={{ minWidth: 280 }}>
                          <Input.TextArea rows={1} placeholder="可选" allowClear />
                        </Form.Item>
                      </Space>
                      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                        已选：{productLabel(selectedProduct)}（单位：{selectedProduct.unit}）
                      </Typography.Text>
                      {hasStockShortage && !loadingStock ? (
                        <Typography.Paragraph type="danger" style={{ marginBottom: 8 }}>
                          存在物料外发数量大于当前库存（与「物料信息 → 物料库存」一致），请调减后再保存；库存不足时无法生成外发单。
                        </Typography.Paragraph>
                      ) : null}
                      <Table<EditableLine>
                        size="small"
                        rowKey="materialId"
                        pagination={false}
                        columns={lineEditColumns}
                        dataSource={lines}
                        locale={{ emptyText: "无 BOM 物料" }}
                        onRow={(record) => ({
                          style:
                            !loadingStock &&
                            record.quantity > (stockByMaterial[record.materialId] ?? 0)
                              ? { background: "#fff1f0" }
                              : undefined,
                        })}
                      />
                      <Space>
                        <Button
                          type="primary"
                          loading={submitting}
                          disabled={loadingStock || hasStockShortage}
                          onClick={() => void submitCreate()}
                        >
                          保存外发单
                        </Button>
                        <Button onClick={resetAddForm}>清空</Button>
                      </Space>
                      {inhouseCreateRows.length > 0 ? (
                        <div style={{ marginTop: 12 }}>
                          <Typography.Text
                            type="danger"
                            style={{ display: "block", lineHeight: 1.5 }}
                          >
                            自加工部分（不随本外发单发外协；厂内加工时需扣/备以下物料。数量按上表外发套数、与
                            商品中「自加工物料」BOM 用量及取整规则计算）：
                          </Typography.Text>
                          <ul
                            style={{
                              margin: "8px 0 0 0",
                              paddingLeft: 20,
                              color: "#cf1322",
                            }}
                          >
                            {inhouseCreateRows.map((r) => (
                              <li key={`${r.label}`}>
                                {r.label}：{r.quantity} {r.unit}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </Space>
              </Form>
            ),
          },
          {
            key: "open",
            label: "未回收外加工单",
            children: (
              <Space direction="vertical" style={{ width: "100%" }}>
                <Space>
                  <Button onClick={() => void loadOpenOrders()}>刷新</Button>
                </Space>
                <Table<OutsourceOrderRow>
                  rowKey="id"
                  loading={loadingOpen}
                  dataSource={openOrders}
                  columns={[...orderColumns, openActionColumn]}
                  scroll={{ x: "max-content" }}
                  pagination={{ pageSize: 10 }}
                />
              </Space>
            ),
          },
          {
            key: "query",
            label: "外发加工单查询",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <Form form={queryForm} layout="inline" style={{ rowGap: 12 }}>
                  <Form.Item name="keyword" label="关键字">
                    <Input allowClear placeholder="单号 / 型号 / 物料编号 / 客户" style={{ width: 220 }} />
                  </Form.Item>
                  <Form.Item name="range" label="建单日期">
                    <DatePicker.RangePicker />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" onClick={() => void runQuery()}>
                      查询
                    </Button>
                  </Form.Item>
                  <Form.Item style={{ marginInlineStart: "auto" }}>
                    <HelpTip
                      text={
                        <>
                          仅展示<strong>已回收</strong>的外发加工单；未回收请在「未回收外加工单」中处理。
                        </>
                      }
                    />
                  </Form.Item>
                </Form>
                <Table<OutsourceOrderRow>
                  rowKey="id"
                  loading={loadingQuery}
                  dataSource={queryOrders}
                  columns={orderColumns}
                  scroll={{ x: "max-content" }}
                  pagination={{
                    defaultPageSize: 10,
                    showSizeChanger: true,
                    pageSizeOptions: [10, 20, 50, 100],
                  }}
                />
                <Button
                  type="default"
                  onClick={() => void exportQueryToExcel()}
                  loading={exportingQuery}
                  disabled={loadingQuery || queryOrders.length === 0}
                >
                  导出 Excel
                </Button>
              </Space>
            ),
          },
          {
            key: "stock",
            label: "外发物料库存",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <Space wrap>
                  <Select
                    allowClear
                    placeholder="加工方（全部）"
                    style={{ width: 260 }}
                    value={stockSupplierId}
                    onChange={(v) => setStockSupplierId(v)}
                    options={[
                      { value: "NONE", label: "未指定加工方" },
                      ...suppliers.map((s) => ({
                        value: s.id,
                        label: formatSupplierSelectLabel(s),
                      })),
                    ]}
                    optionFilterProp="label"
                    showSearch
                  />
                  <Select
                    allowClear
                    placeholder="物料名称（全部）"
                    style={{ width: 280 }}
                    value={stockMaterialId}
                    onChange={(v) => setStockMaterialId(v)}
                    options={stockMaterialOptions}
                    optionFilterProp="label"
                    showSearch
                  />
                  <Input
                    allowClear
                    placeholder="加工方 / 物料编号 / 物料名称 / 单号"
                    style={{ width: 280 }}
                    value={stockKeyword}
                    onChange={(e) => setStockKeyword(e.target.value)}
                    onPressEnter={() =>
                      void loadOutsourceMaterialStock({
                        keyword: stockKeyword,
                        supplierId: stockSupplierId,
                        materialId: stockMaterialId,
                      })
                    }
                  />
                  <Button
                    type="primary"
                    onClick={() =>
                      void loadOutsourceMaterialStock({
                        keyword: stockKeyword,
                        supplierId: stockSupplierId,
                        materialId: stockMaterialId,
                      })
                    }
                  >
                    查询
                  </Button>
                  {stockSelectedRowKeys.length > 0 ? (
                    <Button danger type="primary" onClick={openStockReturnModal}>
                      退料
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => {
                      setStockKeyword("");
                      setStockSupplierId(undefined);
                      setStockMaterialId(undefined);
                      setStockSelectedRowKeys([]);
                      void loadOutsourceMaterialStock({
                        keyword: "",
                        supplierId: undefined,
                        materialId: undefined,
                      });
                    }}
                  >
                    重置
                  </Button>
                  <HelpTip
                    text={
                      <>
                        统计口径：新建外发单计入在外库存；确认回收按消耗扣减。结单时可登记损耗与退回，损耗扣减在外库存，退回回写到物料库存。
                      </>
                    }
                  />
                </Space>
                <Table<OutsourceMaterialStockRow>
                  rowKey={stockRowKey}
                  loading={loadingStockTab}
                  dataSource={stockRows}
                  pagination={{
                    defaultPageSize: 10,
                    showSizeChanger: true,
                    pageSizeOptions: [10, 20, 50, 100],
                  }}
                  scroll={{ x: "max-content" }}
                  rowSelection={{
                    selectedRowKeys: stockSelectedRowKeys,
                    onChange: (keys) => setStockSelectedRowKeys(keys.map((k) => String(k))),
                    getCheckboxProps: (r) => ({
                      disabled: r.closedCarryQty <= 0,
                    }),
                  }}
                  columns={[
                    {
                      title: "加工方",
                      key: "supplier",
                      width: 180,
                      render: (_, r) => r.supplierName?.trim() || r.supplierCode?.trim() || "未指定加工方",
                    },
                    { title: "物料编号", dataIndex: "materialCode", width: 140 },
                    { title: "物料名称", dataIndex: "materialName", width: 220, ellipsis: true },
                    { title: "单位", dataIndex: "unit", width: 80 },
                    { title: "在外库存", dataIndex: "quantity", width: 110, align: "right" },
                    { title: "未回收单占用", dataIndex: "openQty", width: 126, align: "right" },
                    { title: "已结单未退回", dataIndex: "closedCarryQty", width: 126, align: "right" },
                    { title: "关联单数", dataIndex: "orderCount", width: 96, align: "right" },
                    {
                      title: "详情",
                      key: "detail",
                      width: 88,
                      render: (_, r) => (
                        <Button type="link" size="small" onClick={() => void openStockHistory(r)}>
                          详情
                        </Button>
                      ),
                    },
                  ]}
                  locale={{ emptyText: "暂无在外物料库存" }}
                />
              </Space>
            ),
          },
          {
            key: "recovery",
            label: "外发回收库",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <Space wrap>
                  <Input
                    allowClear
                    placeholder="客户 / WF料号 / 商品型号"
                    style={{ width: 320 }}
                    value={recoveryKeyword}
                    onChange={(e) => setRecoveryKeyword(e.target.value)}
                    onPressEnter={() => void loadRecoveryStock(recoveryKeyword)}
                  />
                  <Button type="primary" onClick={() => void loadRecoveryStock(recoveryKeyword)}>
                    查询
                  </Button>
                  <Button
                    onClick={() => {
                      setRecoveryKeyword("");
                      void loadRecoveryStock("");
                    }}
                  >
                    重置
                  </Button>
                  <HelpTip
                    text={
                      <>
                        仅统计「外发+自加工」商品的外发回收库存；列表料号以 <strong>WF-</strong>
                        前缀表示外发回来的半成品，与商品档案客户料号对应（如档案为 ABC 则显示 WF-ABC）。仓库出货时从该库扣减，并同步扣减自加工物料库存。
                      </>
                    }
                  />
                </Space>
                <Table<OutsourceRecoveryStockRow>
                  rowKey="productId"
                  loading={recoveryLoading}
                  dataSource={recoveryRows}
                  pagination={{
                    defaultPageSize: 10,
                    showSizeChanger: true,
                    pageSizeOptions: [10, 20, 50, 100],
                  }}
                  scroll={{ x: "max-content" }}
                  columns={[
                    {
                      title: "客户",
                      key: "customer",
                      width: 220,
                      render: (_, r) => `${r.customerCode} ${r.customerName}`,
                    },
                    {
                      title: "回收料号",
                      dataIndex: "recoveryMaterialCode",
                      width: 148,
                      render: (v: string, r) =>
                        v ||
                        formatOutsourceRecoveryMaterialCode(r.customerMaterialCode),
                    },
                    { title: "商品型号", dataIndex: "model", width: 180, ellipsis: true },
                    { title: "单位", dataIndex: "unit", width: 80 },
                    { title: "回收库库存", dataIndex: "quantity", width: 120, align: "right" },
                    {
                      title: "最近变动",
                      dataIndex: "lastReceivedAt",
                      width: 170,
                      render: (v: string | null) =>
                        v ? dayjs(v).format("YYYY-MM-DD HH:mm:ss") : "—",
                    },
                    {
                      title: "操作",
                      key: "actions",
                      width: 120,
                      render: (_, r) =>
                        canAdjustRecovery ? (
                          <Button size="small" onClick={() => openRecoveryAdjust(r)}>
                            手动调整
                          </Button>
                        ) : (
                          "—"
                        ),
                    },
                  ]}
                  locale={{ emptyText: "暂无外发回收库存" }}
                />
              </Space>
            ),
          },
          {
            key: "settings",
            label: "外发单设置",
            children: <OutsourceSettingsTab />,
          },
        ].filter((item) => {
          const code = OUTSOURCE_TAB_PERM[String(item.key)];
          return code ? allowed([code]) : false;
        })}
      />
      )}

      <Modal
        title="外发回收库手动调整"
        open={recoveryAdjustOpen}
        onCancel={() => {
          if (recoveryAdjusting) return;
          setRecoveryAdjustOpen(false);
          setRecoveryAdjustTarget(null);
        }}
        onOk={() => void submitRecoveryAdjust()}
        okText="确认调整"
        confirmLoading={recoveryAdjusting}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text>
            商品：
            {recoveryAdjustTarget
              ? `${recoveryAdjustTarget.recoveryMaterialCode || formatOutsourceRecoveryMaterialCode(recoveryAdjustTarget.customerMaterialCode)} ${recoveryAdjustTarget.model}`
              : "—"}
          </Typography.Text>
          <Typography.Text type="secondary">
            当前库存：{recoveryAdjustTarget?.quantity ?? 0}（正数增加，负数减少）
          </Typography.Text>
          <InputNumber
            style={{ width: "100%" }}
            precision={0}
            value={recoveryAdjustQty}
            onChange={(v) => setRecoveryAdjustQty(Math.trunc(Number(v) || 0))}
            placeholder="请输入调整数量，如 +10 或 -5"
          />
          <Input.TextArea
            rows={3}
            maxLength={300}
            value={recoveryAdjustReason}
            onChange={(e) => setRecoveryAdjustReason(e.target.value)}
            placeholder="请填写调整原因（必填）"
          />
        </Space>
      </Modal>

      <Modal
        title={
          <Space size={6}>
            <span>外发库存退料</span>
            <HelpTip
              text={
                <>
                  默认按「已结单未退回」全退。修改退料数量时，剩余会自动填入报废数量；报废也可手工改，未分配部分显示在未退数量。确认后：退料数量写入「物料信息
                  → 物料库存」入库流水，报废数量仅冲减外发库存。
                </>
              }
            />
          </Space>
        }
        open={stockReturnOpen}
        onCancel={() => {
          if (stockReturning) return;
          setStockReturnOpen(false);
          setStockReturnLines([]);
        }}
        onOk={() => void submitStockReturn()}
        okText="确定退料"
        confirmLoading={stockReturning}
        width={1180}
        destroyOnHidden
      >
        <Table<OutsourceStockReturnInput>
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={stockReturnLines}
          scroll={{ x: 1120 }}
          columns={[
            { title: "加工方", dataIndex: "supplierName", width: 160, ellipsis: true },
            { title: "物料编号", dataIndex: "materialCode", width: 140 },
            { title: "物料名称", dataIndex: "materialName", width: 220, ellipsis: true },
            { title: "单位", dataIndex: "unit", width: 70 },
            { title: "可退数量", dataIndex: "maxReturnQty", width: 100, align: "right" },
            {
              title: "退料数量",
              width: 120,
              render: (_, row, idx) => (
                <InputNumber
                  min={0}
                  max={row.maxReturnQty}
                  precision={0}
                  value={row.returnQty}
                  style={{ width: "100%" }}
                  onChange={(v) => {
                    const n = Math.max(0, Math.trunc(Number(v) || 0));
                    const nextReturn = Math.min(row.maxReturnQty, n);
                    setStockReturnLines((prev) =>
                      prev.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              returnQty: nextReturn,
                              scrapQty: Math.max(0, x.maxReturnQty - nextReturn),
                            }
                          : x,
                      ),
                    );
                  }}
                />
              ),
            },
            {
              title: "报废数量",
              width: 120,
              render: (_, row, idx) => (
                <InputNumber
                  min={0}
                  max={row.maxReturnQty}
                  precision={0}
                  value={row.scrapQty}
                  style={{ width: "100%" }}
                  onChange={(v) => {
                    const n = Math.max(0, Math.trunc(Number(v) || 0));
                    const nextScrap = Math.min(row.maxReturnQty, n);
                    setStockReturnLines((prev) =>
                      prev.map((x, i) => {
                        if (i !== idx) return x;
                        const maxReturn = Math.max(0, x.maxReturnQty - nextScrap);
                        return {
                          ...x,
                          scrapQty: nextScrap,
                          returnQty: Math.min(x.returnQty, maxReturn),
                        };
                      }),
                    );
                  }}
                />
              ),
            },
            {
              title: "未退数量",
              width: 110,
              align: "right",
              render: (_, row) =>
                Math.max(0, row.maxReturnQty - row.returnQty - row.scrapQty),
            },
          ]}
        />
      </Modal>

      <Modal
        title={
          stockHistoryTarget
            ? `出入库明细 · ${stockHistoryTarget.materialCode} ${stockHistoryTarget.materialName}`
            : "出入库明细"
        }
        open={stockHistoryOpen}
        onCancel={() => {
          setStockHistoryOpen(false);
          setStockHistoryRows([]);
          setStockHistoryTarget(null);
        }}
        footer={
          <Space>
            <Button onClick={() => setStockHistoryOpen(false)}>关闭</Button>
            <Button
              type="primary"
              onClick={() => void exportStockHistoryToExcel()}
              disabled={stockHistoryRows.length === 0}
              loading={stockHistoryExporting}
            >
              导出 Excel
            </Button>
          </Space>
        }
        width={980}
        destroyOnHidden
      >
        <Table<OutsourceStockHistoryRow>
          rowKey="id"
          loading={stockHistoryLoading}
          dataSource={stockHistoryRows}
          pagination={{ pageSize: 12 }}
          scroll={{ x: "max-content" }}
          columns={[
            {
              title: "时间",
              dataIndex: "receivedAt",
              width: 160,
              render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm:ss"),
            },
            {
              title: "方向",
              dataIndex: "direction",
              width: 80,
              render: (v: OutsourceStockHistoryRow["direction"]) =>
                v === "IN" ? <Tag color="green">入库</Tag> : <Tag color="orange">出库</Tag>,
            },
            { title: "数量", dataIndex: "quantity", width: 96, align: "right" },
            { title: "外发单号", dataIndex: "orderNo", width: 180, ellipsis: true },
            { title: "说明", dataIndex: "partDescription", ellipsis: true },
            { title: "操作人", dataIndex: "operatorName", width: 120, ellipsis: true },
          ]}
          locale={{ emptyText: "暂无出入库记录" }}
        />
      </Modal>

      <Modal
        title={
          <Space size={6}>
            <span>{recycleOrderNo ? `确认回收 — ${recycleOrderNo}` : "确认回收"}</span>
            <HelpTip
              text={
                <>
                  默认<strong>本次回收</strong>为<strong>全部待收套数</strong>。可按实际分批修改套数；确认后系统按
                  BOM 将套数换算为各物料回库数量并记账。<strong>已回收数量</strong>
                  为该外发单已登记的<strong>成品入库累计套数</strong>；点击可查看
                  <strong>收回明细</strong>（各次成品入库套数）。
                </>
              }
            />
          </Space>
        }
        open={recycleOpen}
        onCancel={() => {
          setRecycleOpen(false);
          setRecycleOrderId(null);
          setRecycleOrderNo(null);
          setRecycleDetail(null);
          setRecycleSetsThis(0);
        }}
        okText="确认入库"
        onOk={() => submitRecycle()}
        okButtonProps={{
          disabled: recycleOkDisabled || recycleSubmitting,
        }}
        confirmLoading={recycleSubmitting}
        width={980}
        destroyOnHidden
      >
        {recycleLoading ? (
          <Typography.Text type="secondary">加载明细…</Typography.Text>
        ) : recycleDetail ? (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              <div>
                <Typography.Text strong>品名：</Typography.Text>{" "}
                <Typography.Text>
                  {recycleDetail.product.model?.trim() ||
                    recycleDetail.product.customerMaterialCode?.trim() ||
                    "—"}
                </Typography.Text>
              </div>
              <div>
                <Typography.Text strong>外发加工套数：</Typography.Text>{" "}
                <Typography.Text>{recycleDetail.productQty} 套</Typography.Text>
              </div>
            </Space>
            <Table<{ key: string }>
              size="small"
              rowKey="key"
              pagination={false}
              dataSource={[{ key: "product" }]}
              scroll={{ x: "max-content" }}
              columns={[
                {
                  title: "物料编号",
                  width: 140,
                  ellipsis: true,
                  render: () =>
                    recycleDetail.product.customerMaterialCode?.trim() || "—",
                },
                {
                  title: "商品名称",
                  width: 180,
                  ellipsis: true,
                  render: () =>
                    recycleDetail.product.model?.trim() ||
                    recycleDetail.product.customerMaterialCode?.trim() ||
                    "—",
                },
                {
                  title: "单位",
                  width: 72,
                  render: () => recycleDetail.product.unit?.trim() || "—",
                },
                {
                  title: "外发数量",
                  width: 100,
                  align: "right",
                  render: () => recycleDetail.productQty,
                },
                {
                  title: "已回收数量",
                  width: 112,
                  align: "right",
                  render: () => {
                    const recoveredSets = setsRecoveredSoFar(recycleDetail);
                    const prB = [...(recycleDetail.productRecoveryBatches ?? [])].sort(
                      (a, b) =>
                        new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime(),
                    );
                    const productLine =
                      recycleDetail.product.model?.trim() ||
                      recycleDetail.product.customerMaterialCode?.trim() ||
                      "—";
                    const popContent =
                      prB.length === 0 ? (
                        <Typography.Text type="secondary">
                          暂无登记的成品分批入库记录。
                        </Typography.Text>
                      ) : (
                        <>
                          <div style={{ marginBottom: 8, fontSize: 13 }}>
                            <Typography.Text strong>回收商品：</Typography.Text>{" "}
                            {productLine}
                          </div>
                          <ul
                            style={{
                              margin: 0,
                              paddingLeft: 18,
                              maxHeight: 260,
                              overflowY: "auto",
                            }}
                          >
                          {prB.map((b, i) => (
                            <li key={`${b.receivedAt}-${i}`}>
                              {dayjs(b.receivedAt).format("YYYY-MM-DD HH:mm")} — 收回{" "}
                              <strong>{b.quantity}</strong> 套
                              {b.partDescription?.trim() ? (
                                <span style={{ color: "#888", fontSize: 12 }}>
                                  {" "}
                                  （{b.partDescription.trim()}）
                                </span>
                              ) : null}
                            </li>
                          ))}
                          </ul>
                        </>
                      );
                    return (
                      <Popover title="收回明细" content={popContent} trigger="click">
                        <Button type="link" style={{ padding: 0, height: "auto" }}>
                          {recoveredSets}
                        </Button>
                      </Popover>
                    );
                  },
                },
                {
                  title: "待收数量",
                  width: 100,
                  align: "right",
                  render: () => setsPendingByMaterials(recycleDetail),
                },
                {
                  title: "本次回收",
                  width: 140,
                  render: () => {
                    const cap = Math.min(
                      setsPendingByMaterials(recycleDetail),
                      maxRecycleSetsByOutsourceQty(recycleDetail),
                    );
                    return (
                      <InputNumber
                        min={0}
                        max={cap}
                        precision={0}
                        style={{ width: "100%" }}
                        value={recycleSetsThis}
                        onChange={(v) => {
                          const n =
                            v === null || v === undefined
                              ? 0
                              : Math.min(
                                  Math.max(0, Math.round(Number(v))),
                                  cap,
                                );
                          setRecycleSetsThis(n);
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

      <Modal
        title={
          <Space size={6}>
            <span>{closeOrder ? `结单登记 — ${closeOrder.orderNo}` : "结单登记"}</span>
            <HelpTip
              text={
                <>
                  结单时先填写<strong>损耗套数</strong>，系统会按 BOM 自动折算各物料损耗扣减；再逐行填写
                  <strong>退回数量</strong>（默认 0）。未退回数量会继续留在外发物料库存。
                </>
              }
            />
          </Space>
        }
        open={closeOpen}
        onCancel={() => {
          if (closeSubmitting) return;
          setCloseOpen(false);
          setCloseOrder(null);
          setCloseDetail(null);
          setCloseLossSets(0);
          setCloseLines([]);
        }}
        onOk={() => void submitCloseOrder()}
        okText="确认结单"
        confirmLoading={closeSubmitting}
        width={920}
        destroyOnHidden
      >
        {closeLoading ? (
          <Typography.Text type="secondary">加载明细…</Typography.Text>
        ) : (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Space>
              <Typography.Text strong>损耗套数</Typography.Text>
              <InputNumber
                min={0}
                precision={0}
                value={closeLossSets}
                onChange={(v) => {
                  const sets = Math.max(0, Math.trunc(Number(v) || 0));
                  setCloseLossSets(sets);
                  if (!closeDetail) return;
                  setCloseLines((prev) => applyLossSetsToCloseLines(closeDetail, sets, prev));
                }}
              />
            </Space>
            <Table<CloseLineInput>
              rowKey="lineId"
              size="small"
              pagination={false}
              dataSource={closeLines}
              columns={[
                { title: "物料编号", dataIndex: "code", width: 120 },
                { title: "物料名称", dataIndex: "name", ellipsis: true },
                { title: "单位", dataIndex: "unit", width: 64 },
                { title: "当前在外", dataIndex: "currentQty", width: 96, align: "right" },
                {
                  title: "损耗折算",
                  dataIndex: "lossBySets",
                  width: 108,
                  align: "right",
                },
                {
                  title: "退回数量",
                  width: 120,
                  render: (_, row, index) => (
                    <InputNumber
                      min={0}
                      max={Math.max(0, row.currentQty - row.lossBySets)}
                      precision={0}
                      value={row.returnQty}
                      style={{ width: "100%" }}
                      onChange={(v) => {
                        const n = Math.max(0, Math.trunc(Number(v) || 0));
                        setCloseLines((prev) =>
                          prev.map((x, i) => {
                            if (i !== index) return x;
                            const maxReturn = Math.max(0, x.currentQty - x.lossBySets);
                            return { ...x, returnQty: Math.min(maxReturn, n) };
                          }),
                        );
                      }}
                    />
                  ),
                },
                {
                  title: "结单后在外",
                  width: 116,
                  align: "right",
                  render: (_, row) => Math.max(0, row.currentQty - row.lossBySets - row.returnQty),
                },
              ]}
            />
          </Space>
        )}
      </Modal>

      <Modal
        title={
          editDetail
            ? editViewOnly
              ? `外发单详情 · ${editDetail.orderNo}`
              : `编辑外发单 · ${editDetail.orderNo}`
            : editViewOnly
              ? "外发单详情"
              : "编辑外发单"
        }
        open={editOpen}
        onCancel={closeTodayEdit}
        width={920}
        destroyOnHidden={false}
        footer={
          <Space>
            <Button onClick={closeTodayEdit}>关闭</Button>
            {!editViewOnly ? (
              <Button type="primary" loading={editSubmitting} onClick={() => void submitTodayEdit()}>
                保存
              </Button>
            ) : null}
          </Space>
        }
      >
        <Form form={editForm} layout="vertical" disabled={editViewOnly}>
          {editLoading ? (
            <Typography.Text type="secondary">加载中…</Typography.Text>
          ) : editDetail ? (
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              {editViewOnly ? (
                <Typography.Text type="secondary">本单已非进行中，仅可查看。</Typography.Text>
              ) : null}
              {editLocked && !editViewOnly ? (
                <Typography.Text type="warning">
                  本单已有部分回收或成品入库记录，仅可修改<strong>加工方</strong>与<strong>备注</strong>；套数与物料行不可改。
                </Typography.Text>
              ) : null}
              <div>
                <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
                  商品
                </Typography.Text>
                <Typography.Text>
                  {editDetail.product.customer.name} / {editDetail.product.model?.trim() || "—"}
                </Typography.Text>
              </div>
              <Form.Item name="supplierId" label="加工方（供应商）">
                <Select
                  allowClear
                  placeholder="可选"
                  style={{ maxWidth: 480 }}
                  showSearch
                  optionFilterProp="label"
                  options={suppliers.map((s) => ({
                    value: s.id,
                    label: formatSupplierSelectLabel(s),
                  }))}
                />
              </Form.Item>
              {!editLocked ? (
                <Space wrap align="start">
                  <Form.Item
                    name="productQty"
                    label="外发加工套数"
                    rules={[{ required: true, message: "请填写套数" }]}
                  >
                    <InputNumber min={1} max={999999999} precision={0} style={{ width: 160 }} />
                  </Form.Item>
                  <Form.Item label=" ">
                    <Button onClick={() => applyBomToEditLines()}>按套数从 BOM 重算物料行</Button>
                  </Form.Item>
                </Space>
              ) : (
                <Form.Item label="外发加工套数">
                  <Typography.Text>{editDetail.productQty}</Typography.Text>
                </Form.Item>
              )}
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} placeholder="可选" allowClear />
              </Form.Item>
            </Space>
          ) : null}
        </Form>
        {!editLoading && editDetail ? (
          !editLocked && !editViewOnly ? (
            <>
              {editHasStockShortage && !editLoadingStock ? (
                <Typography.Paragraph type="danger" style={{ marginBottom: 0 }}>
                  存在物料外发数量大于当前库存，请调减后再保存。
                </Typography.Paragraph>
              ) : null}
              <Table<EditOrderLine>
                size="small"
                rowKey="lineId"
                pagination={false}
                dataSource={editLines}
                locale={{ emptyText: "无明细" }}
                columns={[
                  { title: "物料编号", dataIndex: "code", width: 120 },
                  { title: "物料名称", dataIndex: "name", ellipsis: true },
                  { title: "单位", dataIndex: "unit", width: 64 },
                  {
                    title: "可用库存",
                    key: "stock",
                    width: 96,
                    render: (_, row) =>
                      editLoadingStock ? (
                        <Typography.Text type="secondary">…</Typography.Text>
                      ) : (
                        <Typography.Text>
                          {editStockByMaterial[row.materialId] ?? 0}
                        </Typography.Text>
                      ),
                  },
                  {
                    title: "外发数量",
                    dataIndex: "quantity",
                    width: 140,
                    render: (_, row, index) => {
                      const avail = editStockByMaterial[row.materialId] ?? 0;
                      const over = !editLoadingStock && row.quantity > avail;
                      return (
                        <div>
                          <InputNumber
                            min={1}
                            max={999999999}
                            precision={0}
                            value={row.quantity}
                            status={over ? "error" : undefined}
                            onChange={(val) => {
                              const n =
                                val === null || val === undefined
                                  ? 1
                                  : Math.max(1, Math.trunc(Number(val)));
                              setEditLines((prev) =>
                                prev.map((l, i) =>
                                  i === index ? { ...l, quantity: n } : l,
                                ),
                              );
                            }}
                          />
                          {over ? (
                            <div>
                              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                                超出库存（可用 {avail}）
                              </Typography.Text>
                            </div>
                          ) : null}
                        </div>
                      );
                    },
                  },
                ]}
                onRow={(record) => ({
                  style:
                    !editLoadingStock &&
                    record.quantity > (editStockByMaterial[record.materialId] ?? 0)
                      ? { background: "#fff1f0" }
                      : undefined,
                })}
              />
            </>
          ) : (
            <Table<EditOrderLine>
              size="small"
              rowKey="lineId"
              pagination={false}
              dataSource={editLines}
              columns={[
                { title: "物料编号", dataIndex: "code", width: 120 },
                { title: "物料名称", dataIndex: "name", ellipsis: true },
                { title: "单位", dataIndex: "unit", width: 64 },
                { title: "待回收数量", dataIndex: "quantity", width: 112, align: "right" },
              ]}
            />
          )
        ) : null}
      </Modal>

      <OutsourceOrderSlipPreviewModal
        open={slipPreviewOpen}
        outsourceOrderId={slipPreviewId}
        orderNo={slipPreviewOrderNo}
        onClose={() => {
          setSlipPreviewOpen(false);
          setSlipPreviewId(null);
          setSlipPreviewOrderNo(null);
        }}
      />

    </Card>
  );
}
