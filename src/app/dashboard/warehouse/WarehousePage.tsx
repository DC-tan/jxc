"use client";

import { QuestionCircleOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  DatePicker,
  Input,
  InputNumber,
  Modal,
  Space,
  Spin,
  Table,
  Tabs,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { inhouseMaterialRowsForProductSets } from "@/lib/inhouse-bom-display";
import { useMeTabPermissions } from "@/lib/use-me-tab-permissions";
import {
  defaultInhouseProduceQty,
  inhouseProduceTooLowToShipMessage,
  shipmentNeedsInhouseStep,
} from "@/lib/warehouse-delivery-inhouse-step";
import { WAREHOUSE_DELIVERY_DRAFT_KEY } from "@/lib/warehouse-delivery-draft";

const WAREHOUSE_TAB_PERM: Record<string, string> = {
  ship: "tab.wh.ship",
  query: "tab.wh.query",
  settings: "tab.wh.settings",
};
import type { WarehouseDeliveryDraft } from "@/lib/warehouse-delivery-draft";
import { WarehouseSettingsTab } from "./WarehouseSettingsTab";

type CustomerBrief = { id: string; code: string; name: string };

type WarehouseSalesRow = {
  id: string;
  customerOrderNo: string;
  customerModel: string;
  deliveryDueAt: string | null;
  actualDeliveredAt: string | null;
  /** 任一行出货记录的最晚时间（仅出货查询含分批时返回，用于未结单订单） */
  latestBatchDeliveredAt?: string | null;
  totalAmount: string;
  remark: string | null;
  customer: CustomerBrief;
  createdAt: string;
  updatedAt: string;
};

type DetailLine = {
  id: string;
  quantity: number;
  quantityShipped: number;
  remaining: number;
  shipHistory?: { at: string; qty: number }[];
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
    processingMode?: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
    inhouseBom?: {
      materialId: string;
      usageQty: number;
      materialStock?: number;
      material: {
        code: string;
        name: string;
        unit: string;
        partDescription?: string | null;
      };
    }[];
    /** 商品当前库存（成品入库累计） */
    stockQuantity?: number;
    /** 外发回收库库存（仅外发+自加工） */
    recoveryStockQuantity?: number;
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
  customer: CustomerBrief;
  createdAt: string;
  lines: DetailLine[];
};

function buildQuery(
  tab: "pending" | "delivered",
  params: {
    keyword?: string;
    createdRange?: [dayjs.Dayjs, dayjs.Dayjs];
    deliveredRange?: [dayjs.Dayjs, dayjs.Dayjs];
    /** 含分批已出货但整单未结 */
    includePartialInquiry?: boolean;
  },
): string {
  const sp = new URLSearchParams();
  sp.set("tab", tab);
  if (params.keyword?.trim()) sp.set("keyword", params.keyword.trim());
  if (tab === "pending" && params.createdRange?.[0] && params.createdRange[1]) {
    sp.set("createdFrom", params.createdRange[0].startOf("day").toISOString());
    sp.set("createdTo", params.createdRange[1].endOf("day").toISOString());
  }
  if (tab === "delivered" && params.deliveredRange?.[0] && params.deliveredRange[1]) {
    sp.set(
      "deliveredFrom",
      params.deliveredRange[0].startOf("day").toISOString(),
    );
    sp.set("deliveredTo", params.deliveredRange[1].endOf("day").toISOString());
  }
  if (tab === "delivered" && params.includePartialInquiry) {
    sp.set("includePartialInquiry", "1");
  }
  return sp.toString();
}

function HelpTip({ text }: { text: ReactNode }) {
  return (
    <Tooltip title={<span style={{ whiteSpace: "normal" }}>{text}</span>} placement="topLeft">
      <QuestionCircleOutlined style={{ color: "#8c8c8c", cursor: "help" }} />
    </Tooltip>
  );
}

export function WarehousePage() {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("ship");

  useEffect(() => {
    if (searchParams.get("tab") === "query") setTab("query");
  }, [searchParams]);

  const [pendingRows, setPendingRows] = useState<WarehouseSalesRow[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [pendingSelectMode, setPendingSelectMode] = useState(false);
  const [selectedPendingIds, setSelectedPendingIds] = useState<string[]>([]);
  const [closingPending, setClosingPending] = useState(false);
  const [deliveredRows, setDeliveredRows] = useState<WarehouseSalesRow[]>([]);
  const [loadingDelivered, setLoadingDelivered] = useState(false);
  const [exportingDeliveredQuery, setExportingDeliveredQuery] = useState(false);
  const [deliveredSelectMode, setDeliveredSelectMode] = useState(false);
  const [selectedDeliveredIds, setSelectedDeliveredIds] = useState<string[]>([]);
  const [voidingDelivered, setVoidingDelivered] = useState(false);

  const [deliverOpen, setDeliverOpen] = useState(false);
  const [deliverOrderId, setDeliverOrderId] = useState<string | null>(null);
  const [deliverOrderLabel, setDeliverOrderLabel] = useState("");
  const [deliverFetchLoading, setDeliverFetchLoading] = useState(false);
  const [deliverDetail, setDeliverDetail] = useState<DetailPayload | null>(null);
  const [deliverShipByLine, setDeliverShipByLine] = useState<Record<string, number>>(
    {},
  );
  const [deliverAt, setDeliverAt] = useState<dayjs.Dayjs | null>(null);
  /** 自加工 / 外发+自加工行：本批自加工完工数（≥ 本批出货） */
  const [deliverInhouseProduceByLine, setDeliverInhouseProduceByLine] =
    useState<Record<string, number>>({});

  const [queryKeyword, setQueryKeyword] = useState<string | undefined>();
  const [queryDeliveredRange, setQueryDeliveredRange] = useState<
    [dayjs.Dayjs, dayjs.Dayjs]
  >(() => [dayjs().subtract(30, "day"), dayjs()]);

  const loadPending = useCallback(async () => {
    setLoadingPending(true);
    try {
      const qs = buildQuery("pending", {});
      const data = await fetchJson<{ list: WarehouseSalesRow[] }>(
        `/api/warehouse/sales-orders?${qs}`,
        { credentials: "include" },
      );
      setPendingRows(data.list ?? []);
      setSelectedPendingIds((prev) =>
        prev.filter((id) => (data.list ?? []).some((x) => x.id === id)),
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoadingPending(false);
    }
  }, [message]);

  const runDeliveredQuery = useCallback(async () => {
    setLoadingDelivered(true);
    try {
      const qs = buildQuery("delivered", {
        keyword: queryKeyword,
        deliveredRange: queryDeliveredRange,
        includePartialInquiry: true,
      });
      const data = await fetchJson<{ list: WarehouseSalesRow[] }>(
        `/api/warehouse/sales-orders?${qs}`,
        { credentials: "include" },
      );
      setDeliveredRows(data.list ?? []);
      setSelectedDeliveredIds((prev) =>
        prev.filter((id) => (data.list ?? []).some((x) => x.id === id)),
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : "查询失败");
    } finally {
      setLoadingDelivered(false);
    }
  }, [message, queryKeyword, queryDeliveredRange]);

  useEffect(() => {
    if (tab === "ship") void loadPending();
  }, [tab, loadPending]);

  useEffect(() => {
    if (tab === "query") void runDeliveredQuery();
  }, [tab, runDeliveredQuery]);

  const openDeliver = useCallback(
    async (r: WarehouseSalesRow) => {
      setDeliverOrderId(r.id);
      setDeliverOrderLabel(`${r.customer.name} · ${r.customerOrderNo || "—"}`);
      setDeliverDetail(null);
      setDeliverShipByLine({});
      setDeliverInhouseProduceByLine({});
      setDeliverAt(dayjs());
      setDeliverOpen(true);
      setDeliverFetchLoading(true);
      try {
        const d = await fetchJson<DetailPayload>(
          `/api/warehouse/sales-orders/${r.id}`,
          { credentials: "include" },
        );
        setDeliverDetail(d);
        const init: Record<string, number> = {};
        for (const ln of d.lines) {
          init[ln.id] = ln.remaining;
        }
        setDeliverShipByLine(init);
        const inhouseProduceInit: Record<string, number> = {};
        for (const ln of d.lines) {
          const mode = ln.product.processingMode;
          const shipQty = init[ln.id] ?? ln.remaining;
          if (mode === "INHOUSE" || mode === "OUTSOURCE_INHOUSE") {
            const stock = ln.product.stockQuantity ?? 0;
            inhouseProduceInit[ln.id] = defaultInhouseProduceQty(shipQty, stock);
          }
        }
        setDeliverInhouseProduceByLine(inhouseProduceInit);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载订单失败");
        setDeliverOpen(false);
        setDeliverOrderId(null);
      } finally {
        setDeliverFetchLoading(false);
      }
    },
    [message],
  );

  const submitDeliver = useCallback(async () => {
    if (!deliverOrderId || !deliverDetail) return;
    if (!deliverAt) {
      message.warning("请选择本批交货时间");
      return;
    }
    const at = deliverAt;
    const lines = deliverDetail.lines
      .map((l) => ({
        lineId: l.id,
        shipQty: deliverShipByLine[l.id] ?? 0,
      }))
      .filter((x) => x.shipQty > 0);
    if (lines.length === 0) {
      message.warning("请至少一行填写大于 0 的本次发货数量");
      return;
    }
    const inhouseProduceByLineId: Record<string, number> = {};
    for (const l of deliverDetail.lines) {
      const mode = l.product.processingMode;
      if (mode !== "INHOUSE" && mode !== "OUTSOURCE_INHOUSE") continue;
      const shipQty = deliverShipByLine[l.id] ?? 0;
      if (shipQty <= 0) continue;
      const stock =
        typeof l.product.stockQuantity === "number" ? l.product.stockQuantity : 0;
      const defaultProduce = defaultInhouseProduceQty(shipQty, stock);
      const produce = deliverInhouseProduceByLine[l.id] ?? defaultProduce;
      if (produce < defaultProduce) {
        message.warning(
          inhouseProduceTooLowToShipMessage(
            l.product.model?.trim() ||
              l.product.customerMaterialCode?.trim() ||
              "—",
          ),
        );
        return;
      }
      inhouseProduceByLineId[l.id] = produce;
    }
    try {
      const pre = await fetchJson<{ needsInhouseStep: boolean }>(
        `/api/warehouse/sales-orders/${deliverOrderId}/deliver-preview`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lines,
            inhouseProduceByLineId,
            hybridInhouseProduceByLineId: inhouseProduceByLineId,
          }),
        },
      );
      const stepLines = deliverDetail.lines
        .filter((l) => (deliverShipByLine[l.id] ?? 0) > 0)
        .map((l) => ({
          lineId: l.id,
          processingMode: l.product.processingMode,
          productStock: l.product.stockQuantity,
        }));
      const needsInhouseStep =
        pre.needsInhouseStep &&
        shipmentNeedsInhouseStep(
          stepLines,
          deliverShipByLine,
          deliverInhouseProduceByLine,
        );
      const draft: WarehouseDeliveryDraft = {
        orderId: deliverOrderId,
        actualDeliveredAt: at.toISOString(),
        lines,
        inhouseProduceByLineId,
        hybridInhouseProduceByLineId: inhouseProduceByLineId,
        needsInhouseStep,
      };
      sessionStorage.setItem(WAREHOUSE_DELIVERY_DRAFT_KEY, JSON.stringify(draft));
      setDeliverOpen(false);
      setDeliverOrderId(null);
      setDeliverDetail(null);
      setDeliverShipByLine({});
      setDeliverInhouseProduceByLine({});
      setDeliverAt(null);
      if (needsInhouseStep) {
        router.push("/dashboard/warehouse/delivery-inhouse");
      } else {
        router.push("/dashboard/warehouse/delivery-note");
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "出货预检失败");
    }
  }, [
    deliverOrderId,
    deliverDetail,
    deliverShipByLine,
    deliverInhouseProduceByLine,
    deliverAt,
    message,
    router,
  ]);

  const deliverHasInhouseBom = useMemo(
    () =>
      deliverDetail?.lines.some((l) => {
        const mode = l.product.processingMode;
        return (
          (mode === "INHOUSE" || mode === "OUTSOURCE_INHOUSE") &&
          (l.product.inhouseBom?.length ?? 0) > 0
        );
      }) ?? false,
    [deliverDetail],
  );

  const deliverInhouseHints = useMemo(() => {
    if (!deliverDetail) return [];
    const hints: {
      lineId: string;
      productLabel: string;
      shipQty: number;
      isHybrid: boolean;
      rows: ReturnType<typeof inhouseMaterialRowsForProductSets>;
    }[] = [];
    for (const ln of deliverDetail.lines) {
      const mode = ln.product.processingMode;
      if (mode !== "INHOUSE" && mode !== "OUTSOURCE_INHOUSE") continue;
      const bom = ln.product.inhouseBom;
      if (!bom?.length) continue;
      const shipQty = deliverShipByLine[ln.id] ?? 0;
      if (shipQty <= 0) continue;
      const stock = ln.product.stockQuantity ?? 0;
      const defaultProduce = defaultInhouseProduceQty(shipQty, stock);
      const matSets = deliverInhouseProduceByLine[ln.id] ?? defaultProduce;
      const rows = inhouseMaterialRowsForProductSets(bom, matSets);
      if (rows.length === 0) continue;
      hints.push({
        lineId: ln.id,
        productLabel:
          ln.product.model?.trim() ||
          ln.product.customerMaterialCode?.trim() ||
          "—",
        shipQty,
        isHybrid: mode === "OUTSOURCE_INHOUSE",
        rows,
      });
    }
    return hints;
  }, [deliverDetail, deliverShipByLine, deliverInhouseProduceByLine]);

  const baseColumns: ColumnsType<WarehouseSalesRow> = useMemo(
    () => [
      {
        title: "客户",
        key: "cust",
        width: 160,
        ellipsis: true,
        render: (_, r) => r.customer.name || r.customer.code,
      },
      {
        title: "客户订单编号",
        dataIndex: "customerOrderNo",
        width: 140,
        ellipsis: true,
      },
      {
        title: "客户机型",
        dataIndex: "customerModel",
        width: 120,
        ellipsis: true,
        render: (t: string) => t?.trim() || "—",
      },
      {
        title: "要求交货",
        dataIndex: "deliveryDueAt",
        width: 120,
        render: (t: string | null) =>
          t ? dayjs(t).format("YYYY-MM-DD") : "—",
      },
      {
        title: "建单时间",
        dataIndex: "createdAt",
        width: 168,
        render: (t: string) => dayjs(t).format("YYYY-MM-DD HH:mm"),
      },
      {
        title: "订单金额",
        dataIndex: "totalAmount",
        width: 112,
        align: "right",
        render: (v: string) => Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2 }),
      },
      {
        title: "备注",
        dataIndex: "remark",
        ellipsis: true,
        render: (t: string | null) => t?.trim() || "—",
      },
    ],
    [],
  );

  /** 仅「出货查询」表：整单未结时备注提示，并与用户备注合并 */
  const queryRemarkCol: ColumnsType<WarehouseSalesRow>[number] = {
    title: "备注",
    dataIndex: "remark",
    ellipsis: true,
    render: (t: string | null, r) => {
      const user = t?.trim();
      if (r.actualDeliveredAt) {
        return user || "—";
      }
      if (user) {
        return `订单未交完；${user}`;
      }
      return "订单未交完";
    },
  };

  const queryDeliveredCol: ColumnsType<WarehouseSalesRow>[number] = {
    title: "实际交货",
    key: "delivered",
    width: 200,
    render: (_, r) => {
      if (r.actualDeliveredAt) {
        return dayjs(r.actualDeliveredAt).format("YYYY-MM-DD HH:mm");
      }
      if (r.latestBatchDeliveredAt) {
        return (
          <span>
            {dayjs(r.latestBatchDeliveredAt).format("YYYY-MM-DD HH:mm")}
            <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
              （最近一批·未结单）
            </Typography.Text>
          </span>
        );
      }
      return "—";
    },
  };

  const deliveredExtraCol: ColumnsType<WarehouseSalesRow>[number] = {
    title: "实际交货",
    dataIndex: "actualDeliveredAt",
    width: 168,
    render: (t: string | null) =>
      t ? dayjs(t).format("YYYY-MM-DD HH:mm") : "—",
  };

  const deliveryNotePreviewCol: ColumnsType<WarehouseSalesRow>[number] = {
    title: "送货单预览",
    key: "deliveryNotePreview",
    width: 112,
    align: "center",
    render: (_, r) => (
      <Link
        href={`/dashboard/warehouse/delivery-note?orderId=${encodeURIComponent(r.id)}&view=shipment`}
      >
        打开预览
      </Link>
    ),
  };

  const deliveredQueryAmountTotal = useMemo(
    () => deliveredRows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0),
    [deliveredRows],
  );

  const exportDeliveredQueryToExcel = useCallback(async () => {
    if (deliveredRows.length === 0) {
      message.warning("暂无数据可导出");
      return;
    }
    setExportingDeliveredQuery(true);
    try {
      const XLSX = await import("xlsx");
      const rows: Record<string, string | number>[] = deliveredRows.map((r) => {
        let delAt = "—";
        if (r.actualDeliveredAt) {
          delAt = dayjs(r.actualDeliveredAt).format("YYYY-MM-DD HH:mm");
        } else if (r.latestBatchDeliveredAt) {
          delAt = `${dayjs(r.latestBatchDeliveredAt).format("YYYY-MM-DD HH:mm")}（最近一批·未结单）`;
        }
        return {
          客户: r.customer.name || r.customer.code,
          客户订单编号: r.customerOrderNo,
          客户机型: r.customerModel?.trim() || "—",
          要求交货: r.deliveryDueAt ? dayjs(r.deliveryDueAt).format("YYYY-MM-DD") : "—",
          实际交货: delAt,
          建单时间: dayjs(r.createdAt).format("YYYY-MM-DD HH:mm"),
          订单金额: Number(r.totalAmount) || 0,
          备注: r.actualDeliveredAt
            ? (r.remark?.trim() || "—")
            : r.remark?.trim()
              ? `订单未交完；${r.remark.trim()}`
              : "订单未交完",
        };
      });
      rows.push({
        客户: "合计",
        客户订单编号: "",
        客户机型: "",
        要求交货: "",
        实际交货: "",
        建单时间: "",
        订单金额: deliveredQueryAmountTotal,
        备注: `共 ${deliveredRows.length} 单`,
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "出货查询");
      XLSX.writeFile(
        wb,
        `仓库出货查询_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`,
      );
      message.success("已导出");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExportingDeliveredQuery(false);
    }
  }, [message, deliveredRows, deliveredQueryAmountTotal]);

  const voidSelectedDelivered = useCallback(async () => {
    if (selectedDeliveredIds.length === 0) {
      message.warning("请先勾选要作废的出货记录");
      return;
    }
    modal.confirm({
      title: "确认作废已选出货记录？",
      content:
        "作废后将回退对应商品库存，并把销售订单恢复到「出货」列表中可重新出货。",
      okType: "danger",
      okText: "确认作废",
      cancelText: "取消",
      onOk: async () => {
        setVoidingDelivered(true);
        try {
          const res = await fetchJson<{
            revertedOrders?: number;
            revertedShipmentQty?: number;
          }>("/api/warehouse/sales-orders/void", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderIds: selectedDeliveredIds }),
          });
          message.success(
            `已作废 ${Math.max(0, Number(res.revertedOrders ?? 0))} 单，回退数量 ${Math.max(0, Number(res.revertedShipmentQty ?? 0))}`,
          );
          setSelectedDeliveredIds([]);
          setDeliveredSelectMode(false);
          await Promise.all([runDeliveredQuery(), loadPending()]);
        } catch (e) {
          message.error(e instanceof Error ? e.message : "作废失败");
          throw e;
        } finally {
          setVoidingDelivered(false);
        }
      },
    });
  }, [selectedDeliveredIds, message, modal, runDeliveredQuery, loadPending]);

  const shipActionCol: ColumnsType<WarehouseSalesRow>[number] = {
    title: "操作",
    key: "op",
    width: 120,
    fixed: "right",
    render: (_, r) => (
      <Button
        type="link"
        size="small"
        style={{ padding: 0, height: "auto" }}
        onClick={() => openDeliver(r)}
      >
        确认出货
      </Button>
    ),
  };

  const closeSelectedPending = useCallback(async () => {
    if (selectedPendingIds.length === 0) {
      message.warning("请先勾选要结单的订单");
      return;
    }
    modal.confirm({
      title: "确认批量结单？",
      content: "已勾选订单将直接结单，即使未交完也会从出货列表移出。",
      okType: "danger",
      okText: "确认结单",
      cancelText: "取消",
      onOk: async () => {
        setClosingPending(true);
        try {
          const res = await fetchJson<{ closedCount?: number }>(
            "/api/warehouse/sales-orders/close",
            {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderIds: selectedPendingIds }),
            },
          );
          message.success(`已结单 ${Math.max(0, Number(res.closedCount ?? 0))} 单`);
          setSelectedPendingIds([]);
          setPendingSelectMode(false);
          await loadPending();
          if (tab === "query") {
            await runDeliveredQuery();
          }
        } catch (e) {
          message.error(e instanceof Error ? e.message : "结单失败");
          throw e;
        } finally {
          setClosingPending(false);
        }
      },
    });
  }, [selectedPendingIds, message, modal, loadPending, runDeliveredQuery, tab]);

  const { loading: tabPermLoading, allowed } = useMeTabPermissions();

  const visibleWarehouseTabKeys = useMemo(
    () =>
      (["ship", "query", "settings"] as const).filter((k) =>
        allowed([WAREHOUSE_TAB_PERM[k]]),
      ),
    [allowed],
  );

  useEffect(() => {
    if (tabPermLoading) return;
    if (visibleWarehouseTabKeys.length === 0) return;
    const keys = visibleWarehouseTabKeys as readonly string[];
    if (!keys.includes(tab)) {
      setTab(keys[0] ?? "ship");
    }
  }, [tabPermLoading, visibleWarehouseTabKeys, tab]);

  return (
    <Card title="仓库出货">
      {tabPermLoading ? (
        <div style={{ padding: 56, textAlign: "center" }}>
          <Spin size="large" />
        </div>
      ) : visibleWarehouseTabKeys.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          当前账号无可用的仓库出货 TAB，请联系管理员在「员工管理 → 权限管理」中勾选对应 TAB。
        </Typography.Paragraph>
      ) : (
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "ship",
            label: "出货",
            children: (
              <Space direction="vertical" style={{ width: "100%" }} size="middle">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <Space>
                    <Button onClick={() => void loadPending()}>刷新</Button>
                    <Button
                      onClick={() => {
                        setPendingSelectMode((v) => !v);
                        setSelectedPendingIds([]);
                      }}
                    >
                      {pendingSelectMode ? "取消选择" : "选择"}
                    </Button>
                    {pendingSelectMode ? (
                      <Button
                        danger
                        type="primary"
                        onClick={() => void closeSelectedPending()}
                        disabled={selectedPendingIds.length === 0}
                        loading={closingPending}
                      >
                        结单
                      </Button>
                    ) : null}
                  </Space>
                  <HelpTip
                    text={
                      <>
                        以下为尚未交清的销售订单。点<strong>确认出货</strong>后，在弹窗中填写
                        <strong>本批实际出货</strong>
                        （可超过待交/订单行数量）。自加工/外发+自加工须在弹窗填写
                        <strong>本批自加工完工</strong>（默认=出货−商品库存）；若大于默认数，另经
                        <strong>补产入库存</strong>后再进<strong>送货单打印</strong>
                        。送货单上仅可添加备品/备注。点送货单<strong>完成</strong>
                        后登记库存；全部交清后写入<strong>实际交货时间</strong>。
                      </>
                    }
                  />
                </div>
                <Table<WarehouseSalesRow>
                  rowKey="id"
                  loading={loadingPending}
                  dataSource={pendingRows}
                  rowSelection={
                    pendingSelectMode
                      ? {
                          selectedRowKeys: selectedPendingIds,
                          onChange: (keys) =>
                            setSelectedPendingIds(keys.map((x) => String(x))),
                        }
                      : undefined
                  }
                  columns={[...baseColumns, shipActionCol]}
                  scroll={{ x: "max-content" }}
                  pagination={{ pageSize: 10 }}
                  locale={{ emptyText: "暂无待出货订单" }}
                />
              </Space>
            ),
          },
          {
            key: "query",
            label: "出货查询",
            children: (
              <Space direction="vertical" style={{ width: "100%" }} size="middle">
                <Space wrap align="end" size="middle" style={{ rowGap: 12 }}>
                  <Space direction="vertical" size={4}>
                    <Typography.Text>关键字</Typography.Text>
                    <Input
                      allowClear
                      placeholder="订单号 / 机型 / 客户名称或编号"
                      style={{ width: 240 }}
                      value={queryKeyword}
                      onChange={(e) =>
                        setQueryKeyword(e.target.value || undefined)
                      }
                    />
                  </Space>
                  <Space direction="vertical" size={4}>
                    <Space size={4}>
                      <Typography.Text>交货日期</Typography.Text>
                      <HelpTip text="含整单已交清订单的「实际交货时间」；及仅分批出货订单中落在区间内的任一批次时间。" />
                    </Space>
                    <DatePicker.RangePicker
                      value={queryDeliveredRange}
                      onChange={(range) => {
                        if (range?.[0] && range[1]) {
                          setQueryDeliveredRange([range[0], range[1]]);
                        }
                      }}
                    />
                  </Space>
                  <Button type="primary" onClick={() => void runDeliveredQuery()}>
                    查询
                  </Button>
                  <Button
                    onClick={() => {
                      setDeliveredSelectMode((v) => !v);
                      setSelectedDeliveredIds([]);
                    }}
                  >
                    {deliveredSelectMode ? "取消选择" : "选择"}
                  </Button>
                  {deliveredSelectMode ? (
                    <Button
                      danger
                      type="primary"
                      onClick={() => void voidSelectedDelivered()}
                      disabled={selectedDeliveredIds.length === 0}
                      loading={voidingDelivered}
                    >
                      作废
                    </Button>
                  ) : null}
                  <div style={{ marginInlineStart: "auto" }}>
                    <HelpTip
                      text={
                        <>
                          按<strong>整单实际交货</strong>或<strong>分批出货时间</strong>
                          区间与关键字查询：含已交清单、仅分批出货且
                          <strong>整单未结</strong>的订单。未结订单备注列会标注「订单未交完」。
                        </>
                      }
                    />
                  </div>
                </Space>
                <Table<WarehouseSalesRow>
                  rowKey="id"
                  loading={loadingDelivered}
                  dataSource={deliveredRows}
                  rowSelection={
                    deliveredSelectMode
                      ? {
                          selectedRowKeys: selectedDeliveredIds,
                          onChange: (keys) =>
                            setSelectedDeliveredIds(keys.map((x) => String(x))),
                        }
                      : undefined
                  }
                  columns={[
                    ...baseColumns.slice(0, 4),
                    queryDeliveredCol,
                    deliveryNotePreviewCol,
                    ...baseColumns.slice(4, 6),
                    queryRemarkCol,
                  ]}
                  scroll={{ x: "max-content" }}
                  pagination={{ pageSize: 10 }}
                  locale={{ emptyText: "暂无数据" }}
                  summary={
                    deliveredRows.length > 0
                      ? () => (
                          <Table.Summary fixed>
                            <Table.Summary.Row>
                              <Table.Summary.Cell index={0} colSpan={7} align="right">
                                <Typography.Text type="secondary">金额合计</Typography.Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={7} align="right">
                                <Typography.Text strong>
                                  {deliveredQueryAmountTotal.toLocaleString("zh-CN", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                </Typography.Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={8} />
                            </Table.Summary.Row>
                          </Table.Summary>
                        )
                      : undefined
                  }
                />
                <div style={{ marginTop: 8 }}>
                  <Button
                    type="default"
                    onClick={() => void exportDeliveredQueryToExcel()}
                    loading={exportingDeliveredQuery}
                    disabled={deliveredRows.length === 0}
                  >
                    导出 Excel
                  </Button>
                </div>
              </Space>
            ),
          },
          {
            key: "settings",
            label: "出货设置",
            children: <WarehouseSettingsTab />,
          },
        ].filter((item) => {
          const code = WAREHOUSE_TAB_PERM[String(item.key)];
          return code ? allowed([code]) : false;
        })}
      />
      )}

      <Modal
        title={
          <Space size={6}>
            <span>{`确认出货 — ${deliverOrderLabel}`}</span>
            <HelpTip
              text={
                <>
                  请在此填写每行<strong>本批实际要出货</strong>
                  数量（默认等于待交，可少填分批，也可<strong>大于待交/订单行数量</strong>以多发）。自加工 /
                  自加工 / 外发+自加工：<strong>本批自加工完工</strong>默认=本批出货−<strong>商品库存</strong>（库存≥出货时为
                  0）；手动大于默认数时进入<strong>补产入库存</strong>页（外发+自加工另须外发回收库≥本批自加工完工数）。打印送货单上仅展示本处出货数量；备品/附加备注在送货单页添加。点送货单
                  <strong>完成</strong>后登记库存。
                </>
              }
            />
          </Space>
        }
        open={deliverOpen}
        onCancel={() => {
          setDeliverOpen(false);
          setDeliverOrderId(null);
          setDeliverDetail(null);
          setDeliverShipByLine({});
          setDeliverInhouseProduceByLine({});
          setDeliverAt(null);
        }}
        okText="下一步"
        onOk={() => void submitDeliver()}
        width={1200}
        styles={{ body: { maxHeight: "min(72vh, 720px)", overflowY: "auto" } }}
      >
        {deliverFetchLoading ? (
          <Spin />
        ) : deliverDetail ? (
          <Table<DetailLine>
            size="small"
            rowKey="id"
            pagination={false}
            style={{ marginBottom: 16 }}
            dataSource={deliverDetail.lines}
            columns={[
              {
                title: "物料编号",
                width: 110,
                ellipsis: true,
                render: (_, l) => l.product.customerMaterialCode?.trim() || "—",
              },
              {
                title: "型号",
                width: 110,
                ellipsis: true,
                render: (_, l) => l.product.model?.trim() || "—",
              },
              { title: "单位", width: 56, render: (_, l) => l.product.unit },
              {
                title: "商品库存",
                key: "stockQuantity",
                width: 88,
                align: "right",
                render: (_, l) => {
                  const q = l.product.stockQuantity;
                  return typeof q === "number" && Number.isFinite(q) ? q : "—";
                },
              },
              {
                title: "外发回收库",
                key: "recoveryStock",
                width: 96,
                align: "right",
                render: (_, l) => {
                  if (l.product.processingMode !== "OUTSOURCE_INHOUSE") return "—";
                  const q = l.product.recoveryStockQuantity;
                  return typeof q === "number" && Number.isFinite(q) ? q : "—";
                },
              },
              {
                title: "订单数量",
                dataIndex: "quantity",
                width: 88,
                align: "right",
              },
              {
                title: "已交数量",
                key: "shipped",
                width: 220,
                render: (_, l) => (
                  <Space direction="vertical" size={2} style={{ width: "100%" }}>
                    <Typography.Text strong>累计 {l.quantityShipped}</Typography.Text>
                    {l.shipHistory && l.shipHistory.length > 0 ? (
                      <div style={{ fontSize: 12, color: "#666", lineHeight: 1.4 }}>
                        {l.shipHistory.map((h) => (
                          <div key={`${h.at}-${h.qty}`}>
                            {dayjs(h.at).format("YYYY-MM-DD HH:mm")} 出货 {h.qty}
                          </div>
                        ))}
                      </div>
                    ) : l.quantityShipped > 0 ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        （无分批记录）
                      </Typography.Text>
                    ) : null}
                  </Space>
                ),
              },
              {
                title: "待交",
                dataIndex: "remaining",
                width: 72,
                align: "right",
                render: (n: number) => n,
              },
              {
                title: "本批实际出货",
                key: "ship",
                width: 120,
                render: (_, l) => (
                  <InputNumber
                    min={0}
                    max={10_000_000}
                    precision={0}
                    value={deliverShipByLine[l.id] ?? 0}
                    onChange={(v) => {
                      const raw =
                        v === null || v === undefined
                          ? 0
                          : Math.trunc(Number(v));
                      const n = Math.max(
                        0,
                        Math.min(10_000_000, Number.isFinite(raw) ? raw : 0),
                      );
                      setDeliverShipByLine((prev) => ({ ...prev, [l.id]: n }));
                      if (
                        l.product.processingMode === "INHOUSE" ||
                        l.product.processingMode === "OUTSOURCE_INHOUSE"
                      ) {
                        const stock = l.product.stockQuantity ?? 0;
                        setDeliverInhouseProduceByLine((prev) => ({
                          ...prev,
                          [l.id]: defaultInhouseProduceQty(n, stock),
                        }));
                      }
                    }}
                  />
                ),
              },
              {
                title: "本批自加工完工",
                key: "hybridInhouse",
                width: 130,
                render: (_, l) => {
                  if (
                    l.product.processingMode !== "INHOUSE" &&
                    l.product.processingMode !== "OUTSOURCE_INHOUSE"
                  ) {
                    return <Typography.Text type="secondary">—</Typography.Text>;
                  }
                  const shipQty = deliverShipByLine[l.id] ?? 0;
                  const stock = l.product.stockQuantity ?? 0;
                  const defaultProduce = defaultInhouseProduceQty(shipQty, stock);
                  return (
                    <InputNumber
                      min={0}
                      max={10_000_000}
                      precision={0}
                      value={deliverInhouseProduceByLine[l.id] ?? defaultProduce}
                      disabled={shipQty <= 0}
                      onChange={(v) => {
                        if (v === null || v === undefined) return;
                        const raw = Math.trunc(Number(v));
                        if (!Number.isFinite(raw)) return;
                        const n = Math.max(0, Math.min(10_000_000, raw));
                        setDeliverInhouseProduceByLine((prev) => ({
                          ...prev,
                          [l.id]: n,
                        }));
                      }}
                      onBlur={() => {
                        const sq = deliverShipByLine[l.id] ?? 0;
                        if (sq <= 0) return;
                        const st = l.product.stockQuantity ?? 0;
                        const def = defaultInhouseProduceQty(sq, st);
                        const cur = deliverInhouseProduceByLine[l.id] ?? def;
                        if (cur < def) {
                          message.warning(
                            inhouseProduceTooLowToShipMessage(
                              l.product.model?.trim() ||
                                l.product.customerMaterialCode?.trim() ||
                                "—",
                            ),
                          );
                        }
                      }}
                    />
                  );
                },
              },
            ]}
          />
        ) : null}
        {deliverHasInhouseBom ? (
          <div style={{ marginBottom: 16 }}>
            {deliverInhouseHints.length === 0 ? (
              <Typography.Text type="secondary" style={{ display: "block" }}>
                请填写「自加工」或「外发+自加工」商品行的本批实际出货数量后，将显示需扣减的物料明细。
              </Typography.Text>
            ) : (
              deliverInhouseHints.map((h) => (
                <div key={h.lineId} style={{ marginTop: 8 }}>
                  <Space size={6} align="center" style={{ marginBottom: 4 }}>
                    <Typography.Text strong>
                      {h.productLabel}（出货 {h.shipQty} 件，自加工完工{" "}
                      {deliverInhouseProduceByLine[h.lineId] ??
                        defaultInhouseProduceQty(
                          h.shipQty,
                          deliverDetail?.lines.find((x) => x.id === h.lineId)
                            ?.product.stockQuantity ?? 0,
                        )}{" "}
                      件）
                    </Typography.Text>
                    <HelpTip
                      text={
                        h.isHybrid ? (
                          <>
                            送货单点击<strong>完成</strong>
                            时扣减自加工物料（按本批自加工完工数）。默认完工数=出货−商品库存；外发回收库按本批自加工完工数扣减，且须≥完工数。手动完工数大于默认数时进入补产页，超出默认部分进商品库存。
                          </>
                        ) : (
                          <>
                            送货单点击<strong>完成</strong>
                            登记出货时，将按<strong>本批自加工完工</strong>
                            数量在「物料库存」扣减物料。默认完工数=本批出货−商品库存（库存≥出货时为
                            0）；手动大于默认数时进入<strong>补产入库存</strong>页确认。
                          </>
                        )
                      }
                    />
                  </Space>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 20,
                      lineHeight: 1.6,
                      listStyle: "disc",
                    }}
                  >
                    {h.rows.map((r) => (
                      <li
                        key={`${h.lineId}-${r.label}`}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          gap: 16,
                        }}
                      >
                        <span style={{ color: "#cf1322" }}>
                          扣除物料库存：{r.label}：{r.quantity} {r.unit}
                        </span>
                        <span
                          style={{
                            flexShrink: 0,
                            color: "#595959",
                            textAlign: "right",
                            whiteSpace: "nowrap",
                          }}
                        >
                          现库存 {(r as any).stockQuantity} {r.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        ) : null}
        <div style={{ marginTop: 8 }}>
          <Space size={4} style={{ marginBottom: 4 }}>
            <Typography.Text>
              <Typography.Text type="danger">*</Typography.Text> 本批交货时间
            </Typography.Text>
            <HelpTip text="整单全部交清时，该时间写入订单「实际交货时间」；分批时亦作为本批记录时间。" />
          </Space>
          <DatePicker
            showTime
            style={{ width: "100%" }}
            format="YYYY-MM-DD HH:mm"
            value={deliverAt}
            onChange={(v) => setDeliverAt(v)}
          />
        </div>
      </Modal>
    </Card>
  );
}
