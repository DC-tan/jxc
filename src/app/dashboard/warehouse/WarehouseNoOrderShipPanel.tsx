"use client";

import {
  App,
  AutoComplete,
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WAREHOUSE_DELIVERY_DRAFT_KEY,
  buildNoOrderDeliveryDraft,
} from "@/lib/warehouse-delivery-draft";
import { fetchJson } from "@/lib/fetch-json";
import {
  WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK,
  resolveNoOrderShipOutUserRemark,
  type ProductShipOutPreviewLine,
} from "@/lib/warehouse-product-ship-out";

type CustomerOpt = { id: string; code: string; name: string; shortName?: string | null };

type ProductOption = {
  id: string;
  customerId: string;
  model: string;
  customerMaterialCode: string;
  unit: string;
  processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
  customer: { code: string; name: string };
  stockQuantity: number;
};

type BatchLine = {
  key: string;
  productId: string;
  model: string;
  customerMaterialCode: string;
  unit: string;
  processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
  stockQuantity: number;
  shipQty: number;
};

function processingModeLabel(
  mode: BatchLine["processingMode"],
): string {
  if (mode === "OUTSOURCE_INHOUSE") return "外发+自加工";
  if (mode === "OUTSOURCE") return "外发";
  return "自加工";
}

let lineKeySeq = 0;
function newLineKey() {
  lineKeySeq += 1;
  return `pso-${lineKeySeq}`;
}

export function WarehouseNoOrderShipPanel() {
  const { message } = App.useApp();
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [productModel, setProductModel] = useState("");
  const [catalog, setCatalog] = useState<ProductOption[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [batchLines, setBatchLines] = useState<BatchLine[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewLines, setPreviewLines] = useState<ProductShipOutPreviewLine[]>(
    [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [shipRemark, setShipRemark] = useState("");
  const [debouncedModel, setDebouncedModel] = useState("");
  const loadSeqRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedModel(productModel), 300);
    return () => window.clearTimeout(timer);
  }, [productModel]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCustomers(true);
      try {
        const data = await fetchJson<{ list: CustomerOpt[] }>(
          "/api/warehouse/customers",
          {
            credentials: "include",
          },
        );
        if (!cancelled) setCustomers(data.list ?? []);
      } catch (e) {
        if (!cancelled) {
          message.error(e instanceof Error ? e.message : "加载客户失败");
        }
      } finally {
        if (!cancelled) setLoadingCustomers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId),
    [customers, customerId],
  );

  const effectiveShipRemark = useMemo(
    () => resolveNoOrderShipOutUserRemark(shipRemark),
    [shipRemark],
  );

  const handleCustomerChange = useCallback((id: string | undefined) => {
    setCustomerId(id);
    setBatchLines([]);
  }, []);

  const loadCatalog = useCallback(
    async (opts: { customerId?: string; productModel?: string }) => {
      const cid = opts.customerId?.trim();
      const model = opts.productModel?.trim();
      if (!cid && !model) {
        setCatalog([]);
        return;
      }
      const seq = ++loadSeqRef.current;
      setSearchLoading(true);
      try {
        const qs = new URLSearchParams();
        if (cid) qs.set("customerId", cid);
        if (model) qs.set("productModel", model);
        const data = await fetchJson<{ list: ProductOption[] }>(
          `/api/warehouse/product-ship-out/products?${qs.toString()}`,
          { credentials: "include" },
        );
        if (seq !== loadSeqRef.current) return;
        setCatalog(data.list ?? []);
      } catch (e) {
        if (seq !== loadSeqRef.current) return;
        message.error(e instanceof Error ? e.message : "加载商品失败");
        setCatalog([]);
      } finally {
        if (seq === loadSeqRef.current) setSearchLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    void loadCatalog({ customerId, productModel: debouncedModel });
  }, [customerId, debouncedModel, loadCatalog]);

  useEffect(() => {
    if (customerId || !debouncedModel.trim() || catalog.length === 0) return;
    const customerIds = new Set(catalog.map((p) => p.customerId));
    if (customerIds.size === 1) {
      setCustomerId(catalog[0]!.customerId);
    }
  }, [catalog, customerId, debouncedModel]);

  const customerOptions = useMemo(() => {
    const q = debouncedModel.trim();
    if (!q || customerId || catalog.length === 0) return customers;
    const ids = new Set(catalog.map((p) => p.customerId));
    return customers.filter((c) => ids.has(c.id));
  }, [catalog, customerId, customers, debouncedModel]);

  const modelOptions = useMemo(() => {
    const models = new Set<string>();
    for (const p of catalog) {
      const m = p.model?.trim();
      if (m) models.add(m);
    }
    return [...models].sort().map((m) => ({ value: m }));
  }, [catalog]);

  const searchRows = useMemo(() => catalog, [catalog]);

  const addProduct = useCallback(
    (p: ProductOption) => {
      if (p.stockQuantity <= 0) {
        message.warning("该商品当前无库存");
        return;
      }
      if (batchLines.some((l) => l.productId === p.id)) {
        message.warning("该商品已在出货列表中");
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
          shipQty: 1,
        },
      ]);
    },
    [batchLines, message],
  );

  const removeLine = useCallback((key: string) => {
    setBatchLines((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const updateShipQty = useCallback((key: string, shipQty: number) => {
    setBatchLines((prev) =>
      prev.map((l) =>
        l.key === key ? { ...l, shipQty: Math.max(1, shipQty) } : l,
      ),
    );
  }, []);

  const openPreview = useCallback(async () => {
    if (!customerId) {
      message.warning("请先选择客户");
      return;
    }
    const filled = batchLines.filter((l) => l.shipQty > 0);
    if (filled.length === 0) {
      message.warning("请至少添加一行并填写出货数量");
      return;
    }
    for (const l of filled) {
      if (l.shipQty > l.stockQuantity) {
        message.warning(
          `「${l.model?.trim() || "—"}」出货数量不能超过现有库存 ${l.stockQuantity}`,
        );
        return;
      }
    }
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewLines([]);
    try {
      const data = await fetchJson<{ lines: ProductShipOutPreviewLine[] }>(
        "/api/warehouse/product-ship-out/preview",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId,
            lines: filled.map((l) => ({
              productId: l.productId,
              shipQty: l.shipQty,
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
  }, [batchLines, customerId, message]);

  const submitShipOut = useCallback(async () => {
    if (!customerId || !selectedCustomer) return;
    const filled = batchLines.filter((l) => l.shipQty > 0);
    if (filled.length === 0) return;
    setSubmitting(true);
    try {
      const shippedAt = new Date().toISOString();
      const noOrderLineMeta = Object.fromEntries(
        filled.map((l) => [
          l.productId,
          {
            productId: l.productId,
            model: l.model,
            customerMaterialCode: l.customerMaterialCode,
            unit: l.unit,
          },
        ]),
      );
      const draft = buildNoOrderDeliveryDraft({
        customerId,
        customer: {
          code: selectedCustomer.code,
          name: selectedCustomer.name,
          shortName: selectedCustomer.shortName,
        },
        shippedAt,
        lines: filled.map((l) => ({
          lineId: l.productId,
          shipQty: l.shipQty,
        })),
        noOrderLineMeta,
        noOrderShipOutRemark: shipRemark.trim() || undefined,
      });
      sessionStorage.setItem(WAREHOUSE_DELIVERY_DRAFT_KEY, JSON.stringify(draft));
      setPreviewOpen(false);
      setBatchLines([]);
      message.success("请打印送货单，确认后扣减库存");
      router.push("/dashboard/warehouse/delivery-note");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "出货失败");
    } finally {
      setSubmitting(false);
    }
  }, [batchLines, customerId, message, router, selectedCustomer, shipRemark]);

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
        title: "现有库存",
        key: "stock",
        width: 96,
        align: "right",
        render: (_, r) => r.stockQuantity,
      },
      {
        title: "出货数量",
        key: "shipQty",
        width: 120,
        render: (_, r) => (
          <InputNumber
            min={1}
            max={r.stockQuantity}
            precision={0}
            value={r.shipQty}
            onChange={(v) => {
              const n = Math.min(
                r.stockQuantity,
                Math.max(1, Math.trunc(Number(v ?? 1) || 1)),
              );
              updateShipQty(r.key, n);
            }}
          />
        ),
      },
      {
        title: "出货后库存",
        key: "after",
        width: 104,
        align: "right",
        render: (_, r) => r.stockQuantity - r.shipQty,
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
    [removeLine, updateShipQty],
  );

  const previewColumns: ColumnsType<ProductShipOutPreviewLine> = useMemo(
    () => [
      {
        title: "商品",
        dataIndex: "productLabel",
        width: 160,
        ellipsis: true,
      },
      {
        title: "现有库存",
        dataIndex: "productStock",
        width: 96,
        align: "right",
      },
      {
        title: "出货数量",
        dataIndex: "shipQty",
        width: 96,
        align: "right",
      },
      {
        title: "出货后库存",
        dataIndex: "stockAfterShip",
        width: 108,
        align: "right",
      },
    ],
    [],
  );

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        无销售订单时，按<strong>客户</strong>从现有商品库存直接出货。可先选客户或输入商品型号相互带出；出货时间取系统当前时间，备注可手动填写（不填默认「
        {WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK}」）。确认后进入送货单打印，点「确定」后扣减库存。
      </Typography.Paragraph>

      <Space wrap align="start">
        <Space direction="vertical" size={4}>
          <Typography.Text>
            客户 <Typography.Text type="danger">*</Typography.Text>
          </Typography.Text>
          <Select
            placeholder="选择客户"
            allowClear
            showSearch
            loading={loadingCustomers}
            style={{ width: 280 }}
            value={customerId}
            optionFilterProp="searchText"
            onChange={handleCustomerChange}
            options={customerOptions.map((c) => ({
              value: c.id,
              label: `${c.code} ${c.name}`,
              searchText: `${c.code} ${c.name}`.toLowerCase(),
            }))}
          />
        </Space>
        <Space direction="vertical" size={4}>
          <Typography.Text>商品型号</Typography.Text>
          <AutoComplete
            allowClear
            placeholder="输入或选择商品型号"
            style={{ width: 240 }}
            value={productModel}
            options={modelOptions}
            onChange={(v) => setProductModel(v)}
            onSelect={(v) => setProductModel(String(v))}
            filterOption={(input, option) =>
              String(option?.value ?? "")
                .toLowerCase()
                .includes(input.trim().toLowerCase())
            }
          />
        </Space>
      </Space>

      {selectedCustomer ? (
        <Typography.Text type="secondary">
          当前客户：{selectedCustomer.code} {selectedCustomer.name}
        </Typography.Text>
      ) : debouncedModel.trim() && catalog.length > 0 ? (
        <Typography.Text type="secondary">
          匹配到 {catalog.length} 个有库存商品
          {new Set(catalog.map((p) => p.customerId)).size > 1
            ? "，请先选择客户"
            : ""}
        </Typography.Text>
      ) : null}

      <Table<ProductOption>
        size="small"
        rowKey="id"
        loading={searchLoading}
        columns={searchColumns}
        dataSource={searchRows}
        pagination={{ pageSize: 8, hideOnSinglePage: true }}
        locale={{
          emptyText:
            customerId || debouncedModel.trim()
              ? "无有库存商品"
              : "请选择客户或输入商品型号",
        }}
        scroll={{ x: "max-content" }}
      />

      <Typography.Text strong>待出货明细</Typography.Text>
      <Table<BatchLine>
        size="small"
        rowKey="key"
        columns={batchColumns}
        dataSource={batchLines}
        pagination={false}
        locale={{ emptyText: "从上方查询结果点击「添加」" }}
        scroll={{ x: "max-content" }}
      />

      <Space wrap align="end" style={{ width: "100%", justifyContent: "space-between" }}>
        <Space direction="vertical" size={4}>
          <Typography.Text type="secondary">
            出货时间：进入送货单页时自动记录 · 点「确定」扣减库存
          </Typography.Text>
          <Space align="center" size="small">
            <Typography.Text>备注</Typography.Text>
            <Input
              allowClear
              placeholder={`不填则默认「${WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK}」`}
              style={{ width: 280 }}
              value={shipRemark}
              onChange={(e) => setShipRemark(e.target.value)}
              maxLength={200}
            />
          </Space>
        </Space>
        <Button
          type="primary"
          disabled={!customerId || batchLines.length === 0}
          onClick={() => void openPreview()}
        >
          预检并确认出货
        </Button>
      </Space>

      <Modal
        title="确认无单出货"
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        width={720}
        footer={
          <Space>
            <Button onClick={() => setPreviewOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={submitting}
              disabled={previewLoading || previewLines.length === 0}
              onClick={() => void submitShipOut()}
            >
              前往送货单
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
            <Typography.Text>
              <strong>客户：</strong>
              {previewLines[0]
                ? `${previewLines[0].customerCode} ${previewLines[0].customerName}`
                : selectedCustomer
                  ? `${selectedCustomer.code} ${selectedCustomer.name}`
                  : "—"}
            </Typography.Text>
            <Typography.Text type="secondary">
              出货时间：系统当前时间 · 备注：{effectiveShipRemark}
            </Typography.Text>
            <Table<ProductShipOutPreviewLine>
              size="small"
              rowKey="productId"
              pagination={false}
              columns={previewColumns}
              dataSource={previewLines}
              scroll={{ x: "max-content" }}
            />
          </Space>
        )}
      </Modal>
    </Space>
  );
}
