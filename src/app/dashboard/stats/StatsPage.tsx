"use client";

import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Divider,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { useMeTabPermissions } from "@/lib/use-me-tab-permissions";

const STATS_MAIN_TAB_PERM: Record<string, string> = {
  stats: "tab.stats.overview",
  reconcile: "tab.stats.reconcile",
};

type DrillResponse = {
  kind: string;
  title: string;
  rangeNote: string;
  rows: Record<string, unknown>[];
};

function formatDrillCell(key: string, v: unknown): ReactNode {
  if (v == null) return "—";
  if (v === "—") return "—";
  if (typeof v === "number") {
    if (key.includes("额")) return money(v);
    return v.toLocaleString("zh-CN");
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return dayjs(v).format("YYYY-MM-DD HH:mm");
  }
  return String(v);
}

function buildDrillColumns(
  rows: Record<string, unknown>[],
): ColumnsType<Record<string, unknown>> {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]!)
    .filter((k) => k !== "id")
    .map((k) => ({
      title: k,
      dataIndex: k,
      key: k,
      ellipsis: k !== "本批件数" && k !== "备品" && k !== "外发套数" ? true : false,
      width: k.includes("时间") || k === "客户订单编号" || k === "外发单号" ? 160 : undefined,
      render: (v: unknown) => formatDrillCell(k, v),
    }));
}

type OverviewPayload = {
  range: { from: string; to: string };
  sales: {
    orderCount: number;
    orderAmount: number;
    fullDeliveredOrderCount: number;
    fullDeliveredAmount: number;
    openOrderCount: number;
  };
  purchase: { orderCount: number; orderAmount: number };
  ship: { batchCount: number; quantity: number };
  outsource: { openCount: number; createdInRange: number };
  finance: {
    totalRevenue: number;
    totalCost: number;
    totalProfit: number;
    byCustomer: {
      customerId: string;
      code: string;
      name: string;
      revenue: number;
      cost: number;
      profit: number;
    }[];
  };
  trend: {
    month: string;
    label: string;
    salesAmount: number;
    purchaseAmount: number;
    shipQuantity: number;
  }[];
  topCustomers: {
    customerId: string;
    code: string;
    name: string;
    orderAmount: number;
  }[];
};

const money = (n: number) =>
  n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type FinanceModalKind = "revenue" | "cost" | "profit" | null;

function StatisticsTab() {
  const { message } = App.useApp();
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>(() => [
    dayjs().subtract(30, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [financeModal, setFinanceModal] = useState<FinanceModalKind>(null);
  const [mainDrillOpen, setMainDrillOpen] = useState(false);
  const [mainDrill, setMainDrill] = useState<DrillResponse | null>(null);
  const [mainDrillLoading, setMainDrillLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = range[0].startOf("day").toISOString();
      const to = range[1].endOf("day").toISOString();
      const res = await fetchJson<OverviewPayload>(
        `/api/stats/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { credentials: "include" },
      );
      setData(res);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载统计失败");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [message, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const openMainDrill = useCallback(
    async (kind: string) => {
      setMainDrillOpen(true);
      setMainDrill(null);
      setMainDrillLoading(true);
      try {
        const from = range[0].startOf("day").toISOString();
        const to = range[1].endOf("day").toISOString();
        const res = await fetchJson<DrillResponse>(
          `/api/stats/drill?kind=${encodeURIComponent(kind)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          { credentials: "include" },
        );
        setMainDrill(res);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载明细失败");
        setMainDrillOpen(false);
      } finally {
        setMainDrillLoading(false);
      }
    },
    [message, range],
  );

  const mainDrillColumns = useMemo(
    () => buildDrillColumns(mainDrill?.rows ?? []),
    [mainDrill?.rows],
  );

  const trendColumns: ColumnsType<OverviewPayload["trend"][number]> = [
    { title: "月份", dataIndex: "label", width: 100 },
    {
      title: "销售订单额（建单）",
      dataIndex: "salesAmount",
      align: "right",
      render: (v: number) => money(v),
    },
    {
      title: "采购额（非取消单）",
      dataIndex: "purchaseAmount",
      align: "right",
      render: (v: number) => money(v),
    },
    {
      title: "出货件数",
      dataIndex: "shipQuantity",
      align: "right",
      render: (v: number) => (v ?? 0).toLocaleString("zh-CN"),
    },
  ];

  const topColumns: ColumnsType<OverviewPayload["topCustomers"][number]> = [
    { title: "客户代码", dataIndex: "code", width: 120, ellipsis: true },
    { title: "客户名称", dataIndex: "name", ellipsis: true },
    {
      title: "期间订单额",
      dataIndex: "orderAmount",
      width: 140,
      align: "right",
      render: (v: number) => money(v),
    },
  ];

  const financeModalRows = (() => {
    if (!data?.finance) return [];
    const rows = [...data.finance.byCustomer];
    if (financeModal === "cost") rows.sort((a, b) => b.cost - a.cost);
    else if (financeModal === "profit") rows.sort((a, b) => b.profit - a.profit);
    else rows.sort((a, b) => b.revenue - a.revenue);
    return rows;
  })();

  const financeDetailColumns: ColumnsType<
    OverviewPayload["finance"]["byCustomer"][number]
  > = [
    { title: "客户代码", dataIndex: "code", width: 120, ellipsis: true },
    { title: "客户名称", dataIndex: "name", ellipsis: true },
    {
      title:
        financeModal === "revenue" ? "销售额" : financeModal === "cost" ? "成本" : "利润",
      key: "val",
      align: "right",
      width: 160,
      render: (_, r) =>
        money(
          financeModal === "revenue"
            ? r.revenue
            : financeModal === "cost"
              ? r.cost
              : r.profit,
        ),
    },
  ];

  const financeModalTitle =
    financeModal === "revenue"
      ? "销售总金额 — 按客户明细"
      : financeModal === "cost"
        ? "总成本 — 按客户明细"
        : "利润 — 按客户明细";

  const cardHover = {
    cursor: "pointer" as const,
    transition: "box-shadow 0.2s, border-color 0.2s",
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Space wrap align="center">
        <Typography.Text>统计区间：</Typography.Text>
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => {
            if (v?.[0] && v[1]) setRange([v[0], v[1]]);
          }}
          allowClear={false}
        />
        <Typography.Text type="secondary">
          {data
            ? `已按销售单「建单时间」、采购单「建单时间」、出货按「批次时间」等汇总；当前区间 ${dayjs(
                data.range.from,
              ).format("YYYY-MM-DD")} ～ ${dayjs(data.range.to).format("YYYY-MM-DD")}。`
            : "加载后显示区间说明。"}
        </Typography.Text>
      </Space>

      {loading ? (
        <Spin tip="统计加载中" size="large">
          <div style={{ minHeight: 200 }} />
        </Spin>
      ) : !data ? (
        <Typography.Text type="secondary">暂无数据</Typography.Text>
      ) : (
        <>
          <Typography.Title level={5} style={{ margin: 0 }}>
            一、本区间（主指标）
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            点击下方任意卡片，弹出对应
            <strong>明细表</strong>
            ；外发单卡片内「当前未回收」可单独点出未回收外发单列表（全库）。
          </Typography.Paragraph>
          <Modal
            title={mainDrill?.title ?? "明细"}
            open={mainDrillOpen}
            onCancel={() => {
              setMainDrillOpen(false);
              setMainDrill(null);
            }}
            footer={null}
            width={1000}
            destroyOnHidden
          >
            {mainDrill?.rangeNote ? (
              <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                时间口径：{mainDrill.rangeNote}
              </Typography.Text>
            ) : null}
            {mainDrillLoading && !mainDrill ? (
              <Spin size="large" style={{ display: "block", margin: "32px" }} />
            ) : mainDrill && mainDrill.rows.length > 0 ? (
              <Table<Record<string, unknown>>
                size="small"
                rowKey={(r, i) => String((r as { id?: string }).id ?? i)}
                pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }}
                columns={mainDrillColumns}
                dataSource={mainDrill.rows}
                scroll={{ x: "max-content" }}
              />
            ) : mainDrill ? (
              <Typography.Text type="secondary">暂无行数据</Typography.Text>
            ) : null}
          </Modal>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Card
                size="small"
                variant="borderless"
                style={{ background: "#fafafa", border: "1px solid #f0f0f0", ...cardHover }}
                onClick={() => void openMainDrill("sales_in_range")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") void openMainDrill("sales_in_range");
                }}
              >
                <Statistic
                  title="销售订单数"
                  value={data.sales.orderCount}
                  suffix="单"
                />
                <div style={{ marginTop: 8, fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
                  订单额 {money(data.sales.orderAmount)} · 点击查看明细
                </div>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Card
                size="small"
                variant="borderless"
                style={{ background: "#fafafa", border: "1px solid #f0f0f0", ...cardHover }}
                onClick={() => void openMainDrill("sales_delivered")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") void openMainDrill("sales_delivered");
                }}
              >
                <Statistic
                  title="整单已交清"
                  value={data.sales.fullDeliveredOrderCount}
                  suffix="单"
                />
                <div style={{ marginTop: 8, fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
                  金额 {money(data.sales.fullDeliveredAmount)} · 点击查看明细
                </div>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Card
                size="small"
                variant="borderless"
                style={{ background: "#fff7e6", border: "1px solid #ffe7ba", ...cardHover }}
                onClick={() => void openMainDrill("sales_open")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") void openMainDrill("sales_open");
                }}
              >
                <Statistic
                  title="未结清销售单"
                  value={data.sales.openOrderCount}
                  suffix="单"
                />
                <div style={{ marginTop: 8, fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
                  全库未写「实际交货」的订单 · 点击查看明细
                </div>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Card
                size="small"
                variant="borderless"
                style={{ background: "#fafafa", border: "1px solid #f0f0f0", ...cardHover }}
                onClick={() => void openMainDrill("purchase_in_range")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") void openMainDrill("purchase_in_range");
                }}
              >
                <Statistic
                  title="采购单（本区间，非取消）"
                  value={data.purchase.orderCount}
                  suffix="单"
                />
                <div style={{ marginTop: 8, fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
                  采购额 {money(data.purchase.orderAmount)} · 点击查看明细
                </div>
              </Card>
            </Col>
          </Row>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Card
                size="small"
                variant="borderless"
                style={{ background: "#f6ffed", border: "1px solid #d9f7be", ...cardHover }}
                onClick={() => void openMainDrill("ship_in_range")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") void openMainDrill("ship_in_range");
                }}
              >
                <Statistic title="出货批次" value={data.ship.batchCount} suffix="次" />
                <div style={{ marginTop: 8, fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
                  本区间出货件数 {data.ship.quantity.toLocaleString("zh-CN")} · 点击查看明细
                </div>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={8} lg={6}>
              <Card
                size="small"
                variant="borderless"
                style={{ background: "#fafafa", border: "1px solid #f0f0f0", ...cardHover }}
                onClick={() => void openMainDrill("outsource_in_range")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") void openMainDrill("outsource_in_range");
                }}
              >
                <Statistic
                  title="外发单（本区间）"
                  value={data.outsource.createdInRange}
                  suffix="单"
                />
                <div
                  style={{ marginTop: 8, fontSize: 12, color: "rgba(0,0,0,0.45)" }}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  当前
                  <Typography.Link
                    onClick={() => {
                      void openMainDrill("outsource_open");
                    }}
                  >
                    未回收 {data.outsource.openCount} 单
                  </Typography.Link>
                  （全库） · 点卡片看本区建单
                </div>
              </Card>
            </Col>
          </Row>

          <Divider style={{ margin: "8px 0" }} />
          <Typography.Title level={5} style={{ margin: 0 }}>
            二、财务分析
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            按本区间内销售订单
            <strong>明细行</strong>
            汇总：销售总金额 = ∑（行单价×数量）；总成本 = 物料成本 + 加工成本。其中物料成本 = ∑（商品
            BOM 用量 × 对应物料单价）× 本行数量；加工成本 = 商品「加工成本」× 本行数量。利润 = 销售总金额 −
            总成本。点击下方卡片可查看
            <strong>各客户</strong>
            展开明细。
          </Typography.Paragraph>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={8}>
              <Card
                size="small"
                variant="borderless"
                style={{ background: "#e6f4ff", border: "1px solid #91caff", ...cardHover }}
                onClick={() => setFinanceModal("revenue")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setFinanceModal("revenue");
                }}
                styles={{ body: { padding: 16 } }}
              >
                <Statistic
                  title="销售总金额"
                  value={data.finance.totalRevenue}
                  valueStyle={{ color: "#1677ff", fontSize: 22 }}
                  formatter={(v) => (v != null && v !== "" ? money(Number(v)) : "0.00")}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: "block" }}>
                  按客户汇总 · 点击展开
                </Typography.Text>
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card
                size="small"
                variant="borderless"
                style={{ background: "#fff7e6", border: "1px solid #ffd591", ...cardHover }}
                onClick={() => setFinanceModal("cost")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setFinanceModal("cost");
                }}
                styles={{ body: { padding: 16 } }}
              >
                <Statistic
                  title="总成本"
                  value={data.finance.totalCost}
                  valueStyle={{ color: "#d46b08", fontSize: 22 }}
                  formatter={(v) => (v != null && v !== "" ? money(Number(v)) : "0.00")}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: "block" }}>
                  物料成本 + 加工成本 · 点击展开
                </Typography.Text>
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card
                size="small"
                variant="borderless"
                style={{ background: "#f6ffed", border: "1px solid #b7eb8f", ...cardHover }}
                onClick={() => setFinanceModal("profit")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setFinanceModal("profit");
                }}
                styles={{ body: { padding: 16 } }}
              >
                <Statistic
                  title="利润"
                  value={data.finance.totalProfit}
                  valueStyle={{ color: "#389e0d", fontSize: 22 }}
                  formatter={(v) => (v != null && v !== "" ? money(Number(v)) : "0.00")}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: "block" }}>
                  按客户 · 点击展开
                </Typography.Text>
              </Card>
            </Col>
          </Row>

          <Modal
            title={financeModalTitle}
            open={financeModal !== null}
            onCancel={() => setFinanceModal(null)}
            footer={null}
            width={720}
            destroyOnHidden
          >
            <Table<OverviewPayload["finance"]["byCustomer"][number]>
              size="small"
              rowKey="customerId"
              pagination={false}
              columns={financeDetailColumns}
              dataSource={financeModalRows}
              locale={{ emptyText: "无明细" }}
              summary={() => {
                if (financeModal === null || !data) return null;
                const t =
                  financeModal === "revenue"
                    ? data.finance.totalRevenue
                    : financeModal === "cost"
                      ? data.finance.totalCost
                      : data.finance.totalProfit;
                return (
                  <Table.Summary fixed>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={2} align="right">
                        <Typography.Text strong>合计</Typography.Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right">
                        <Typography.Text strong>{money(t)}</Typography.Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }}
            />
          </Modal>

          <Divider style={{ margin: "8px 0" }} />
          <Typography.Title level={5} style={{ margin: 0 }}>
            三、近 6 个自然月趋势
          </Typography.Title>
          <Table<OverviewPayload["trend"][number]>
            size="small"
            rowKey="month"
            pagination={false}
            columns={trendColumns}
            dataSource={data.trend}
            locale={{ emptyText: "无数据" }}
            scroll={{ x: 560 }}
          />

          <Typography.Title level={5} style={{ margin: "16px 0 0" }}>
            四、本区间客户订单额 TOP5
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            按所选区间内销售单「建单时间」统计各客户累计订单额。
          </Typography.Paragraph>
          <Table<OverviewPayload["topCustomers"][number]>
            size="small"
            rowKey="customerId"
            pagination={false}
            columns={topColumns}
            dataSource={data.topCustomers}
            locale={{ emptyText: "本区间无销售单" }}
          />
        </>
      )}
    </Space>
  );
}

type ReconcileMode = "whole" | "split";

type ReconcileFilterOptions = {
  suppliers: { id: string; code: string; name: string }[];
  customers: { id: string; code: string; name: string }[];
};

type PurchaseReconcileRow = {
  交货日期: string;
  采购订单号: string;
  订单数量: number;
  物料名称: string;
  部件描述: string;
  交货数量: number;
  单价: number;
  金额: number;
};

type WarehouseReconcileRow = {
  送货日期: string;
  送货单号: string;
  项目型号: string;
  订单数量: number;
  订单编号: string;
  商品型号: string;
  物料料号: string;
  单位: string;
  送货数量: number;
  单价: number;
  金额: number;
  备品数量: number;
};

function formatReconcileDate(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(iso)) return iso;
  return dayjs(iso).format("YYYY-MM-DD");
}

function purchaseReconcileRowKey(r: PurchaseReconcileRow): string {
  return [
    r.交货日期,
    r.采购订单号,
    r.物料名称,
    r.部件描述,
    r.订单数量,
    r.交货数量,
    r.单价,
    r.金额,
  ].join("|");
}

function warehouseReconcileRowKey(r: WarehouseReconcileRow): string {
  return [
    r.送货日期,
    r.送货单号,
    r.项目型号,
    r.订单数量,
    r.订单编号,
    r.商品型号,
    r.物料料号,
    r.单位,
    r.送货数量,
    r.单价,
    r.金额,
    r.备品数量,
  ].join("|");
}

function ReconcileTabContent({
  kind,
  active,
  filterOptions,
  filtersLoading,
}: {
  kind: "purchase" | "warehouse";
  active: boolean;
  filterOptions: ReconcileFilterOptions | null;
  filtersLoading: boolean;
}) {
  const { message } = App.useApp();
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>(() => [
    dayjs().startOf("month"),
    dayjs().endOf("day"),
  ]);
  const [mode, setMode] = useState<ReconcileMode>("whole");
  const [supplierId, setSupplierId] = useState<string | undefined>(undefined);
  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [purchaseRows, setPurchaseRows] = useState<PurchaseReconcileRow[]>([]);
  const [warehouseRows, setWarehouseRows] = useState<WarehouseReconcileRow[]>([]);
  const [totalAmount, setTotalAmount] = useState(0);

  const load = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const from = range[0].startOf("day").toISOString();
      const to = range[1].endOf("day").toISOString();
      if (kind === "purchase") {
        const res = await fetchJson<{
          rows: PurchaseReconcileRow[];
          totalAmount: number;
        }>("/api/stats/reconcile/purchase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ from, to, mode, supplierId: supplierId ?? null }),
        });
        setPurchaseRows(res.rows);
        setTotalAmount(res.totalAmount);
      } else {
        const res = await fetchJson<{
          rows: WarehouseReconcileRow[];
          totalAmount: number;
        }>("/api/stats/reconcile/warehouse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ from, to, mode, customerId: customerId ?? null }),
        });
        setWarehouseRows(res.rows);
        setTotalAmount(res.totalAmount);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载对帐数据失败");
      if (kind === "purchase") setPurchaseRows([]);
      else setWarehouseRows([]);
      setTotalAmount(0);
    } finally {
      setLoading(false);
    }
  }, [active, kind, message, mode, range, supplierId, customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportPurchaseExcel = useCallback(async () => {
    if (purchaseRows.length === 0) {
      message.info("无数据可导出");
      return;
    }
    const XLSX = await import("xlsx");
    const exportRows = purchaseRows.map((r) => ({
      交货日期: formatReconcileDate(r.交货日期),
      采购订单号: r.采购订单号,
      订单数量: r.订单数量,
      物料名称: r.物料名称,
      部件描述: r.部件描述,
      交货数量: r.交货数量,
      单价: r.单价,
      金额: r.金额,
    }));
    exportRows.push({
      交货日期: "合计",
      采购订单号: "",
      订单数量: "" as unknown as number,
      物料名称: "",
      部件描述: "",
      交货数量: "" as unknown as number,
      单价: "" as unknown as number,
      金额: totalAmount,
    });
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "采购对帐");
    XLSX.writeFile(wb, `采购对帐_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`);
  }, [message, purchaseRows, totalAmount]);

  const exportWarehouseExcel = useCallback(async () => {
    if (warehouseRows.length === 0) {
      message.info("无数据可导出");
      return;
    }
    const XLSX = await import("xlsx");
    const exportRows = warehouseRows.map((r) => ({
      送货日期: formatReconcileDate(r.送货日期),
      送货单号: r.送货单号,
      项目型号: r.项目型号,
      订单数量: r.订单数量,
      订单编号: r.订单编号,
      商品型号: r.商品型号,
      物料料号: r.物料料号,
      单位: r.单位,
      送货数量: r.送货数量,
      单价: r.单价,
      金额: r.金额,
      备品数量: r.备品数量,
    }));
    exportRows.push({
      送货日期: "合计",
      送货单号: "",
      项目型号: "",
      订单数量: "" as unknown as number,
      订单编号: "",
      商品型号: "",
      物料料号: "",
      单位: "",
      送货数量: "" as unknown as number,
      单价: "" as unknown as number,
      金额: totalAmount,
      备品数量: "" as unknown as number,
    });
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "出货对帐");
    XLSX.writeFile(
      wb,
      `仓库出货对帐_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`,
    );
  }, [message, totalAmount, warehouseRows]);

  const purchaseColumns: ColumnsType<PurchaseReconcileRow> = [
    {
      title: "交货日期",
      dataIndex: "交货日期",
      width: 120,
      render: (v: string) => formatReconcileDate(v),
    },
    { title: "采购订单号", dataIndex: "采购订单号", width: 150, ellipsis: true },
    {
      title: "订单数量",
      dataIndex: "订单数量",
      width: 100,
      align: "right",
    },
    { title: "物料名称", dataIndex: "物料名称", ellipsis: true },
    { title: "部件描述", dataIndex: "部件描述", width: 160, ellipsis: true },
    {
      title: "交货数量",
      dataIndex: "交货数量",
      width: 100,
      align: "right",
    },
    {
      title: "单价",
      dataIndex: "单价",
      width: 120,
      align: "right",
      render: (v: number) => money(v),
    },
    {
      title: "金额",
      dataIndex: "金额",
      width: 130,
      align: "right",
      render: (v: number) => money(v),
    },
  ];

  const warehouseColumns: ColumnsType<WarehouseReconcileRow> = [
    {
      title: "送货日期",
      dataIndex: "送货日期",
      width: 120,
      render: (v: string) => formatReconcileDate(v),
    },
    { title: "送货单号", dataIndex: "送货单号", width: 120, ellipsis: true },
    { title: "项目型号", dataIndex: "项目型号", width: 120, ellipsis: true },
    {
      title: "订单数量",
      dataIndex: "订单数量",
      width: 100,
      align: "right",
    },
    { title: "订单编号", dataIndex: "订单编号", width: 130, ellipsis: true },
    { title: "商品型号", dataIndex: "商品型号", width: 120, ellipsis: true },
    { title: "物料料号", dataIndex: "物料料号", width: 120, ellipsis: true },
    { title: "单位", dataIndex: "单位", width: 72 },
    {
      title: "送货数量",
      dataIndex: "送货数量",
      width: 100,
      align: "right",
    },
    {
      title: "单价",
      dataIndex: "单价",
      width: 120,
      align: "right",
      render: (v: number) => money(v),
    },
    {
      title: "金额",
      dataIndex: "金额",
      width: 130,
      align: "right",
      render: (v: number) => money(v),
    },
    {
      title: "备品数量",
      dataIndex: "备品数量",
      width: 90,
      align: "right",
    },
  ];

  if (!active) {
    return null;
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space wrap align="center">
        <Typography.Text>对帐区间：</Typography.Text>
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => {
            if (v?.[0] && v[1]) setRange([v[0], v[1]]);
          }}
          allowClear={false}
        />
        {kind === "purchase" ? (
          <Space size="small" align="center">
            <Typography.Text>供应商</Typography.Text>
            <Select
              allowClear
              showSearch
              placeholder="全部"
              optionFilterProp="label"
              loading={filtersLoading}
              value={supplierId}
              onChange={(v) => setSupplierId(v)}
              options={(filterOptions?.suppliers ?? []).map((s) => ({
                value: s.id,
                label: `${s.code} ${s.name}`.trim(),
              }))}
              style={{ minWidth: 220 }}
            />
          </Space>
        ) : (
          <Space size="small" align="center">
            <Typography.Text>客户名称</Typography.Text>
            <Select
              allowClear
              showSearch
              placeholder="全部"
              optionFilterProp="label"
              loading={filtersLoading}
              value={customerId}
              onChange={(v) => setCustomerId(v)}
              options={(filterOptions?.customers ?? []).map((c) => ({
                value: c.id,
                label: `${c.code} ${c.name}`.trim(),
              }))}
              style={{ minWidth: 220 }}
            />
          </Space>
        )}
        <Radio.Group
          value={mode}
          onChange={(e) => setMode(e.target.value as ReconcileMode)}
          optionType="button"
          buttonStyle="solid"
        >
          <Radio.Button value="whole">整单对帐</Radio.Button>
          <Radio.Button value="split">分单对帐</Radio.Button>
        </Radio.Group>
        <Button
          type="primary"
          onClick={() => void load()}
        >
          重新查询
        </Button>
        <Button
          onClick={() =>
            void (kind === "purchase" ? exportPurchaseExcel() : exportWarehouseExcel())
          }
        >
          导出 Excel
        </Button>
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
        {kind === "purchase" ? (
          <>
            以<strong>实收料时间</strong>（物料入库时间）为口径。
            <strong>整单对帐</strong>
            仅列本区间内已整单收料确认的采购明细（未在区间内交完的订单不列入，顺延至交清后期间）；
            <strong>分单对帐</strong>
            则凡落在区间内的每笔收料各列一行。默认整单对帐。可选供应商筛选本页数据。
          </>
        ) : (
          <>
            以<strong>实际出货时间</strong>（批次出货时间）为口径。
            <strong>整单对帐</strong>
            只统计「销售整单在区间内已交清」的出货批次；区间内未交完的客户单不列入，顺延至交清后。
            <strong>分单对帐</strong>
            则区间内每批出货各列一行。默认整单对帐。可选客户筛选本页数据。
          </>
        )}
      </Typography.Paragraph>
      {kind === "purchase" ? (
        <Spin spinning={loading}>
          <Table<PurchaseReconcileRow>
            size="small"
            rowKey={purchaseReconcileRowKey}
            columns={purchaseColumns}
            dataSource={purchaseRows}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            scroll={{ x: 1100 }}
            locale={{ emptyText: "暂无对帐行" }}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={7} align="right">
                    <Typography.Text strong>金额合计</Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={7} align="right">
                    <Typography.Text strong>{money(totalAmount)}</Typography.Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
        </Spin>
      ) : (
        <Spin spinning={loading}>
          <Table<WarehouseReconcileRow>
            size="small"
            rowKey={warehouseReconcileRowKey}
            columns={warehouseColumns}
            dataSource={warehouseRows}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            scroll={{ x: 1300 }}
            locale={{ emptyText: "暂无对帐行" }}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={10} align="right">
                    <Typography.Text strong>金额合计</Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={10} align="right">
                    <Typography.Text strong>{money(totalAmount)}</Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={11} />
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
        </Spin>
      )}
    </Space>
  );
}

function ReconcileTab({ active }: { active: boolean }) {
  const { message: msgApp } = App.useApp();
  const [subKey, setSubKey] = useState<"purchase" | "warehouse">("purchase");
  const [filterOptions, setFilterOptions] = useState<ReconcileFilterOptions | null>(null);
  const [filtersLoading, setFiltersLoading] = useState(false);

  useEffect(() => {
    if (!active) return;
    setFiltersLoading(true);
    void fetchJson<ReconcileFilterOptions>("/api/stats/reconcile/filters", { credentials: "include" })
      .then(setFilterOptions)
      .catch((e) => {
        msgApp.error(e instanceof Error ? e.message : "加载筛选项失败");
        setFilterOptions({ suppliers: [], customers: [] });
      })
      .finally(() => setFiltersLoading(false));
  }, [active, msgApp]);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Tabs
        size="small"
        activeKey={subKey}
        onChange={(k) => setSubKey(k as "purchase" | "warehouse")}
        items={[
          {
            key: "purchase",
            label: "采购对帐（与供应商）",
            children: (
              <ReconcileTabContent
                kind="purchase"
                active={active && subKey === "purchase"}
                filterOptions={filterOptions}
                filtersLoading={filtersLoading}
              />
            ),
          },
          {
            key: "warehouse",
            label: "仓库出货对帐（与客户）",
            children: (
              <ReconcileTabContent
                kind="warehouse"
                active={active && subKey === "warehouse"}
                filterOptions={filterOptions}
                filtersLoading={filtersLoading}
              />
            ),
          },
        ]}
      />
    </Space>
  );
}

export function StatsPage() {
  const searchParams = useSearchParams();
  const [mainTab, setMainTab] = useState(
    () => (searchParams.get("tab") === "reconcile" ? "reconcile" : "stats"),
  );
  useEffect(() => {
    setMainTab(searchParams.get("tab") === "reconcile" ? "reconcile" : "stats");
  }, [searchParams]);

  const { loading: tabPermLoading, allowed } = useMeTabPermissions();

  const visibleStatsMainKeys = useMemo(
    () =>
      (["stats", "reconcile"] as const).filter((k) =>
        allowed([STATS_MAIN_TAB_PERM[k]]),
      ),
    [allowed],
  );

  useEffect(() => {
    if (tabPermLoading) return;
    if (visibleStatsMainKeys.length === 0) return;
    const keys = visibleStatsMainKeys as readonly string[];
    if (!keys.includes(mainTab)) {
      setMainTab((keys[0] as "stats" | "reconcile") ?? "stats");
    }
  }, [tabPermLoading, visibleStatsMainKeys, mainTab]);

  return (
    <Card title="统计与对帐" styles={{ body: { paddingTop: 8 } }}>
      {tabPermLoading ? (
        <div style={{ padding: 56, textAlign: "center" }}>
          <Spin size="large" />
        </div>
      ) : visibleStatsMainKeys.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          当前账号无可用的统计与对帐 TAB，请联系管理员在「员工管理 → 权限管理」中勾选对应 TAB。
        </Typography.Paragraph>
      ) : (
        <Tabs
          activeKey={mainTab}
          onChange={setMainTab}
          items={[
            {
              key: "stats",
              label: "统计",
              children: <StatisticsTab />,
            },
            {
              key: "reconcile",
              label: "对帐",
              children: <ReconcileTab active={mainTab === "reconcile"} />,
            },
          ].filter((item) => {
            const code = STATS_MAIN_TAB_PERM[String(item.key)];
            return code ? allowed([code]) : false;
          })}
        />
      )}
    </Card>
  );
}
