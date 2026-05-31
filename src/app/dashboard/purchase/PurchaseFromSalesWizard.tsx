"use client";

import { SettingOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Layout,
  Modal,
  Popover,
  Select,
  Space,
  Steps,
  Table,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { ResizeCallbackData } from "react-resizable";
import type {
  Dispatch,
  ReactNode,
  SetStateAction,
  SyntheticEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ResizableTableTitle } from "@/components/ResizableTableTitle";
import { fetchJson } from "@/lib/fetch-json";
import { moneyColumnLabels } from "@/lib/price-tax";
import { computePurchaseOrderDeliveryDue } from "@/lib/purchase-order-delivery";
import {
  loadPurchaseWizardDraft,
  savePurchaseWizardDraft,
  upsertWizardSupplierDraft,
  type WizardLineDraft,
} from "@/lib/purchase-wizard-draft";
import { mergeVisualEditorState, type VisualEditorState } from "@/lib/purchase-template-visual";
import { PurchaseVisualContractPreview } from "./PurchaseVisualContractPreview";
import {
  PurchaseOrderExtraFeesPanel,
  type PurchaseExtraFeeRow,
  type PurchaseOrderExtraFeesPanelHandle,
} from "./PurchaseOrderExtraFeesPanel";

type EligibleSo = {
  id: string;
  customerOrderNo: string;
  customerModel: string;
  deliveryDueAt: string | null;
  customer: { id: string; code: string; name: string };
  lineCount: number;
  createdAt: string;
};

type SplitLine = {
  materialId: string;
  code: string;
  model: string;
  spec: string;
  unit: string;
  bomNeedQty: number;
  orderedQty: number;
  suggestedQty: number;
  unitPrice: string;
};

/** 已下完、仅作参照的物料文字颜色 */
const ALREADY_ORDERED_GRAY = "#bfbfbf";

function splitLineRemaining(
  l: Pick<SplitLine, "bomNeedQty" | "orderedQty" | "suggestedQty">,
): number {
  return Math.max(0, (l.bomNeedQty ?? l.suggestedQty) - (l.orderedQty ?? 0));
}

function shouldShowPurchaseLine(l: EditableLine): boolean {
  return splitLineRemaining(l) > 0 || l.quantity > 0;
}

type SplitGroup = {
  supplier: {
    id: string;
    code: string;
    name: string;
    shortName?: string | null;
    contactPerson: string | null;
    phone: string | null;
    address: string | null;
    bankName: string | null;
    bankAccount: string | null;
    taxRegistrationNo: string | null;
    /** 与生成采购单时「要求交货日」计算一致 */
    deliveryLeadDays?: number | null;
    priceIncludesTax: boolean;
  };
  lines: SplitLine[];
  /** 补开模式：对应已取消的采购单号 */
  redoCancelledOrderNos?: string[];
};

type BomLine = {
  materialId: string;
  code: string;
  name: string;
  partDescription: string | null;
  unit: string;
  usageQty: string;
  needQty: number;
  supplierName: string;
};

type BomProduct = {
  productId: string;
  customerMaterialCode: string;
  model: string;
  spec: string;
  unit: string;
  salesQty: number;
  productStockQty: number;
  bomLines: BomLine[];
};

type SplitPayload = {
  salesOrder: {
    id: string;
    customerOrderNo: string;
    customerModel: string;
    customer: { code: string; name: string };
    createdAt: string;
    deliveryDueAt: string | null;
  };
  bomByProduct: BomProduct[];
  splitMode: "full_bom" | "redo_cancelled" | "partial_redo";
  orderedQtyByMaterial: Record<string, number>;
  supplierGroups: SplitGroup[];
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
      okText: "已确认本次变更，继续生成预览",
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

type EditableLine = SplitLine & {
  quantity: number;
  unitPriceNum: number;
  remark: string;
};

type EditableGroup = {
  supplierId: string;
  supplier: SplitGroup["supplier"];
  lines: EditableLine[];
  /** 已点「确认」：数量/单价/备注锁定，数量显示浇灰色 */
  confirmed: boolean;
  redoCancelledOrderNos?: string[];
};

/** 已核对确认后的数量等文字颜色（浇灰） */
const CONFIRMED_FIELD_COLOR = "#8c8c8c";

function groupToLineDrafts(lines: EditableLine[]): WizardLineDraft[] {
  return lines.map((l) => ({
    materialId: l.materialId,
    quantity: l.quantity,
    unitPriceNum: l.unitPriceNum,
    remark: l.remark,
  }));
}

function mergeLinesWithDraft(
  lines: EditableLine[],
  drafts: WizardLineDraft[] | undefined,
): EditableLine[] {
  if (!drafts?.length) return lines;
  const byMat = new Map(drafts.map((d) => [d.materialId, d]));
  return lines.map((l) => {
    const d = byMat.get(l.materialId);
    if (!d) return l;
    return {
      ...l,
      quantity: d.quantity,
      unitPriceNum: d.unitPriceNum,
      remark: d.remark,
    };
  });
}

/** 数量 > 0 的明细；某供应商下若全部为 0 则整组不采购、不生成采购单。 */
function groupsWithPositiveQuantityLines(
  groups: EditableGroup[],
): EditableGroup[] {
  return groups
    .map((g) => ({
      ...g,
      lines: g.lines.filter((l) => l.quantity > 0),
    }))
    .filter((g) => g.lines.length > 0);
}

function isAllLineQuantitiesZero(groups: EditableGroup[]): boolean {
  const lines = groups.flatMap((g) => g.lines);
  if (lines.length === 0) return false;
  return lines.every((l) => l.quantity === 0);
}

function ceilQty(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.max(1, Math.ceil(raw - 1e-9));
}

const WIZARD_GROUP_COL_OPTIONS: { label: string; value: string }[] = [
  { label: "物料编号", value: "code" },
  { label: "型号", value: "model" },
  { label: "规格", value: "spec" },
  { label: "单位", value: "unit" },
  { label: "物料库存数", value: "stockQty" },
  { label: "数量", value: "quantity" },
  { label: "单价", value: "unitPrice" },
  { label: "总价", value: "total" },
  { label: "备注", value: "remark" },
];
const WIZARD_GROUP_ALL_KEYS = WIZARD_GROUP_COL_OPTIONS.map((o) => o.value);
const LS_WIZARD_GROUP_COLS = "purchase.wizard.splitGroup.cols.v1";
const DEFAULT_WIZARD_GROUP_WIDTH: Record<string, number> = {
  code: 120,
  model: 120,
  spec: 280,
  unit: 56,
  stockQty: 108,
  quantity: 100,
  unitPrice: 110,
  total: 100,
  remark: 160,
};

const BOM_SIDEBAR_COL_OPTIONS: { label: string; value: string }[] = [
  { label: "物料", value: "code" },
  { label: "用量", value: "usageQty" },
  { label: "需求", value: "needQty" },
];
const BOM_SIDEBAR_ALL_KEYS = BOM_SIDEBAR_COL_OPTIONS.map((o) => o.value);
const LS_WIZARD_BOM_COLS = "purchase.wizard.bomRef.cols.v1";
const DEFAULT_BOM_SIDEBAR_WIDTH: Record<string, number> = {
  code: 90,
  usageQty: 56,
  needQty: 56,
};

function loadWizardColKeys(
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

function attachResizeWizardCols<T extends object>(
  columns: ColumnsType<T>,
  widths: Record<string, number>,
  setWidths: Dispatch<SetStateAction<Record<string, number>>>,
  defaults: Record<string, number>,
): ColumnsType<T> {
  return columns.map((col) => {
    const key = col.key != null ? String(col.key) : "";
    if (!key) {
      const w = (col.width as number) ?? 120;
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

function WizardColumnSettingButton({
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

export function PurchaseFromSalesWizard({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { message, modal } = App.useApp();
  const [step, setStep] = useState(0);
  const [eligible, setEligible] = useState<EligibleSo[]>([]);
  const [loadingEligible, setLoadingEligible] = useState(false);
  const [soId, setSoId] = useState<string | undefined>();
  const [loadingSplit, setLoadingSplit] = useState(false);
  const [split, setSplit] = useState<SplitPayload | null>(null);
  const [groups, setGroups] = useState<EditableGroup[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  /** 采购合同预览当前选中的供应商分组 */
  const [previewSupplierId, setPreviewSupplierId] = useState<string | undefined>();
  const [visualTemplate, setVisualTemplate] = useState<VisualEditorState | null>(null);
  /** 与系统采购单号规则一致的下一单号预览（不写库） */
  const [previewContractNo, setPreviewContractNo] = useState<string | null>(null);
  /** 按供应商：生成前预览里录入的附加费用 */
  const [extraFeesBySupplierId, setExtraFeesBySupplierId] = useState<
    Record<string, PurchaseExtraFeeRow[]>
  >({});
  const previewFeesPanelRef = useRef<PurchaseOrderExtraFeesPanelHandle>(null);
  const [submitting, setSubmitting] = useState(false);
  const [noPurchaseMarking, setNoPurchaseMarking] = useState(false);
  /** 物料 id -> 当前库存（MaterialInbound 汇总） */
  const [materialStockById, setMaterialStockById] = useState<Record<string, number>>({});
  /** 商品 id -> 实际需求商品数（默认销售订单数） */
  const [actualDemandByProductId, setActualDemandByProductId] = useState<Record<string, number>>(
    {},
  );

  const [splitGroupColKeys, setSplitGroupColKeys] = useState<string[]>(() =>
    loadWizardColKeys(LS_WIZARD_GROUP_COLS, WIZARD_GROUP_ALL_KEYS, WIZARD_GROUP_ALL_KEYS),
  );
  const [splitGroupColWidths, setSplitGroupColWidths] = useState<
    Record<string, number>
  >({});
  const [bomRefColKeys, setBomRefColKeys] = useState<string[]>(() =>
    loadWizardColKeys(LS_WIZARD_BOM_COLS, BOM_SIDEBAR_ALL_KEYS, BOM_SIDEBAR_ALL_KEYS),
  );
  const [bomRefColWidths, setBomRefColWidths] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      localStorage.setItem(LS_WIZARD_GROUP_COLS, JSON.stringify(splitGroupColKeys));
    } catch {
      /* ignore */
    }
  }, [splitGroupColKeys]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_WIZARD_BOM_COLS, JSON.stringify(bomRefColKeys));
    } catch {
      /* ignore */
    }
  }, [bomRefColKeys]);

  const loadEligible = useCallback(async () => {
    setLoadingEligible(true);
    try {
      const data = await fetchJson<{ list: EligibleSo[] }>(
        "/api/sales-orders/eligible-for-purchase",
        { credentials: "include" },
      );
      setEligible(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载销售订单失败");
      setEligible([]);
    } finally {
      setLoadingEligible(false);
    }
  }, [message]);

  useEffect(() => {
    if (open) {
      setStep(0);
      setSoId(undefined);
      setSplit(null);
      setGroups([]);
      setPreviewOpen(false);
      setPreviewSupplierId(undefined);
      setExtraFeesBySupplierId({});
      setMaterialStockById({});
      setActualDemandByProductId({});
      void loadEligible();
    }
  }, [open, loadEligible]);

  useEffect(() => {
    if (!previewOpen) {
      setVisualTemplate(null);
      setPreviewContractNo(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetchJson<{ config: Record<string, unknown> }>(
          "/api/purchase-print-template",
          { credentials: "include" },
        );
        const ve = (d.config as { visualEditor?: unknown }).visualEditor;
        if (!cancelled) setVisualTemplate(mergeVisualEditorState(ve));
      } catch {
        if (!cancelled) setVisualTemplate(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewOpen]);

  const loadSplit = async () => {
    if (!soId) {
      message.warning("请选择销售订单");
      return;
    }
    setLoadingSplit(true);
    try {
      const data = await fetchJson<SplitPayload>(
        `/api/sales-orders/${soId}/purchase-split`,
        { credentials: "include" },
      );
      setSplit(data);
      if (data.supplierGroups.length === 0) {
        message.warning("该销售订单未产生物料需求（请检查商品 BOM）");
        return;
      }
      const draft = loadPurchaseWizardDraft(data.salesOrder.id);
      const defaultDemand = Object.fromEntries(
        data.bomByProduct.map((bp) => [
          bp.productId,
          Math.max(0, Math.trunc(bp.salesQty)),
        ]),
      );
      const demandMap =
        draft?.actualDemandByProductId &&
        Object.keys(draft.actualDemandByProductId).length > 0
          ? { ...defaultDemand, ...draft.actualDemandByProductId }
          : defaultDemand;
      setActualDemandByProductId(demandMap);
      const needByMaterialId = materialNeedMapByActualDemand(data, demandMap);
      setGroups(
        data.supplierGroups.map((g) => {
          const sd = draft?.suppliers[g.supplier.id];
          const baseLines = g.lines.map((l) => {
            const lineDraft = sd?.lines.find(
              (x) => x.materialId === l.materialId,
            );
            if (sd?.confirmed) {
              return {
                ...l,
                quantity: lineDraft?.quantity ?? 0,
                unitPriceNum: lineDraft?.unitPriceNum ?? Number(l.unitPrice || 0),
                remark: lineDraft?.remark ?? "",
              };
            }
            return {
              ...l,
              quantity:
                lineDraft?.quantity ??
                needByMaterialId.get(l.materialId) ??
                l.suggestedQty,
              unitPriceNum:
                lineDraft?.unitPriceNum ?? Number(l.unitPrice || 0),
              remark: lineDraft?.remark ?? "",
            };
          });
          return {
            supplierId: g.supplier.id,
            supplier: g.supplier,
            lines: mergeLinesWithDraft(baseLines, sd?.lines),
            confirmed: sd?.confirmed ?? false,
            redoCancelledOrderNos: g.redoCancelledOrderNos,
          };
        }),
      );
      if (draft?.suppliers) {
        const fees: Record<string, PurchaseExtraFeeRow[]> = {};
        for (const [sid, sd] of Object.entries(draft.suppliers)) {
          if (sd.extraFees?.length) fees[sid] = sd.extraFees;
        }
        if (Object.keys(fees).length > 0) setExtraFeesBySupplierId(fees);
      }
      setSplitGroupColKeys((prev) =>
        prev.includes("stockQty") ? prev : [...prev, "stockQty"],
      );
      const matIds = [
        ...new Set(
          data.supplierGroups.flatMap((g) => g.lines.map((l) => l.materialId)),
        ),
      ];
      if (matIds.length > 0) {
        try {
          const st = await fetchJson<{ stocks: Record<string, number> }>(
            `/api/materials/stock-by-ids?ids=${encodeURIComponent(matIds.join(","))}`,
            { credentials: "include" },
          );
          setMaterialStockById(st.stocks ?? {});
        } catch {
          setMaterialStockById({});
        }
      } else {
        setMaterialStockById({});
      }
      if (
        data.splitMode === "redo_cancelled" ||
        data.splitMode === "partial_redo"
      ) {
        if (data.supplierGroups.length === 0) {
          message.warning("没有可补开的已取消采购明细");
          return;
        }
      } else {
        const hasPending = data.supplierGroups.some((g) =>
          g.lines.some((l) => l.suggestedQty > 0),
        );
        if (
          !hasPending &&
          Object.values(data.orderedQtyByMaterial ?? {}).some((q) => q > 0)
        ) {
          message.info(
            "本单物料在有效采购单中已覆盖；若需重下请先取消对应采购单后再进入。",
          );
        }
      }
      setStep(1);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "拆分失败");
    } finally {
      setLoadingSplit(false);
    }
  };

  const materialNeedMapByActualDemand = useCallback(
    (payload: SplitPayload, demandMap: Record<string, number>) => {
      const needByMaterialId = new Map<string, number>();
      for (const bp of payload.bomByProduct) {
        const demandQty = Math.max(
          0,
          Math.trunc(Number(demandMap[bp.productId] ?? bp.salesQty) || 0),
        );
        for (const bl of bp.bomLines) {
          const usage = Number(bl.usageQty);
          const needQty = demandQty <= 0 ? 0 : ceilQty(usage * demandQty);
          needByMaterialId.set(
            bl.materialId,
            (needByMaterialId.get(bl.materialId) ?? 0) + needQty,
          );
        }
      }
      return needByMaterialId;
    },
    [],
  );

  const persistDraftDemand = useCallback(
    (demandMap: Record<string, number>) => {
      if (!split) return;
      const base = loadPurchaseWizardDraft(split.salesOrder.id) ?? {
        salesOrderId: split.salesOrder.id,
        actualDemandByProductId: {},
        suppliers: {},
        updatedAt: new Date().toISOString(),
      };
      savePurchaseWizardDraft({
        ...base,
        actualDemandByProductId: demandMap,
        updatedAt: new Date().toISOString(),
      });
    },
    [split],
  );

  const applyActualDemandToGroups = useCallback(
    (demandMap: Record<string, number>) => {
      if (
        !split ||
        split.splitMode === "redo_cancelled" ||
        split.splitMode === "partial_redo"
      ) {
        return;
      }
      const needByMaterialId = materialNeedMapByActualDemand(split, demandMap);
      setGroups((prev) =>
        prev.map((g) => {
          if (g.confirmed) return g;
          return {
            ...g,
            lines: g.lines.map((l) => {
              const bomNeed = needByMaterialId.get(l.materialId) ?? l.bomNeedQty;
              const remaining = Math.max(0, bomNeed - (l.orderedQty ?? 0));
              return {
                ...l,
                bomNeedQty: bomNeed,
                quantity: remaining,
              };
            }),
          };
        }),
      );
      persistDraftDemand(demandMap);
    },
    [split, materialNeedMapByActualDemand, persistDraftDemand],
  );

  const persistSupplierDraft = useCallback(
    (g: EditableGroup, confirmed: boolean) => {
      if (!split) return;
      upsertWizardSupplierDraft(
        split.salesOrder.id,
        g.supplierId,
        {
          confirmed,
          lines: groupToLineDrafts(g.lines),
          extraFees: extraFeesBySupplierId[g.supplierId],
        },
        actualDemandByProductId,
      );
    },
    [split, extraFeesBySupplierId, actualDemandByProductId],
  );

  const confirmSupplierGroup = useCallback(
    (gi: number) => {
      setGroups((prev) => {
        const next = prev.map((g, i) =>
          i === gi ? { ...g, confirmed: true } : g,
        );
        const g = next[gi];
        if (g) persistSupplierDraft(g, true);
        return next;
      });
    },
    [persistSupplierDraft],
  );

  const modifySupplierGroup = useCallback(
    (gi: number) => {
      setGroups((prev) => {
        const next = prev.map((g, i) =>
          i === gi ? { ...g, confirmed: false } : g,
        );
        const g = next[gi];
        if (g) persistSupplierDraft(g, false);
        return next;
      });
    },
    [persistSupplierDraft],
  );

  const updateLine = useCallback(
    (
      gi: number,
      materialId: string,
      patch: Partial<Pick<EditableLine, "quantity" | "unitPriceNum" | "remark">>,
    ) => {
      setGroups((prev) =>
        prev.map((g, i) =>
          i !== gi
            ? g
            : {
                ...g,
                lines: g.lines.map((l) =>
                  l.materialId !== materialId ? l : { ...l, ...patch },
                ),
              },
        ),
      );
    },
    [],
  );

  const makeSplitGroupColumns = useCallback(
    (gi: number): ColumnsType<EditableLine> => {
      const locked = groups[gi]?.confirmed ?? false;
      const priceLabels = moneyColumnLabels(
        groups[gi]?.supplier.priceIncludesTax ?? false,
      );
      const lockedFieldStyle = locked
        ? { color: CONFIRMED_FIELD_COLOR }
        : undefined;
      return [
      { key: "code", title: "物料编号", width: 120, render: (_, r) => r.code },
      {
        key: "model",
        title: "型号",
        width: 120,
        ellipsis: true,
        render: (_, r) => r.model,
      },
      {
        key: "spec",
        title: "规格",
        width: 280,
        ellipsis: true,
        render: (_, r) => r.spec || "—",
      },
      { key: "unit", title: "单位", width: 56, render: (_, r) => r.unit },
      {
        key: "stockQty",
        title: "物料库存数",
        width: 108,
        align: "right",
        render: (_, r) => {
          const q = materialStockById[r.materialId];
          if (typeof q !== "number" || !Number.isFinite(q)) return "—";
          return Math.trunc(q);
        },
      },
      {
        key: "quantity",
        title: "数量",
        width: 100,
        render: (_, row) => (
          <InputNumber
            min={0}
            max={999999999}
            precision={0}
            disabled={locked}
            style={{ width: "100%", ...lockedFieldStyle }}
            value={row.quantity}
            onChange={(v) => {
              const n =
                v === null || v === undefined
                  ? 0
                  : Math.max(0, Math.min(999999999, Math.round(Number(v))));
              updateLine(gi, row.materialId, { quantity: n });
            }}
          />
        ),
      },
      {
        key: "unitPrice",
        title: priceLabels.unitPrice,
        width: 110,
        render: (_, row) => (
          <InputNumber
            min={0}
            precision={4}
            disabled={locked}
            style={{ width: "100%", ...lockedFieldStyle }}
            value={row.unitPriceNum}
            onChange={(v) =>
              updateLine(gi, row.materialId, {
                unitPriceNum:
                  typeof v === "number" && !Number.isNaN(v) ? v : 0,
              })
            }
          />
        ),
      },
      {
        key: "total",
        title: groups[gi]?.supplier.priceIncludesTax ? "总价（含税）" : "总价",
        width: 100,
        align: "right",
        render: (_, r) => (r.quantity * r.unitPriceNum).toFixed(4),
      },
      {
        key: "remark",
        title: "备注",
        render: (_, row) => (
          <Input
            value={row.remark}
            disabled={locked}
            style={lockedFieldStyle}
            onChange={(e) =>
              updateLine(gi, row.materialId, { remark: e.target.value })
            }
            placeholder="可选"
          />
        ),
      },
    ];
    },
    [updateLine, materialStockById, groups],
  );

  const getSplitGroupColumnsForTable = useCallback(
    (gi: number) => {
      const all = makeSplitGroupColumns(gi);
      const visible = all.filter(
        (col) =>
          typeof col.key === "string" && splitGroupColKeys.includes(String(col.key)),
      );
      return attachResizeWizardCols(
        visible,
        splitGroupColWidths,
        setSplitGroupColWidths,
        DEFAULT_WIZARD_GROUP_WIDTH,
      );
    },
    [makeSplitGroupColumns, splitGroupColKeys, splitGroupColWidths],
  );

  const bomByProductForView = useMemo(() => {
    if (!split) return [];
    return split.bomByProduct.map((bp) => {
      const demandQty = Math.max(
        0,
        Math.trunc(Number(actualDemandByProductId[bp.productId] ?? bp.salesQty) || 0),
      );
      return {
        ...bp,
        demandQty,
        bomLines: bp.bomLines.map((bl) => ({
          ...bl,
          needQty: demandQty <= 0 ? 0 : ceilQty(Number(bl.usageQty) * demandQty),
        })),
      };
    });
  }, [split, actualDemandByProductId]);

  const orderedQtyByMaterial = split?.orderedQtyByMaterial ?? {};

  const materialFullyOrdered = useMemo(() => {
    const need = new Map<string, number>();
    for (const bp of bomByProductForView) {
      for (const bl of bp.bomLines) {
        need.set(
          bl.materialId,
          (need.get(bl.materialId) ?? 0) + bl.needQty,
        );
      }
    }
    const set = new Set<string>();
    for (const [mid, n] of need) {
      if (n > 0 && (orderedQtyByMaterial[mid] ?? 0) >= n) {
        set.add(mid);
      }
    }
    return set;
  }, [bomByProductForView, orderedQtyByMaterial]);

  const bomRefAllColumns = useMemo((): ColumnsType<BomLine> => {
    const grayStyle = { color: ALREADY_ORDERED_GRAY };
    const wrap = (node: ReactNode, r: BomLine) =>
      materialFullyOrdered.has(r.materialId) ? (
        <span style={grayStyle}>{node}</span>
      ) : (
        node
      );
    return [
      {
        key: "code",
        title: "物料",
        width: 90,
        ellipsis: true,
        render: (_, r) => wrap(r.code, r),
      },
      {
        key: "usageQty",
        title: "用量",
        width: 56,
        render: (_, r) => wrap(r.usageQty, r),
      },
      {
        key: "needQty",
        title: "需求",
        width: 56,
        render: (_, r) => wrap(r.needQty, r),
      },
    ];
  }, [materialFullyOrdered]);

  const bomRefColumns = useMemo(() => {
    const visible = bomRefAllColumns.filter(
      (col) =>
        typeof col.key === "string" && bomRefColKeys.includes(String(col.key)),
    );
    return attachResizeWizardCols(
      visible,
      bomRefColWidths,
      setBomRefColWidths,
      DEFAULT_BOM_SIDEBAR_WIDTH,
    );
  }, [bomRefAllColumns, bomRefColKeys, bomRefColWidths]);

  const positiveQtyGroups = useMemo(
    () => groupsWithPositiveQuantityLines(groups),
    [groups],
  );
  const allQuantitiesAreZero = useMemo(
    () => isAllLineQuantitiesZero(groups),
    [groups],
  );

  const openUnifiedPreview = useCallback(async () => {
    if (!split) return;
    if (positiveQtyGroups.length === 0) {
      message.warning(
        "没有可采购的明细：数量 0 表示不采购。请至少保留一条数量大于 0 的物料。",
      );
      return;
    }
    const needConfirm = groups.filter((g) =>
      g.lines.some((l) => shouldShowPurchaseLine(l)),
    );
    const unconfirmed = needConfirm.filter((g) => !g.confirmed);
    if (unconfirmed.length > 0) {
      message.warning(
        `请先对各供应商点「确认」：${unconfirmed.map((g) => g.supplier.name).join("、")}`,
      );
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
          salesOrderId: split.salesOrder.id,
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
    setPreviewSupplierId(positiveQtyGroups[0]?.supplierId);
    setPreviewOpen(true);
  }, [groups, message, modal, positiveQtyGroups, split]);

  const submitNoPurchaseRequired = useCallback(() => {
    if (!split || !allQuantitiesAreZero) return;
    modal.confirm({
      title: "确认本单无需采购？",
      content:
        "当前各物料采购数量均为 0（库存可覆盖需求时）。确认后，本销售订单的采购环节将记为已处理，本单不再出现在「从销售订单新建采购」列表中。",
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        setNoPurchaseMarking(true);
        try {
          await fetchJson(`/api/sales-orders/${split.salesOrder.id}/no-purchase-required`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          message.success("已标记为无需采购");
          onClose();
          onSuccess();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "操作失败");
          throw e;
        } finally {
          setNoPurchaseMarking(false);
        }
      },
    });
  }, [allQuantitiesAreZero, message, modal, onClose, onSuccess, split]);

  const submitBatch = async () => {
    if (!split) return;
    const toCreate = positiveQtyGroups;
    if (toCreate.length === 0) {
      message.warning("没有可生成的采购明细，请至少保留一条数量大于 0 的物料。");
      return;
    }
    setSubmitting(true);
    try {
      await fetchJson("/api/purchase-orders/batch-from-sales", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salesOrderId: split.salesOrder.id,
          remark: "",
          groups: toCreate.map((g) => ({
            supplierId: g.supplierId,
            lines: g.lines.map((l) => ({
              materialId: l.materialId,
              quantity: l.quantity,
              unitPrice: l.unitPriceNum,
              remark: l.remark || undefined,
            })),
            extraFees: (extraFeesBySupplierId[g.supplierId] ?? []).map((f) => ({
              amount: f.amount,
              purpose: f.purpose,
            })),
          })),
        }),
      });
      savePurchaseWizardDraft({
        salesOrderId: split.salesOrder.id,
        actualDemandByProductId,
        suppliers: {},
        updatedAt: new Date().toISOString(),
      });
      message.success("采购订单已生成");
      setPreviewOpen(false);
      onClose();
      onSuccess();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const printPreview = () => {
    window.print();
  };

  const previewGroup = useMemo(() => {
    if (positiveQtyGroups.length === 0) return null;
    const id = previewSupplierId;
    if (id) {
      const hit = positiveQtyGroups.find((g) => g.supplierId === id);
      if (hit) return hit;
    }
    return positiveQtyGroups[0] ?? null;
  }, [positiveQtyGroups, previewSupplierId]);

  const previewActiveSupplierId =
    previewSupplierId ?? positiveQtyGroups[0]?.supplierId ?? null;

  const previewExtraFees = previewActiveSupplierId
    ? (extraFeesBySupplierId[previewActiveSupplierId] ?? [])
    : [];

  const setPreviewExtraFees = useCallback(
    (fees: PurchaseExtraFeeRow[]) => {
      if (!previewActiveSupplierId || !split) return;
      setExtraFeesBySupplierId((prev) => ({
        ...prev,
        [previewActiveSupplierId]: fees,
      }));
      const g = groups.find((x) => x.supplierId === previewActiveSupplierId);
      if (g?.confirmed) {
        upsertWizardSupplierDraft(
          split.salesOrder.id,
          previewActiveSupplierId,
          {
            confirmed: true,
            lines: groupToLineDrafts(g.lines),
            extraFees: fees,
          },
          actualDemandByProductId,
        );
      }
    },
    [previewActiveSupplierId, split, groups, actualDemandByProductId],
  );

  /** 预览合同交货日与正式生成采购单时相同规则（创建日 + 供应商交货天数） */
  const previewDeliveryDueAtIso = useMemo(() => {
    if (!previewGroup) return null;
    const due = computePurchaseOrderDeliveryDue(
      new Date(),
      previewGroup.supplier.deliveryLeadDays,
    );
    return due?.toISOString() ?? null;
  }, [previewGroup]);

  useEffect(() => {
    if (!previewOpen || !previewGroup?.supplierId) return;
    let cancelled = false;
    setPreviewContractNo(null);
    void (async () => {
      try {
        const r = await fetchJson<{ orderNo: string }>(
          `/api/purchase-orders/next-number-preview?supplierId=${encodeURIComponent(previewGroup.supplierId)}`,
          { credentials: "include" },
        );
        if (!cancelled && r.orderNo?.trim()) setPreviewContractNo(r.orderNo.trim());
      } catch {
        if (!cancelled) setPreviewContractNo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewOpen, previewGroup?.supplierId]);

  /** 打印另存 PDF 时标题与合同编号一致 */
  useEffect(() => {
    if (!previewOpen || !previewGroup) return;
    const prev = document.title;
    document.title = previewContractNo?.trim() || "采购合同预览";
    return () => {
      document.title = prev;
    };
  }, [previewOpen, previewGroup, previewContractNo]);

  return (
    <>
      <Modal
        title="从销售订单新建采购"
        open={open && !previewOpen}
        onCancel={onClose}
        width="min(1800px, 96vw)"
        centered
        styles={{
          body: {
            maxHeight: "calc(100vh - 100px)",
            minHeight: "min(52vh, 520px)",
            overflow: "auto",
          },
        }}
        destroyOnHidden
        footer={null}
      >
        <Steps
          current={step}
          items={[{ title: "选择销售订单" }, { title: "核对拆分明细" }]}
          style={{ marginBottom: 24 }}
        />
        {step === 0 && (
          <Space
            direction="vertical"
            style={{ width: "100%", minHeight: "min(36vh, 400px)" }}
            size="middle"
          >
            <Typography.Text type="secondary">
              列出尚未出货且仍需采购的销售订单：从未下过采购、或删除/作废部分采购单后尚有未覆盖物料、或存在已取消单需补开。进入后仅显示待采明细（已删单按 BOM 缺口，已取消单按原单明细）。
              汇总物料并按供应商拆成多张采购单。下拉项为：客户名称 · 客户机型 · 订单编号。
            </Typography.Text>
            <Select
              showSearch
              allowClear
              placeholder="选择销售订单（客户名称 · 客户机型 · 订单编号）"
              style={{ width: "100%" }}
              loading={loadingEligible}
              value={soId}
              onChange={(v) => setSoId(v)}
              options={eligible.map((r) => {
                const name = r.customer.name?.trim() || "—";
                const model = r.customerModel?.trim() || "—";
                const orderNo = r.customerOrderNo?.trim() || "—";
                return {
                  value: r.id,
                  label: `${name} · ${model} · ${orderNo}`,
                };
              })}
              optionFilterProp="label"
              popupMatchSelectWidth={false}
              styles={{ popup: { root: { minWidth: 720 } } }}
            />
            <Space>
              <Button type="primary" onClick={() => void loadSplit()} loading={loadingSplit}>
                下一步
              </Button>
              <Button onClick={onClose}>取消</Button>
            </Space>
          </Space>
        )}
        {step === 1 && split && (
          <Layout style={{ background: "transparent", minHeight: "min(72vh, 780px)" }}>
            <Layout.Content style={{ paddingRight: 12 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 0 }}>
                  按供应商拆分的采购明细（可调整数量、单价）
                </Typography.Title>
                <WizardColumnSettingButton
                  value={splitGroupColKeys}
                  onChange={setSplitGroupColKeys}
                  options={WIZARD_GROUP_COL_OPTIONS}
                />
              </div>
              {groups.map((g, gi) => {
                const visibleLines = g.lines.filter(shouldShowPurchaseLine);
                if (visibleLines.length === 0) return null;
                return (
                <div key={g.supplierId} style={{ marginBottom: 20 }}>
                  <Typography.Text strong>
                    {g.supplier.code} {g.supplier.name}
                    {g.redoCancelledOrderNos?.length ? (
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12, marginLeft: 8, fontWeight: 400 }}
                      >
                        （补开：{g.redoCancelledOrderNos.join("、")}）
                      </Typography.Text>
                    ) : null}
                  </Typography.Text>
                  <Table<EditableLine>
                    size="small"
                    style={{ marginTop: 8 }}
                    pagination={false}
                    rowKey={(r) => r.materialId}
                    dataSource={visibleLines}
                    columns={getSplitGroupColumnsForTable(gi)}
                    scroll={{ x: "max-content" }}
                    tableLayout="fixed"
                    components={{
                      header: { cell: ResizableTableTitle },
                    }}
                  />
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      justifyContent: "flex-end",
                    }}
                  >
                    <Space size={4}>
                      <Button
                        size="small"
                        type="primary"
                        disabled={g.confirmed}
                        onClick={() => confirmSupplierGroup(gi)}
                      >
                        确认
                      </Button>
                      <Button
                        size="small"
                        disabled={!g.confirmed}
                        onClick={() => modifySupplierGroup(gi)}
                      >
                        修改
                      </Button>
                    </Space>
                  </div>
                </div>
                );
              })}
              <Space style={{ marginTop: 8 }} wrap>
                <Button onClick={() => setStep(0)}>上一步</Button>
                {allQuantitiesAreZero && (
                  <Button
                    type="primary"
                    loading={noPurchaseMarking}
                    onClick={submitNoPurchaseRequired}
                  >
                    无需采购
                  </Button>
                )}
                <Button
                  type={allQuantitiesAreZero ? "default" : "primary"}
                  onClick={() => void openUnifiedPreview()}
                >
                  确认生成预览
                </Button>
                <Button onClick={onClose}>取消</Button>
              </Space>
            </Layout.Content>
            <Layout.Sider
              width={420}
              style={{ background: "#fafafa", padding: 12 }}
              breakpoint="lg"
              collapsedWidth={0}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <Typography.Text strong>BOM 参照（销售商品 → 物料）</Typography.Text>
                <WizardColumnSettingButton
                  value={bomRefColKeys}
                  onChange={setBomRefColKeys}
                  options={BOM_SIDEBAR_COL_OPTIONS}
                />
              </div>
              <div
                style={{
                  marginTop: 8,
                  maxHeight: "min(68vh, 720px)",
                  overflow: "auto",
                }}
              >
                {bomByProductForView.map((bp) => (
                  <div key={bp.productId} style={{ marginBottom: 16 }}>
                    <Space direction="vertical" size={4} style={{ width: "100%" }}>
                      <Typography.Text>
                        商品 {bp.customerMaterialCode || "—"} / {bp.model} × {bp.salesQty} {bp.unit}
                      </Typography.Text>
                      <Space wrap>
                        <Typography.Text type="secondary">
                          现有商品库存数：<strong>{Math.trunc(Number(bp.productStockQty || 0))}</strong>
                        </Typography.Text>
                        {split.splitMode === "full_bom" ? (
                          <>
                            <Typography.Text type="secondary">
                              实际需求商品数：
                            </Typography.Text>
                            <InputNumber
                              min={0}
                              precision={0}
                              value={bp.demandQty}
                              onChange={(v) => {
                                const n =
                                  v == null
                                    ? 0
                                    : Math.max(
                                        0,
                                        Math.min(999999999, Math.round(Number(v))),
                                      );
                                setActualDemandByProductId((prev) => {
                                  const next = { ...prev, [bp.productId]: n };
                                  applyActualDemandToGroups(next);
                                  return next;
                                });
                              }}
                            />
                          </>
                        ) : null}
                      </Space>
                    </Space>
                    <Table<BomLine>
                      size="small"
                      pagination={false}
                      rowKey={(r) => `${bp.productId}-${r.materialId}`}
                      dataSource={bp.bomLines}
                      columns={bomRefColumns}
                      scroll={{ x: "max-content" }}
                      tableLayout="fixed"
                      components={{
                        header: { cell: ResizableTableTitle },
                      }}
                    />
                    {bp.bomLines.length === 0 && (
                      <Typography.Text type="secondary">无 BOM</Typography.Text>
                    )}
                  </div>
                ))}
              </div>
            </Layout.Sider>
          </Layout>
        )}
      </Modal>

      <Modal
        title="采购合同预览"
        open={previewOpen}
        onCancel={() => {
          setPreviewOpen(false);
          setPreviewSupplierId(undefined);
        }}
        width="min(1600px, 94vw)"
        centered
        styles={{
          body: { maxHeight: "calc(100vh - 140px)", overflow: "auto" },
        }}
        destroyOnHidden
        footer={
          <Space wrap>
            <Button
              onClick={() => {
                setPreviewOpen(false);
                setPreviewSupplierId(undefined);
              }}
            >
              返回编辑
            </Button>
            <Button onClick={() => previewFeesPanelRef.current?.openAddFee()}>
              添加费用
            </Button>
            <Button onClick={printPreview}>打印 / 导出 PDF</Button>
            <Button
              type="primary"
              loading={submitting}
              onClick={() => void submitBatch()}
            >
              确定生成
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph
          type="secondary"
          className="purchase-contract-print-ui"
          style={{ marginBottom: 8 }}
        >
          浏览器打印对话框中选择「另存为 PDF」即可导出 PDF。请先选择乙方（供应商），可为本合同添加开模费、测试架等附加费用，再打印或点击「确定生成」。
        </Typography.Paragraph>
        {split && positiveQtyGroups.length > 0 && (
          <Space className="purchase-contract-print-ui" style={{ marginBottom: 16 }} wrap align="center">
            <Typography.Text strong>乙方（供应商）</Typography.Text>
            <Select
              style={{ minWidth: 360 }}
              value={previewSupplierId ?? positiveQtyGroups[0]?.supplierId}
              onChange={(v) => setPreviewSupplierId(v)}
              options={positiveQtyGroups.map((g) => ({
                value: g.supplierId,
                label: `${g.supplier.code} ${g.supplier.name}`,
              }))}
              popupMatchSelectWidth={false}
              styles={{ popup: { root: { minWidth: 320 } } }}
            />
          </Space>
        )}
        <PurchaseOrderExtraFeesPanel
          ref={previewFeesPanelRef}
          className="purchase-contract-print-ui"
          purchaseOrderId={null}
          fees={previewExtraFees}
          onFeesChange={setPreviewExtraFees}
        />
        <div id="purchase-batch-preview" style={{ padding: 8 }}>
          {split && previewGroup && (
            <PurchaseVisualContractPreview
              visual={visualTemplate ?? mergeVisualEditorState(undefined)}
              supplier={previewGroup.supplier}
              lines={previewGroup.lines}
              deliveryDueAtIso={previewDeliveryDueAtIso}
              customerLine={`${split.salesOrder.customer.code} ${split.salesOrder.customer.name} ${split.salesOrder.customerOrderNo?.trim() || "—"}`}
              contractNoOverride={previewContractNo}
              extraFees={previewExtraFees}
            />
          )}
        </div>
      </Modal>

      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  @page {
    size: A4 portrait;
    margin: 10mm;
  }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    height: auto !important;
    background: #fff !important;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .purchase-contract-print-ui {
    display: none !important;
  }
  body * {
    visibility: hidden !important;
  }
  #purchase-batch-preview,
  #purchase-batch-preview * {
    visibility: visible !important;
  }
  /* fixed：相对整页排版，避免 Modal 内 absolute 在打印时仍落在视口中部造成大段顶空白 */
  #purchase-batch-preview {
    position: fixed !important;
    left: 0 !important;
    top: 0 !important;
    right: 0 !important;
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    box-sizing: border-box !important;
    background: #fff !important;
    z-index: 2147483647 !important;
    overflow: visible !important;
  }
  #purchase-batch-preview .purchase-visual-print-root {
    max-width: 100% !important;
    margin: 0 auto !important;
  }
}`,
        }}
      />
    </>
  );
}
