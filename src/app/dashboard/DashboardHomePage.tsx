"use client";

import { SettingOutlined } from "@ant-design/icons";
import { App, Button, Col, ConfigProvider, Row, Space, Spin, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkbenchSettingsModal } from "@/app/dashboard/WorkbenchSettingsModal";
import { ROW_BACKGROUND } from "@/lib/dashboard-urgency";
import { fetchJson } from "@/lib/fetch-json";
import { defaultWorkbenchSettings } from "@/lib/workbench-settings";
import type { WorkbenchStateFromApi } from "@/app/dashboard/WorkbenchSettingsModal";

type Me = {
  name: string;
  loginName: string;
  isAdmin: boolean;
  permissions: string[]; // 含 tab.workbench 等
};

type HomePayload = {
  salesDeliveries: {
    rows: {
      id: string;
      customerOrderNo: string;
      customerModel: string;
      customerName: string;
      deliveryDueAt: string;
      daysUntil: number;
      urgency: "deepRed" | "lightRed" | "yellow" | "blue";
    }[];
  } | null;
  needPurchase: {
    rows: {
      id: string;
      customerOrderNo: string;
      customerModel: string;
      customerName: string;
      deliveryDueAt: string | null;
      lineCount: number;
      createdAt: string;
      unlinkedFromPurchase: boolean;
    }[];
    count: number;
    unlinkedCount: number;
  } | null;
  purchaseSummary: {
    openOrderCount: number;
    partialLineNotFullCount: number;
    waitSalesPurchaseOrderCount: number;
    waitSalesUnlinkedFromPurchaseCount: number;
  } | null;
  purchasePendingReceive: {
    rows: {
      id: string;
      orderNo: string;
      supplierName: string;
      deliveryDueAt: string | null;
      daysUntil: number | null;
      urgency: "deepRed" | "lightRed" | "yellow" | "blue" | "gray";
    }[];
    count: number;
  } | null;
  outsourceUnrecovered: {
    rows: {
      id: string;
      orderNo: string;
      productModel: string;
      supplierName: string;
      productQty: number;
      createdAt: string;
    }[];
    count: number;
  } | null;
  needOutsourceRows: {
    count: number;
    sampleRows: {
      id: string;
      salesOrderId: string;
      customerOrderNo: string;
      customerName: string;
      productModel: string;
      quantity: number;
      quantityShipped: number;
      processingMode: "OUTSOURCE" | "OUTSOURCE_INHOUSE";
      unmetByStock: number;
      productOnHand: number;
    }[];
  } | null;
  sampleReminders: {
    rows: {
      id: string;
      customerName: string;
      model: string;
      quantity: number;
      sampleDueAt: string;
      daysUntil: number;
      urgency: "deepRed" | "lightRed" | "yellow" | "blue";
    }[];
    count: number;
  } | null;
  productStockAlerts: {
    rows: {
      id: string;
      customerName: string;
      customerMaterialCode: string;
      model: string;
      totalQty: number;
      safetyStock: number | null;
      maxStock: number | null;
      alertType: "LOW" | "HIGH";
    }[];
    count: number;
  } | null;
  materialStockAlerts: {
    rows: {
      id: string;
      code: string;
      name: string;
      totalQty: number;
      safetyStock: number | null;
      maxStock: number | null;
      alertType: "LOW" | "HIGH";
    }[];
    count: number;
  } | null;
  reconcileReminders?: {
    supplier: { show: true; message: string; link: string } | null;
    customer: { show: true; message: string; link: string } | null;
    other: { show: true; message: string; link: string } | null;
  };
  workbench?: WorkbenchStateFromApi;
};

/** antd Table small 表头高度约值，用于 scroll.y = 容器高度 − 表头 */
const TABLE_HEAD_APPROX = 39;

const cardShell: React.CSSProperties = {
  height: "100%",
  background: "#fff",
  border: "1px solid #f0f0f0",
  borderRadius: 8,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  minHeight: 268,
};

function dayLabel(days: number) {
  if (days < 0) return `已逾期 ${-days} 天`;
  if (days === 0) return "今天";
  return `还有 ${days} 天`;
}

function useDashboardTableScrollY(enabled: boolean, rowTick: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(200);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const h = el.clientHeight;
      setScrollY(Math.max(88, Math.floor(h - TABLE_HEAD_APPROX)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, rowTick]);

  return { ref, scrollY };
}

const dashboardTableWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  marginBottom: 4,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

export function DashboardHomePage() {
  const { message } = App.useApp();
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<HomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ackLoading, setAckLoading] = useState<"supplier" | "customer" | "other" | null>(null);

  const baseDate = useMemo(() => dayjs().format("YYYY-MM-DD"), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, h] = await Promise.all([
        fetchJson<Me>("/api/me", { credentials: "include" }),
        fetchJson<HomePayload>("/api/dashboard/home", { credentials: "include" }),
      ]);
      setMe(m);
      setData(h);
    } catch {
      setMe(null);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onReconcileAck = useCallback(
    async (t: "supplier" | "customer" | "other") => {
      setAckLoading(t);
      try {
        await fetchJson("/api/me/reconcile-ack", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: t }),
        });
        message.success("已记录：本对帐提醒在本月内不再显示");
        await load();
      } catch (e) {
        message.error(e instanceof Error ? e.message : "操作失败");
      } finally {
        setAckLoading(null);
      }
    },
    [load, message],
  );

  const salesColumns: ColumnsType<NonNullable<HomePayload["salesDeliveries"]>["rows"][number]> = useMemo(
    () => [
      {
        title: "约定交货日",
        dataIndex: "deliveryDueAt",
        width: 108,
        render: (v: string) => dayjs(v).format("MM-DD"),
      },
      { title: "客户订单号", dataIndex: "customerOrderNo", width: 120, ellipsis: true },
      { title: "项目型号", dataIndex: "customerModel", width: 100, ellipsis: true },
      { title: "客户", dataIndex: "customerName", ellipsis: true },
      {
        title: "交期",
        key: "du",
        width: 100,
        render: (_, r) => dayLabel(r.daysUntil),
      },
    ],
    [],
  );

  const poColumns: ColumnsType<NonNullable<HomePayload["purchasePendingReceive"]>["rows"][number]> = useMemo(
    () => [
      { title: "采购单号", dataIndex: "orderNo", width: 128, ellipsis: true },
      { title: "供应商", dataIndex: "supplierName", ellipsis: true },
      {
        title: "要求交期",
        dataIndex: "deliveryDueAt",
        width: 88,
        render: (v: string | null) => (v ? dayjs(v).format("MM-DD") : "—"),
      },
      {
        title: "距交期",
        key: "d",
        width: 80,
        render: (_, r) => (r.daysUntil != null ? dayLabel(r.daysUntil) : "—"),
      },
    ],
    [],
  );

  const outColumns: ColumnsType<NonNullable<HomePayload["outsourceUnrecovered"]>["rows"][number]> = useMemo(
    () => [
      { title: "外发单号", dataIndex: "orderNo", width: 120, ellipsis: true },
      { title: "型号", dataIndex: "productModel", width: 100, ellipsis: true },
      { title: "外协方", dataIndex: "supplierName", width: 100, ellipsis: true },
      { title: "套数", dataIndex: "productQty", width: 48, align: "right" },
    ],
    [],
  );

  const needPurchaseColumns: ColumnsType<
    NonNullable<HomePayload["needPurchase"]>["rows"][number]
  > = useMemo(
    () => [
      {
        title: "采购关联",
        key: "link",
        width: 88,
        render: (_, r) =>
          r.unlinkedFromPurchase ? (
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              未建
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              已建待跟进
            </Typography.Text>
          ),
      },
      { title: "客户订单号", dataIndex: "customerOrderNo", width: 112, ellipsis: true },
      { title: "项目型号", dataIndex: "customerModel", width: 88, ellipsis: true },
      { title: "客户", dataIndex: "customerName", ellipsis: true },
      {
        title: "约定交期",
        dataIndex: "deliveryDueAt",
        width: 72,
        render: (v: string | null) => (v ? dayjs(v).format("MM-DD") : "—"),
      },
      { title: "行数", dataIndex: "lineCount", width: 44, align: "right" },
    ],
    [],
  );

  const outsourceLineColumns: ColumnsType<
    NonNullable<HomePayload["needOutsourceRows"]>["sampleRows"][number]
  > = useMemo(
    () => [
      {
        title: "加工",
        dataIndex: "processingMode",
        width: 80,
        render: (m: "OUTSOURCE" | "OUTSOURCE_INHOUSE") =>
          m === "OUTSOURCE" ? "外发" : "外发+自加工",
      },
      { title: "客户订单号", dataIndex: "customerOrderNo", width: 100, ellipsis: true },
      { title: "型号", dataIndex: "productModel", width: 80, ellipsis: true },
      { title: "客户", dataIndex: "customerName", width: 72, ellipsis: true },
      {
        title: "库存",
        dataIndex: "productOnHand",
        width: 52,
        align: "right",
        render: (n: number) => n,
      },
      { title: "订/出", key: "q", width: 64, align: "right", render: (_, r) => `${r.quantityShipped}/${r.quantity}` },
      {
        title: "缺口",
        dataIndex: "unmetByStock",
        width: 52,
        align: "right",
        render: (n: number) => <Typography.Text type="warning">{n}</Typography.Text>,
      },
    ],
    [],
  );

  const sampleColumns: ColumnsType<
    NonNullable<HomePayload["sampleReminders"]>["rows"][number]
  > = useMemo(
    () => [
      {
        title: "交样日",
        dataIndex: "sampleDueAt",
        width: 80,
        render: (v: string) => dayjs(v).format("MM-DD"),
      },
      { title: "客户", dataIndex: "customerName", width: 90, ellipsis: true },
      { title: "型号", dataIndex: "model", ellipsis: true },
      { title: "数量", dataIndex: "quantity", width: 52, align: "right" },
      {
        title: "交期",
        key: "due",
        width: 100,
        render: (_, r) => dayLabel(r.daysUntil),
      },
    ],
    [],
  );

  const productStockAlertColumns: ColumnsType<
    NonNullable<HomePayload["productStockAlerts"]>["rows"][number]
  > = useMemo(
    () => [
      { title: "客户", dataIndex: "customerName", width: 90, ellipsis: true },
      { title: "物料编号", dataIndex: "customerMaterialCode", width: 100, ellipsis: true },
      { title: "型号", dataIndex: "model", width: 88, ellipsis: true },
      { title: "库存", dataIndex: "totalQty", width: 56, align: "right" },
      {
        title: "阈值",
        key: "limit",
        width: 90,
        render: (_, r) =>
          r.alertType === "LOW" ? `安全 ${r.safetyStock ?? "—"}` : `最大 ${r.maxStock ?? "—"}`,
      },
      {
        title: "状态",
        dataIndex: "alertType",
        width: 60,
        render: (t: "LOW" | "HIGH") =>
          t === "LOW" ? (
            <Typography.Text type="danger">不足</Typography.Text>
          ) : (
            <Typography.Text style={{ color: "#389e0d" }}>超储</Typography.Text>
          ),
      },
    ],
    [],
  );

  const materialStockAlertColumns: ColumnsType<
    NonNullable<HomePayload["materialStockAlerts"]>["rows"][number]
  > = useMemo(
    () => [
      { title: "物料编号", dataIndex: "code", width: 110, ellipsis: true },
      { title: "名称", dataIndex: "name", width: 110, ellipsis: true },
      { title: "库存", dataIndex: "totalQty", width: 56, align: "right" },
      {
        title: "阈值",
        key: "limit",
        width: 90,
        render: (_, r) =>
          r.alertType === "LOW" ? `安全 ${r.safetyStock ?? "—"}` : `最大 ${r.maxStock ?? "—"}`,
      },
      {
        title: "状态",
        dataIndex: "alertType",
        width: 60,
        render: (t: "LOW" | "HIGH") =>
          t === "LOW" ? (
            <Typography.Text type="danger">不足</Typography.Text>
          ) : (
            <Typography.Text style={{ color: "#389e0d" }}>超储</Typography.Text>
          ),
      },
    ],
    [],
  );

  const wb = useMemo((): WorkbenchStateFromApi => {
    const d = defaultWorkbenchSettings();
    if (!data?.workbench) return d;
    return { ...d, ...data.workbench };
  }, [data]);
  const rowBg = ROW_BACKGROUND;
  const salesUrgencyNote = useMemo(() => {
    const u = wb.urgentRedMaxDays;
    const l = wb.lightRedMaxDays;
    const y = wb.yellowMaxDays;
    return `已按销售订单头「约定交货日」由近到远（未交清，不含已取消订单）。行固定底色：深红=距交期≤${u}天（含已逾期），浅红=${u + 1}～${l}，黄=${
      l + 1
    }～${y}，蓝=≥${y + 1} 天。`;
  }, [wb.urgentRedMaxDays, wb.lightRedMaxDays, wb.yellowMaxDays]);

  const salesTableScroll = useDashboardTableScrollY(
    !loading && data?.salesDeliveries != null,
    data?.salesDeliveries?.rows?.length ?? 0,
  );
  const needPurchaseTableScroll = useDashboardTableScrollY(
    !loading && data?.purchaseSummary != null,
    data?.needPurchase?.rows?.length ?? 0,
  );
  const receiveTableScroll = useDashboardTableScrollY(
    !loading && data?.purchasePendingReceive != null,
    data?.purchasePendingReceive?.rows?.length ?? 0,
  );
  const outsourceTableScroll = useDashboardTableScrollY(
    !loading && data?.needOutsourceRows != null,
    data?.needOutsourceRows?.sampleRows?.length ?? 0,
  );
  const recoverOutTableScroll = useDashboardTableScrollY(
    !loading && data?.outsourceUnrecovered != null,
    data?.outsourceUnrecovered?.rows?.length ?? 0,
  );
  const sampleTableScroll = useDashboardTableScrollY(
    !loading && data?.sampleReminders != null,
    data?.sampleReminders?.rows?.length ?? 0,
  );
  const productStockAlertTableScroll = useDashboardTableScrollY(
    !loading && data?.productStockAlerts != null,
    data?.productStockAlerts?.rows?.length ?? 0,
  );
  const materialStockAlertTableScroll = useDashboardTableScrollY(
    !loading && data?.materialStockAlerts != null,
    data?.materialStockAlerts?.rows?.length ?? 0,
  );

  if (loading) {
    return (
      <div style={{ padding: 80, textAlign: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!data) {
    return (
      <Typography.Text type="secondary">无法加载工作台，请刷新重试。</Typography.Text>
    );
  }

  const sRows = data.salesDeliveries?.rows ?? [];
  const hasSales = data.salesDeliveries != null;
  const hasPurchase = data.purchaseSummary != null;
  const hasReceive = data.purchasePendingReceive != null;
  const hasOut = data.needOutsourceRows != null;
  const hasRecoverOut = data.outsourceUnrecovered != null;
  const hasSamples = data.sampleReminders != null;
  const hasProductStockAlerts = data.productStockAlerts != null;
  const hasMaterialStockAlerts = data.materialStockAlerts != null;
  const rec = data.reconcileReminders;
  const hasReconcileBanner =
    !!rec &&
    (rec.supplier != null || rec.customer != null || rec.other != null);
  const canStats = me?.permissions?.includes("stats.view") ?? false;
  const canOutsourceNav = me?.permissions?.includes("outsource.view") ?? false;
  /** 首页工作台齿轮：仅系统管理员可见，与业务角色无关 */
  const canEditGlobalWorkbench = Boolean(me?.isAdmin);

  const anyBlock =
    hasSales ||
    hasPurchase ||
    hasReceive ||
    hasOut ||
    hasRecoverOut ||
    hasSamples ||
    hasProductStockAlerts ||
    hasMaterialStockAlerts ||
    hasReconcileBanner ||
    canStats;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 0,
          marginBottom: 4,
        }}
      >
        <Typography.Title level={3} style={{ margin: 0 }}>
          工作台
        </Typography.Title>
        {canEditGlobalWorkbench ? (
          <Button
            type="text"
            icon={<SettingOutlined style={{ fontSize: 20 }} />}
            onClick={() => setSettingsOpen(true)}
            aria-label="工作台设置（全系统）"
            title="工作台设置（全系统，所有员工共用交期色阶等）"
          />
        ) : null}
      </div>
      {me && (
        <Typography.Text type="secondary" style={{ display: "block", marginBottom: 20 }}>
          当前登录用户：{me.name}（{me.loginName}）
          {me.isAdmin ? " · 系统管理员" : ""}
        </Typography.Text>
      )}

      {!anyBlock ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          当前账号下暂无可展示的业务提醒，请从左侧菜单进入有权限的模块。
        </Typography.Paragraph>
      ) : null}

      {hasReconcileBanner ? (
        <div style={{ marginBottom: 12 }}>
          {(
            [
              { key: "supplier" as const, v: rec?.supplier },
              { key: "customer" as const, v: rec?.customer },
              { key: "other" as const, v: rec?.other },
            ] as const
          ).map((row) =>
            row.v ? (
              <div
                key={row.key}
                style={{
                  marginBottom: 6,
                  color: "#cf1322",
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              >
                {row.v.message}
                <Link
                  href={row.v.link}
                  style={{
                    marginLeft: 8,
                    color: "#cf1322",
                    textDecoration: "underline",
                  }}
                >
                  打开统计与对帐（对帐）
                </Link>
                <Button
                  size="small"
                  type="primary"
                  loading={ackLoading === row.key}
                  onClick={() => void onReconcileAck(row.key)}
                  style={{ marginLeft: 8, verticalAlign: "middle" }}
                >
                  完成
                </Button>
              </div>
            ) : null,
          )}
        </div>
      ) : null}

      <ConfigProvider
        theme={{
          components: { Table: { cellPaddingBlock: 4, cellPaddingInline: 8, headerBg: "#fafafa" } },
        }}
      >
        <Row gutter={[16, 16]}>
          {hasSales && (
            <Col xs={24} sm={12} lg={8}>
              <div style={cardShell}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <Typography.Title level={5} style={{ margin: 0, fontSize: 16 }}>
                    销售提醒 · 交付
                  </Typography.Title>
                  <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    基准日（北京时间）{baseDate}
                  </Typography.Text>
                </div>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  {salesUrgencyNote}
                </Typography.Paragraph>
                <div ref={salesTableScroll.ref} style={dashboardTableWrapStyle}>
                  {sRows.length === 0 ? (
                    <Typography.Text type="secondary">暂无逾期或交期临近的未交单。</Typography.Text>
                  ) : (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={sRows.slice(0, 8)}
                      columns={salesColumns}
                      pagination={false}
                      scroll={{ y: salesTableScroll.scrollY, x: 480 }}
                      onRow={(r) => ({ style: { background: rowBg[r.urgency] } })}
                    />
                  )}
                </div>
                <Link href="/dashboard/warehouse" style={{ fontSize: 13, flexShrink: 0, marginTop: 0 }}>
                  前往仓库出货
                </Link>
              </div>
            </Col>
          )}

          {hasPurchase && data.purchaseSummary && (
            <Col xs={24} sm={12} lg={8}>
              <div style={{ ...cardShell, minHeight: 400 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <Typography.Title level={5} style={{ margin: 0, fontSize: 16 }}>
                    采购提醒
                  </Typography.Title>
                  <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    基准日（北京时间）{baseDate}
                  </Typography.Text>
                </div>
                <Typography.Paragraph style={{ fontSize: 13, marginBottom: 6 }}>
                  在办采购单（未结案且未取消）共{" "}
                  <strong>{data.purchaseSummary.openOrderCount}</strong> 张；明细中仍有未收满行数{" "}
                  <strong>{data.purchaseSummary.partialLineNotFullCount}</strong> 条。
                </Typography.Paragraph>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  待从销售下采购或跟进的客户订单共{" "}
                  <strong>{data.purchaseSummary.waitSalesPurchaseOrderCount}</strong> 单，其中
                  <strong> 尚未从本单建立关联采购单</strong>的{" "}
                  <strong>{data.purchaseSummary.waitSalesUnlinkedFromPurchaseCount}</strong>{" "}
                  单（新建销售单默认在此，直至下推采购或标为无需采购）。已建单待向供应商收料见「收料提醒」。
                </Typography.Paragraph>
                <div ref={needPurchaseTableScroll.ref} style={dashboardTableWrapStyle}>
                  {data.needPurchase && data.needPurchase.rows.length > 0 ? (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={data.needPurchase.rows.slice(0, 8)}
                      columns={needPurchaseColumns}
                      pagination={false}
                      scroll={{ y: needPurchaseTableScroll.scrollY, x: 520 }}
                      onRow={(r) =>
                        r.unlinkedFromPurchase ? { style: { background: "#fffbe6" } } : {}
                      }
                    />
                  ) : (
                    <Typography.Text type="secondary">暂无待跟进的销售订单。</Typography.Text>
                  )}
                </div>
                <Link href="/dashboard/purchase" style={{ fontSize: 13, flexShrink: 0, marginTop: 0 }}>
                  前往采购订单
                </Link>
              </div>
            </Col>
          )}

          {hasReceive && data.purchasePendingReceive && (
            <Col xs={24} sm={12} lg={8}>
              <div style={cardShell}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <Typography.Title level={5} style={{ margin: 0, fontSize: 16 }}>
                    收料提醒
                  </Typography.Title>
                  <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    基准日（北京时间）{baseDate}
                  </Typography.Text>
                </div>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  待收料采购单共 <strong>{data.purchasePendingReceive.count}</strong> 张。按「要求交期」由近到远排列；行底色同销售/采购四档+灰，请在采购单中点「确定收料」办理入库。
                </Typography.Paragraph>
                <div ref={receiveTableScroll.ref} style={dashboardTableWrapStyle}>
                  {data.purchasePendingReceive.rows.length === 0 ? (
                    <Typography.Text type="secondary">暂无待收料采购单。</Typography.Text>
                  ) : (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={data.purchasePendingReceive.rows.slice(0, 8)}
                      columns={poColumns}
                      pagination={false}
                      scroll={{ y: receiveTableScroll.scrollY, x: 400 }}
                      onRow={(r) => ({ style: { background: rowBg[r.urgency] } })}
                    />
                  )}
                </div>
                <Link href="/dashboard/purchase" style={{ fontSize: 13, flexShrink: 0, marginTop: 0 }}>
                  前往采购订单（未交采购订单 · 收料）
                </Link>
              </div>
            </Col>
          )}

          {hasOut && data.needOutsourceRows && (
            <Col xs={24} sm={12} lg={8}>
              <div style={{ ...cardShell, minHeight: 400 }}>
                <Typography.Title level={5} style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>
                  外发提醒
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  在<strong>商品成品库存</strong>（入库累计，与出货预检相同）下，对同一商品先满足
                  <strong>待交数量较少</strong>的订单、同量则<strong>建单较早</strong>的优先；库存仍不能覆盖的
                  <strong>外发/外发+自加工</strong>行需外发跟进。当前共 <strong>
                    {data.needOutsourceRows.count}
                  </strong>{" "}
                  行有缺口。未回收的外发加工单见「回收外发提醒」。
                </Typography.Paragraph>
                <div ref={outsourceTableScroll.ref} style={dashboardTableWrapStyle}>
                  {data.needOutsourceRows.sampleRows.length > 0 ? (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={data.needOutsourceRows.sampleRows}
                      columns={outsourceLineColumns}
                      pagination={false}
                      scroll={{ y: outsourceTableScroll.scrollY, x: 640 }}
                    />
                  ) : (
                    <Typography.Text type="secondary">
                      暂无因成品库存不足需外发跟进的销售行（同商品在库量已按规则先满足待交少的订单）。
                    </Typography.Text>
                  )}
                </div>
                {canOutsourceNav ? (
                  <Link href="/dashboard/outsource" style={{ fontSize: 13, flexShrink: 0, marginTop: 0 }}>
                    前往物料外发
                  </Link>
                ) : null}
              </div>
            </Col>
          )}

          {hasRecoverOut && data.outsourceUnrecovered && (
            <Col xs={24} sm={12} lg={8}>
              <div style={cardShell}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <Typography.Title level={5} style={{ margin: 0, fontSize: 16 }}>
                    回收外发提醒
                  </Typography.Title>
                  <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    基准日（北京时间）{baseDate}
                  </Typography.Text>
                </div>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  状态为「未回收」的外发加工单共{" "}
                  <strong style={{ color: data.outsourceUnrecovered.count > 0 ? "#cf1322" : undefined }}>
                    {data.outsourceUnrecovered.count}
                  </strong>{" "}
                  单，请在外发单中做回收/关闭。
                </Typography.Paragraph>
                <div ref={recoverOutTableScroll.ref} style={dashboardTableWrapStyle}>
                  {data.outsourceUnrecovered.rows.length === 0 ? (
                    <Typography.Text type="secondary">暂无未回收外发单。</Typography.Text>
                  ) : (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={data.outsourceUnrecovered.rows.slice(0, 8)}
                      columns={outColumns}
                      pagination={false}
                      scroll={{ y: recoverOutTableScroll.scrollY, x: 400 }}
                    />
                  )}
                </div>
                <Link href="/dashboard/outsource" style={{ fontSize: 13, flexShrink: 0, marginTop: 0 }}>
                  前往物料外发（已发外/回收进度）
                </Link>
              </div>
            </Col>
          )}

          {hasSamples && data.sampleReminders && (
            <Col xs={24} sm={12} lg={8}>
              <div style={cardShell}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <Typography.Title level={5} style={{ margin: 0, fontSize: 16 }}>
                    样品提醒
                  </Typography.Title>
                  <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    基准日（北京时间）{baseDate}
                  </Typography.Text>
                </div>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  未交样品共{" "}
                  <strong style={{ color: data.sampleReminders.count > 0 ? "#cf1322" : undefined }}>
                    {data.sampleReminders.count}
                  </strong>{" "}
                  条，按交样日期由近到远提醒。
                </Typography.Paragraph>
                <div ref={sampleTableScroll.ref} style={dashboardTableWrapStyle}>
                  {data.sampleReminders.rows.length === 0 ? (
                    <Typography.Text type="secondary">暂无未交样品。</Typography.Text>
                  ) : (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={data.sampleReminders.rows.slice(0, 8)}
                      columns={sampleColumns}
                      pagination={false}
                      scroll={{ y: sampleTableScroll.scrollY, x: 420 }}
                      onRow={(r) => ({ style: { background: rowBg[r.urgency] } })}
                    />
                  )}
                </div>
                <Link href="/dashboard/samples" style={{ fontSize: 13, flexShrink: 0, marginTop: 0 }}>
                  前往样品详情（未交样品）
                </Link>
              </div>
            </Col>
          )}

          {hasProductStockAlerts && data.productStockAlerts && (
            <Col xs={24} sm={12} lg={8}>
              <div style={cardShell}>
                <Typography.Title level={5} style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>
                  商品库存预警
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  安全库存/最大库存中任一阈值触发即显示。未设置阈值（空值或 0）不预警。当前共{" "}
                  <strong style={{ color: data.productStockAlerts.count > 0 ? "#cf1322" : undefined }}>
                    {data.productStockAlerts.count}
                  </strong>{" "}
                  条。
                </Typography.Paragraph>
                <div ref={productStockAlertTableScroll.ref} style={dashboardTableWrapStyle}>
                  {data.productStockAlerts.rows.length === 0 ? (
                    <Typography.Text type="secondary">暂无商品库存预警。</Typography.Text>
                  ) : (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={data.productStockAlerts.rows.slice(0, 8)}
                      columns={productStockAlertColumns}
                      pagination={false}
                      scroll={{ y: productStockAlertTableScroll.scrollY, x: 520 }}
                    />
                  )}
                </div>
                <Link href="/dashboard/products" style={{ fontSize: 13, flexShrink: 0, marginTop: 0 }}>
                  前往商品信息（商品库存）
                </Link>
              </div>
            </Col>
          )}

          {hasMaterialStockAlerts && data.materialStockAlerts && (
            <Col xs={24} sm={12} lg={8}>
              <div style={cardShell}>
                <Typography.Title level={5} style={{ margin: 0, marginBottom: 8, fontSize: 16 }}>
                  物料库存预警
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                  安全库存/最大库存中任一阈值触发即显示。未设置阈值（空值或 0）不预警。当前共{" "}
                  <strong style={{ color: data.materialStockAlerts.count > 0 ? "#cf1322" : undefined }}>
                    {data.materialStockAlerts.count}
                  </strong>{" "}
                  条。
                </Typography.Paragraph>
                <div ref={materialStockAlertTableScroll.ref} style={dashboardTableWrapStyle}>
                  {data.materialStockAlerts.rows.length === 0 ? (
                    <Typography.Text type="secondary">暂无物料库存预警。</Typography.Text>
                  ) : (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={data.materialStockAlerts.rows.slice(0, 8)}
                      columns={materialStockAlertColumns}
                      pagination={false}
                      scroll={{ y: materialStockAlertTableScroll.scrollY, x: 460 }}
                    />
                  )}
                </div>
                <Link href="/dashboard/materials" style={{ fontSize: 13, flexShrink: 0, marginTop: 0 }}>
                  前往物料信息（物料库存）
                </Link>
              </div>
            </Col>
          )}

        </Row>
      </ConfigProvider>

      <WorkbenchSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        workbench={wb}
        onSaved={load}
      />
    </div>
  );
}
