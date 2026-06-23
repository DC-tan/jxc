"use client";

import {
  App,
  Button,
  DatePicker,
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import type { ProductStockInPreviewLine } from "@/lib/warehouse-product-stock-in";
import { WAREHOUSE_NO_ORDER_STOCK_IN_REMARK } from "@/lib/warehouse-product-stock-in";

type ProductOption = {
  id: string;
  model: string;
  customerMaterialCode: string;
  unit: string;
  processingMode: "INHOUSE" | "OUTSOURCE_INHOUSE";
  customer: { code: string; name: string };
  stockQuantity: number;
  recoveryStockQuantity: number | null;
  recoveryLabel: string | null;
};

type BatchLine = {
  key: string;
  productId: string;
  model: string;
  customerMaterialCode: string;
  unit: string;
  processingMode: "INHOUSE" | "OUTSOURCE_INHOUSE";
  stockQuantity: number;
  recoveryStockQuantity: number | null;
  recoveryLabel: string | null;
  quantity: number;
};

type HistoryRow = {
  id: string;
  quantity: number;
  receivedAt: string;
  partDescription: string | null;
  remark: string | null;
  createdAt: string;
  product: {
    id: string;
    model: string;
    customerMaterialCode: string;
    unit: string;
    processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
    customer: { code: string; name: string };
  };
  operatorName: string | null;
  operatorEmployeeNo: string | null;
};

type HistoryDetail = {
  id: string;
  quantity: number;
  receivedAt: string;
  partDescription: string | null;
  remark: string | null;
  product: HistoryRow["product"];
  operatorName: string | null;
  operatorEmployeeNo: string | null;
  materialDeductions: {
    id: string;
    quantity: number;
    partDescription: string | null;
    materialCode: string;
    materialName: string;
    materialPart: string | null;
    unit: string;
  }[];
  recoveryDeduction: {
    id: string;
    quantity: number;
    partDescription: string | null;
    remark: string | null;
  } | null;
};

function processingModeLabel(
  mode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE",
): string {
  if (mode === "OUTSOURCE_INHOUSE") return "外发+自加工";
  if (mode === "OUTSOURCE") return "外发";
  return "自加工";
}

let lineKeySeq = 0;
function newLineKey() {
  lineKeySeq += 1;
  return `psi-${lineKeySeq}`;
}

function StockInHistoryPanel({ refreshKey }: { refreshKey: number }) {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState("");
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>(() => [
    dayjs().subtract(30, "day").startOf("day"),
    dayjs().endOf("day"),
  ]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);

  const runQuery = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (keyword.trim()) qs.set("keyword", keyword.trim());
      if (dateRange[0]) {
        qs.set("receivedFrom", dateRange[0].startOf("day").toISOString());
      }
      if (dateRange[1]) {
        qs.set("receivedTo", dateRange[1].endOf("day").toISOString());
      }
      const data = await fetchJson<{ list: HistoryRow[] }>(
        `/api/warehouse/product-stock-in/history?${qs.toString()}`,
        { credentials: "include" },
      );
      setRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "查询失败");
    } finally {
      setLoading(false);
    }
  }, [dateRange, keyword, message]);

  useEffect(() => {
    void runQuery();
  }, [runQuery, refreshKey]);

  const openDetail = useCallback(
    async (id: string) => {
      setDetailOpen(true);
      setDetailLoading(true);
      setDetail(null);
      try {
        const data = await fetchJson<HistoryDetail>(
          `/api/warehouse/product-stock-in/history/${encodeURIComponent(id)}`,
          { credentials: "include" },
        );
        setDetail(data);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "加载明细失败");
        setDetailOpen(false);
      } finally {
        setDetailLoading(false);
      }
    },
    [message],
  );

  const columns: ColumnsType<HistoryRow> = useMemo(
    () => [
      {
        title: "入库时间",
        dataIndex: "receivedAt",
        width: 168,
        render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
      },
      {
        title: "商品型号",
        key: "model",
        width: 160,
        ellipsis: true,
        render: (_, r) => r.product.model?.trim() || "—",
      },
      {
        title: "客户料号",
        key: "code",
        width: 140,
        ellipsis: true,
        render: (_, r) => r.product.customerMaterialCode?.trim() || "—",
      },
      {
        title: "加工方式",
        key: "mode",
        width: 112,
        render: (_, r) => processingModeLabel(r.product.processingMode),
      },
      {
        title: "入库数量",
        dataIndex: "quantity",
        width: 96,
        align: "right",
      },
      {
        title: "单位",
        key: "unit",
        width: 64,
        render: (_, r) => r.product.unit?.trim() || "—",
      },
      {
        title: "备注",
        dataIndex: "remark",
        width: 160,
        ellipsis: true,
        render: (v: string | null) => v?.trim() || "—",
      },
      {
        title: "操作人",
        key: "operator",
        width: 120,
        render: (_, r) => {
          if (!r.operatorName) return "—";
          return r.operatorEmployeeNo
            ? `${r.operatorName}（${r.operatorEmployeeNo}）`
            : r.operatorName;
        },
      },
      {
        title: "操作",
        key: "op",
        width: 88,
        render: (_, r) => (
          <Button type="link" size="small" onClick={() => void openDetail(r.id)}>
            查看明细
          </Button>
        ),
      },
    ],
    [openDetail],
  );

  const totalQty = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0),
    [rows],
  );

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        查询本页「商品入库」登记的历史记录，含入库时间与关联扣料明细。
      </Typography.Paragraph>

      <Space wrap align="start">
        <Space direction="vertical" size={4}>
          <Typography.Text>关键字</Typography.Text>
          <Input
            allowClear
            placeholder="型号 / 客户料号 / 备注 / 操作人"
            style={{ width: 260 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => void runQuery()}
          />
        </Space>
        <Space direction="vertical" size={4}>
          <Typography.Text>入库日期</Typography.Text>
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(range) => {
              if (range?.[0] && range[1]) {
                setDateRange([range[0], range[1]]);
              }
            }}
          />
        </Space>
        <Button type="primary" loading={loading} onClick={() => void runQuery()}>
          查询
        </Button>
      </Space>

      <Table<HistoryRow>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 15, showSizeChanger: true }}
        locale={{ emptyText: "暂无入库明细" }}
        scroll={{ x: "max-content" }}
        summary={
          rows.length > 0
            ? () => (
                <Table.Summary fixed>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={4} align="right">
                      <Typography.Text type="secondary">合计</Typography.Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right">
                      <Typography.Text strong>{totalQty}</Typography.Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={5} colSpan={4} />
                  </Table.Summary.Row>
                </Table.Summary>
              )
            : undefined
        }
      />

      <Modal
        title="入库明细"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={<Button onClick={() => setDetailOpen(false)}>关闭</Button>}
        width={760}
        destroyOnHidden
      >
        {detailLoading || !detail ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <Spin />
          </div>
        ) : (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Typography.Text>
              <strong>商品：</strong>
              {detail.product.model?.trim() || "—"}（
              {detail.product.customerMaterialCode?.trim() || "—"}）
            </Typography.Text>
            <Typography.Text>
              <strong>入库时间：</strong>
              {dayjs(detail.receivedAt).format("YYYY-MM-DD HH:mm")}
            </Typography.Text>
            <Typography.Text>
              <strong>入库数量：</strong>
              {detail.quantity} {detail.product.unit?.trim() || ""}
            </Typography.Text>
            <Typography.Text>
              <strong>说明：</strong>
              {detail.partDescription?.trim() || "—"}
            </Typography.Text>
            <Typography.Text>
              <strong>备注：</strong>
              {detail.remark?.trim() || "—"}
            </Typography.Text>
            <Typography.Text>
              <strong>操作人：</strong>
              {detail.operatorName
                ? detail.operatorEmployeeNo
                  ? `${detail.operatorName}（${detail.operatorEmployeeNo}）`
                  : detail.operatorName
                : "—"}
            </Typography.Text>

            {detail.recoveryDeduction ? (
              <div>
                <Typography.Text strong>外发回收库扣减</Typography.Text>
                <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                  <li>
                    扣减 {Math.abs(detail.recoveryDeduction.quantity)} 套
                    {detail.recoveryDeduction.partDescription
                      ? ` — ${detail.recoveryDeduction.partDescription}`
                      : ""}
                  </li>
                </ul>
              </div>
            ) : null}

            <div>
              <Typography.Text strong>物料扣减</Typography.Text>
              {detail.materialDeductions.length === 0 ? (
                <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                  无关联物料扣减记录
                </Typography.Paragraph>
              ) : (
                <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                  {detail.materialDeductions.map((m) => (
                    <li key={m.id}>
                      {m.materialPart?.trim() || m.materialName}（{m.materialCode}）
                      ：扣 {Math.abs(m.quantity)} {m.unit}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Space>
        )}
      </Modal>
    </Space>
  );
}

function StockInFormPanel({ onSuccess }: { onSuccess: () => void }) {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchRows, setSearchRows] = useState<ProductOption[]>([]);
  const [batchLines, setBatchLines] = useState<BatchLine[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewLines, setPreviewLines] = useState<ProductStockInPreviewLine[]>(
    [],
  );
  const [submitting, setSubmitting] = useState(false);

  const runSearch = useCallback(async () => {
    setSearchLoading(true);
    try {
      const qs = new URLSearchParams();
      if (keyword.trim()) qs.set("keyword", keyword.trim());
      const data = await fetchJson<{ list: ProductOption[] }>(
        `/api/warehouse/product-stock-in/products?${qs.toString()}`,
        { credentials: "include" },
      );
      setSearchRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "查询失败");
    } finally {
      setSearchLoading(false);
    }
  }, [keyword, message]);

  const addProduct = useCallback(
    (p: ProductOption) => {
      if (batchLines.some((l) => l.productId === p.id)) {
        message.warning("该商品已在入库列表中");
        return;
      }
      setBatchLines((prev) => [
        ...prev,
        {
          key: newLineKey(),
          productId: p.id,
          model: p.model,
          customerMaterialCode: p.customerMaterialCode,
          unit: p.unit,
          processingMode: p.processingMode,
          stockQuantity: p.stockQuantity,
          recoveryStockQuantity: p.recoveryStockQuantity,
          recoveryLabel: p.recoveryLabel,
          quantity: 1,
        },
      ]);
    },
    [batchLines, message],
  );

  const removeLine = useCallback((key: string) => {
    setBatchLines((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const updateQty = useCallback((key: string, quantity: number) => {
    setBatchLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, quantity } : l)),
    );
  }, []);

  const openPreview = useCallback(async () => {
    const filled = batchLines.filter((l) => l.quantity > 0);
    if (filled.length === 0) {
      message.warning("请至少添加一行并填写入库数量");
      return;
    }
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewLines([]);
    try {
      const data = await fetchJson<{ lines: ProductStockInPreviewLine[] }>(
        "/api/warehouse/product-stock-in/preview",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lines: filled.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
            })),
          }),
        },
      );
      setPreviewLines(data.lines ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "预检失败");
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  }, [batchLines, message]);

  const submitStockIn = useCallback(async () => {
    const filled = batchLines.filter((l) => l.quantity > 0);
    if (filled.length === 0) return;
    setSubmitting(true);
    try {
      await fetchJson("/api/warehouse/product-stock-in", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: filled.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
          })),
        }),
      });
      message.success("商品入库成功");
      setPreviewOpen(false);
      setBatchLines([]);
      onSuccess();
      void runSearch();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "入库失败");
    } finally {
      setSubmitting(false);
    }
  }, [batchLines, message, onSuccess, runSearch]);

  const searchColumns: ColumnsType<ProductOption> = useMemo(
    () => [
      {
        title: "商品型号",
        dataIndex: "model",
        width: 160,
        ellipsis: true,
        render: (v: string) => v?.trim() || "—",
      },
      {
        title: "客户料号",
        dataIndex: "customerMaterialCode",
        width: 140,
        ellipsis: true,
        render: (v: string) => v?.trim() || "—",
      },
      {
        title: "加工方式",
        key: "mode",
        width: 112,
        render: (_, r) => processingModeLabel(r.processingMode),
      },
      {
        title: "商品库存",
        key: "stock",
        width: 96,
        align: "right",
        render: (_, r) => r.stockQuantity,
      },
      {
        title: "外发回收库",
        key: "recovery",
        width: 120,
        align: "right",
        render: (_, r) =>
          r.recoveryStockQuantity != null ? r.recoveryStockQuantity : "—",
      },
      {
        title: "操作",
        key: "op",
        width: 88,
        render: (_, r) => (
          <Button type="link" size="small" onClick={() => addProduct(r)}>
            添加
          </Button>
        ),
      },
    ],
    [addProduct],
  );

  const batchColumns: ColumnsType<BatchLine> = useMemo(
    () => [
      {
        title: "商品型号",
        dataIndex: "model",
        width: 160,
        ellipsis: true,
        render: (v: string) => v?.trim() || "—",
      },
      {
        title: "客户料号",
        dataIndex: "customerMaterialCode",
        width: 140,
        ellipsis: true,
        render: (v: string) => v?.trim() || "—",
      },
      {
        title: "加工方式",
        key: "mode",
        width: 112,
        render: (_, r) => processingModeLabel(r.processingMode),
      },
      {
        title: "现商品库存",
        key: "stock",
        width: 104,
        align: "right",
        render: (_, r) => r.stockQuantity,
      },
      {
        title: "外发回收库",
        key: "recovery",
        width: 120,
        align: "right",
        render: (_, r) =>
          r.recoveryStockQuantity != null
            ? `${r.recoveryStockQuantity}${r.recoveryLabel ? `（${r.recoveryLabel}）` : ""}`
            : "—",
      },
      {
        title: "入库数量",
        key: "qty",
        width: 120,
        render: (_, r) => (
          <InputNumber
            min={1}
            max={999999999}
            precision={0}
            value={r.quantity}
            onChange={(v) => {
              const n = Math.max(1, Math.trunc(Number(v ?? 1) || 1));
              updateQty(r.key, n);
            }}
          />
        ),
      },
      {
        title: "操作",
        key: "op",
        width: 72,
        render: (_, r) => (
          <Button type="link" danger size="small" onClick={() => removeLine(r.key)}>
            移除
          </Button>
        ),
      },
    ],
    [removeLine, updateQty],
  );

  const previewColumns: ColumnsType<ProductStockInPreviewLine> = useMemo(
    () => [
      {
        title: "商品",
        dataIndex: "productLabel",
        width: 160,
        ellipsis: true,
      },
      {
        title: "入库数量",
        dataIndex: "quantity",
        width: 96,
        align: "right",
      },
      {
        title: "入库后商品库存",
        key: "afterStock",
        width: 128,
        align: "right",
        render: (_, r) => r.productStock + r.quantity,
      },
    ],
    [],
  );

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        无销售订单时，将物料加工成成品并入<strong>商品库存</strong>。扣料规则与仓库出货中自加工/外发+自加工一致。入库时间取系统当前时间，备注固定为「
        {WAREHOUSE_NO_ORDER_STOCK_IN_REMARK}」。纯外发加工商品请走「物料外发 → 确认回收」。
      </Typography.Paragraph>

      <Space wrap align="start">
        <Space direction="vertical" size={4}>
          <Typography.Text>关键字</Typography.Text>
          <Input
            allowClear
            placeholder="型号 / 客户料号 / 客户"
            style={{ width: 260 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => void runSearch()}
          />
        </Space>
        <Button type="primary" loading={searchLoading} onClick={() => void runSearch()}>
          查询商品
        </Button>
      </Space>

      <Table<ProductOption>
        size="small"
        rowKey="id"
        loading={searchLoading}
        columns={searchColumns}
        dataSource={searchRows}
        pagination={{ pageSize: 8, hideOnSinglePage: true }}
        locale={{ emptyText: "请输入关键字后查询，或留空浏览可选商品" }}
        scroll={{ x: "max-content" }}
      />

      <Typography.Text strong>待入库明细</Typography.Text>
      <Table<BatchLine>
        size="small"
        rowKey="key"
        columns={batchColumns}
        dataSource={batchLines}
        pagination={false}
        locale={{ emptyText: "从上方查询结果点击「添加」" }}
        scroll={{ x: "max-content" }}
        expandable={{
          expandedRowRender: (r) => (
            <Typography.Text type="secondary">
              单位：{r.unit?.trim() || "—"}；确认入库时将按 BOM 预检物料库存
              {r.processingMode === "OUTSOURCE_INHOUSE"
                ? "，并扣减外发回收库"
                : ""}
              。
            </Typography.Text>
          ),
          rowExpandable: () => true,
        }}
      />

      <Space wrap align="end">
        <Typography.Text type="secondary">
          入库时间：系统自动（确认时记录） · 备注：{WAREHOUSE_NO_ORDER_STOCK_IN_REMARK}
        </Typography.Text>
        <Button
          type="primary"
          disabled={batchLines.length === 0}
          onClick={() => void openPreview()}
        >
          预检并确认入库
        </Button>
      </Space>

      <Modal
        title="确认商品入库"
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        width={880}
        footer={
          <Space>
            <Button onClick={() => setPreviewOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={submitting}
              disabled={previewLoading || previewLines.length === 0}
              onClick={() => void submitStockIn()}
            >
              确认入库
            </Button>
          </Space>
        }
        destroyOnHidden
      >
        {previewLoading ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <Spin />
          </div>
        ) : (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Typography.Text type="secondary">
              入库时间：系统当前时间 · 备注：{WAREHOUSE_NO_ORDER_STOCK_IN_REMARK}
            </Typography.Text>
            <Table<ProductStockInPreviewLine>
              size="small"
              rowKey="productId"
              pagination={false}
              columns={previewColumns}
              dataSource={previewLines}
              scroll={{ x: "max-content" }}
              expandable={{
                expandedRowRender: (r) => (
                  <div style={{ maxWidth: 760 }}>
                    <Typography.Text strong>
                      BOM 物料扣减（入库 {r.quantity} 件）
                    </Typography.Text>
                    <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                      {r.bom.map((b) => (
                        <li key={b.materialId}>
                          {b.materialPart}（{b.materialCode}）单套 {b.usageQty}，本批扣{" "}
                          <strong>{b.needQty}</strong>，当前物料库存 {b.materialStock}
                        </li>
                      ))}
                    </ul>
                    {r.recoveryStock != null ? (
                      <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }}>
                        外发回收库：当前 {r.recoveryStock}，本次扣 {r.quantity}
                      </Typography.Paragraph>
                    ) : null}
                  </div>
                ),
                rowExpandable: (r) => r.bom.length > 0,
                defaultExpandedRowKeys: previewLines.map((l) => l.productId),
              }}
            />
          </Space>
        )}
      </Modal>
    </Space>
  );
}

export function ProductStockInTab() {
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  return (
    <Tabs
      items={[
        {
          key: "inbound",
          label: "办理入库",
          children: (
            <StockInFormPanel
              onSuccess={() => setHistoryRefreshKey((k) => k + 1)}
            />
          ),
        },
        {
          key: "history",
          label: "入库明细",
          children: <StockInHistoryPanel refreshKey={historyRefreshKey} />,
        },
      ]}
    />
  );
}
