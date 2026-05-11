"use client";

import {
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Spin,
  Table,
  Tabs,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { useMeTabPermissions } from "@/lib/use-me-tab-permissions";
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
    /** 商品当前库存（成品入库累计） */
    stockQuantity?: number;
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
  const [deliverForm] = Form.useForm<{ at: dayjs.Dayjs }>();

  const [queryForm] = Form.useForm<{
    keyword?: string;
    deliveredRange?: [dayjs.Dayjs, dayjs.Dayjs];
  }>();

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
    const v = (await queryForm.validateFields().catch(() => ({}))) as {
      keyword?: string;
      deliveredRange?: [dayjs.Dayjs, dayjs.Dayjs];
    };
    setLoadingDelivered(true);
    try {
      const qs = buildQuery("delivered", {
        keyword: v.keyword,
        deliveredRange: v.deliveredRange,
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
  }, [message, queryForm]);

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
      setDeliverOpen(true);
      setDeliverFetchLoading(true);
      deliverForm.setFieldsValue({ at: dayjs() });
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
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载订单失败");
        setDeliverOpen(false);
        setDeliverOrderId(null);
      } finally {
        setDeliverFetchLoading(false);
      }
    },
    [deliverForm, message],
  );

  const submitDeliver = useCallback(async () => {
    if (!deliverOrderId || !deliverDetail) return;
    let at: dayjs.Dayjs;
    try {
      at = (await deliverForm.validateFields()).at;
    } catch {
      return;
    }
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
    try {
      const pre = await fetchJson<{ needsInhouseStep: boolean }>(
        `/api/warehouse/sales-orders/${deliverOrderId}/deliver-preview`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines }),
        },
      );
      const draft: WarehouseDeliveryDraft = {
        orderId: deliverOrderId,
        actualDeliveredAt: at.toISOString(),
        lines,
      };
      sessionStorage.setItem(WAREHOUSE_DELIVERY_DRAFT_KEY, JSON.stringify(draft));
      setDeliverOpen(false);
      setDeliverOrderId(null);
      setDeliverDetail(null);
      setDeliverShipByLine({});
      if (pre.needsInhouseStep) {
        router.push("/dashboard/warehouse/delivery-inhouse");
      } else {
        router.push("/dashboard/warehouse/delivery-note");
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "出货预检失败");
    }
  }, [deliverOrderId, deliverDetail, deliverShipByLine, deliverForm, message, router]);

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
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  以下为尚未交清的销售订单。点<strong>确认出货</strong>后，在弹窗中填写<strong>本批实际出货</strong>（可超过待交/订单行数量）。自加工且成品不足时先<strong>补产入库存</strong>，再进<strong>送货单打印</strong>。送货单上仅可添加备品/备注。点送货单<strong>完成</strong>后登记库存；全部交清后写入
                  <strong>实际交货时间</strong>。
                </Typography.Paragraph>
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
            forceRender: true,
            children: (
              <Space direction="vertical" style={{ width: "100%" }} size="middle">
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  按<strong>整单实际交货</strong>或<strong>分批出货时间</strong>区间与关键字查询：含已交清单、仅分批出货且<strong>整单未结</strong>的订单。未结订单备注列会标注「订单未交完」。
                </Typography.Paragraph>
                <Form
                  form={queryForm}
                  layout="inline"
                  style={{ rowGap: 12 }}
                  initialValues={{
                    deliveredRange: [dayjs().subtract(30, "day"), dayjs()],
                  }}
                >
                  <Form.Item name="keyword" label="关键字">
                    <Input
                      allowClear
                      placeholder="订单号 / 机型 / 客户名称或编号"
                      style={{ width: 240 }}
                    />
                  </Form.Item>
                  <Form.Item
                    name="deliveredRange"
                    label="交货日期"
                    tooltip="含整单已交清订单的「实际交货时间」；及仅分批出货订单中落在区间内的任一批次时间。"
                  >
                    <DatePicker.RangePicker />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" onClick={() => void runDeliveredQuery()}>
                      查询
                    </Button>
                  </Form.Item>
                  <Form.Item>
                    <Button
                      onClick={() => {
                        setDeliveredSelectMode((v) => !v);
                        setSelectedDeliveredIds([]);
                      }}
                    >
                      {deliveredSelectMode ? "取消选择" : "选择"}
                    </Button>
                  </Form.Item>
                  {deliveredSelectMode ? (
                    <Form.Item>
                      <Button
                        danger
                        type="primary"
                        onClick={() => void voidSelectedDelivered()}
                        disabled={selectedDeliveredIds.length === 0}
                        loading={voidingDelivered}
                      >
                        作废
                      </Button>
                    </Form.Item>
                  ) : null}
                </Form>
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
        title={`确认出货 — ${deliverOrderLabel}`}
        open={deliverOpen}
        onCancel={() => {
          setDeliverOpen(false);
          setDeliverOrderId(null);
          setDeliverDetail(null);
          setDeliverShipByLine({});
        }}
        okText="下一步"
        onOk={() => void submitDeliver()}
        width={960}
        destroyOnHidden
        forceRender
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          请在此填写每行<strong>本批实际要出货</strong>数量（默认等于待交，可少填分批，也可<strong>大于待交/订单行数量</strong>以多发）。若自加工行成品不足，下一步将进入<strong>补产入库存</strong>。打印送货单上仅展示本处数量，不再改数；备品/附加备注在送货单页添加。点送货单<strong>完成</strong>后登记库存。
        </Typography.Paragraph>
        {deliverFetchLoading ? (
          <Spin />
        ) : deliverDetail ? (
          <Table<DetailLine>
            size="small"
            rowKey="id"
            pagination={false}
            style={{ marginBottom: 16 }}
            dataSource={deliverDetail.lines}
            scroll={{ x: "max-content" }}
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
                title: "商品库存数量",
                key: "stockQuantity",
                width: 108,
                align: "right",
                render: (_, l) => {
                  const q = l.product.stockQuantity;
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
                width: 140,
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
                    }}
                  />
                ),
              },
            ]}
          />
        ) : null}
        <Form form={deliverForm} layout="vertical">
          <Form.Item
            name="at"
            label="本批交货时间"
            rules={[{ required: true, message: "请选择时间" }]}
            tooltip="整单全部交清时，该时间写入订单「实际交货时间」；分批时亦作为本批记录时间。"
          >
            <DatePicker showTime style={{ width: "100%" }} format="YYYY-MM-DD HH:mm" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
