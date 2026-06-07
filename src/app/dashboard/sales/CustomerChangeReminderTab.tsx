"use client";

import { App, Button, DatePicker, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";

type CustomerOpt = { id: string; code: string; name: string; shortName?: string | null };
type ProductOpt = {
  id: string;
  customerId: string;
  customerMaterialCode: string;
  model: string;
};
type PresetBundle = {
  customers: CustomerOpt[];
  products: ProductOpt[];
};

type ReminderRow = {
  id: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  productId: string;
  productModel: string;
  customerMaterialCode: string;
  changeSummary: string;
  proposedAt: string;
  status: "ACTIVE" | "DONE" | "VOIDED";
  salesConfirmCount: number;
  purchaseConfirmCount: number;
  salesLastConfirmedAt: string | null;
  salesLastConfirmedByName: string | null;
  purchaseLastConfirmedAt: string | null;
  purchaseLastConfirmedByName: string | null;
  createdByName: string;
  createdAt: string;
};

type ReminderFormInput = {
  customerId: string;
  productId: string;
  changeSummary: string;
  proposedAt: dayjs.Dayjs;
};

const statusTag = (
  s: ReminderRow["status"],
): { color: string; text: string } => {
  if (s === "ACTIVE") return { color: "gold", text: "进行中" };
  if (s === "DONE") return { color: "green", text: "已完成" };
  return { color: "default", text: "已作废" };
};

export function CustomerChangeReminderTab() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [rows, setRows] = useState<ReminderRow[]>([]);
  const [presets, setPresets] = useState<PresetBundle>({ customers: [], products: [] });
  const [includeDone, setIncludeDone] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ReminderRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<ReminderFormInput>();
  const customerId = Form.useWatch("customerId", form);
  const productId = Form.useWatch("productId", form);

  const loadPresets = useCallback(async () => {
    setLoadingPresets(true);
    try {
      const p = await fetchJson<PresetBundle>("/api/sales-presets", {
        credentials: "include",
      });
      setPresets({
        customers: p.customers ?? [],
        products: (p.products ?? []).map((x) => ({
          id: x.id,
          customerId: x.customerId,
          customerMaterialCode: x.customerMaterialCode,
          model: x.model,
        })),
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载客户/商品失败");
      setPresets({ customers: [], products: [] });
    } finally {
      setLoadingPresets(false);
    }
  }, [message]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (includeDone) qs.set("includeDone", "1");
      const data = await fetchJson<{ list: ReminderRow[] }>(
        `/api/customer-change-reminders?${qs.toString()}`,
        { credentials: "include" },
      );
      setRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [includeDone, message]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const pool = useMemo(
    () =>
      customerId
        ? presets.products.filter((p) => p.customerId === customerId)
        : [],
    [presets.products, customerId],
  );

  const selectedProduct = useMemo(
    () => presets.products.find((p) => p.id === productId),
    [presets.products, productId],
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ proposedAt: dayjs() });
    setOpen(true);
  };

  const openEdit = (r: ReminderRow) => {
    setEditing(r);
    form.setFieldsValue({
      customerId: r.customerId,
      productId: r.productId,
      changeSummary: r.changeSummary,
      proposedAt: dayjs(r.proposedAt),
    });
    setOpen(true);
  };

  const submit = async () => {
    let v: Awaited<ReturnType<typeof form.validateFields>>;
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        customerId: v.customerId,
        productId: v.productId,
        changeSummary: v.changeSummary,
        proposedAt: v.proposedAt.toISOString(),
      };
      if (editing) {
        await fetchJson(`/api/customer-change-reminders/${editing.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        message.success("变更提醒已更新");
      } else {
        await fetchJson("/api/customer-change-reminders", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        message.success("变更提醒已新增");
      }
      setOpen(false);
      setEditing(null);
      await loadRows();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  const voidRow = (r: ReminderRow) => {
    Modal.confirm({
      title: "作废该提醒？",
      content: "作废后不再参与下单提醒。",
      okText: "作废",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        await fetchJson(`/api/customer-change-reminders/${r.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "void" }),
        });
        message.success("已作废");
        await loadRows();
      },
    });
  };

  const columns: ColumnsType<ReminderRow> = [
    {
      key: "customer",
      title: "客户",
      render: (_, r) => `${r.customerCode} ${r.customerName}`,
      width: 180,
      ellipsis: true,
    },
    {
      key: "product",
      title: "商品型号",
      dataIndex: "productModel",
      width: 160,
      ellipsis: true,
      render: (v: string) => v?.trim() || "—",
    },
    {
      key: "materialCode",
      title: "商品物料编号",
      dataIndex: "customerMaterialCode",
      width: 150,
      ellipsis: true,
      render: (v: string) => v?.trim() || "—",
    },
    {
      key: "summary",
      title: "变更内容",
      dataIndex: "changeSummary",
      ellipsis: true,
    },
    {
      key: "proposedAt",
      title: "提出日期",
      dataIndex: "proposedAt",
      width: 110,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD"),
    },
    {
      key: "status",
      title: "状态",
      width: 180,
      render: (_, r) => {
        const s = r.status;
        const t = statusTag(s);
        return (
          <Space size={4} direction="vertical">
            <Tag color={t.color}>{t.text}</Tag>
            {s === "ACTIVE" ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                销售 {r.salesConfirmCount}/2，采购 {r.purchaseConfirmCount}/2
              </Typography.Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      key: "operator",
      title: "操作人",
      width: 300,
      render: (_, r) => {
        const sales = r.salesLastConfirmedAt
          ? `销售上次：${r.salesLastConfirmedByName ?? "—"} (${dayjs(r.salesLastConfirmedAt).format("MM-DD HH:mm")})`
          : "销售上次：—";
        const purchase = r.purchaseLastConfirmedAt
          ? `采购上次：${r.purchaseLastConfirmedByName ?? "—"} (${dayjs(r.purchaseLastConfirmedAt).format("MM-DD HH:mm")})`
          : "采购上次：—";
        return `${sales}；${purchase}；创建：${r.createdByName}`;
      },
    },
    {
      key: "op",
      title: "操作",
      width: 120,
      render: (_, r) =>
        r.status === "DONE" || r.status === "VOIDED" ? (
          "—"
        ) : (
          <Space size="small">
            <Button type="link" size="small" onClick={() => openEdit(r)}>
              修改
            </Button>
            <Button type="link" size="small" danger onClick={() => voidRow(r)}>
              作废
            </Button>
          </Space>
        ),
    },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space wrap>
        <Button type="primary" onClick={openCreate} loading={loadingPresets}>
          新增客户变更提醒
        </Button>
        <Typography.Text type="secondary">
          用于记录“客户提出但下次订单才执行”的变更。销售下单需确认 2 次，采购下单需确认 2 次；两侧都完成后自动结束，不再弹窗。
        </Typography.Text>
      </Space>
      <Space size="small" align="center">
        <Typography.Text>显示已完成/已作废</Typography.Text>
        <Switch checked={includeDone} onChange={setIncludeDone} />
      </Space>
      <Table<ReminderRow>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 10 }}
        scroll={{ x: "max-content" }}
      />

      <Modal
        title={editing ? "修改客户变更提醒" : "新增客户变更提醒"}
        open={open}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        onOk={() => void submit()}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form<ReminderFormInput> form={form} layout="vertical" autoComplete="off">
          <Form.Item
            name="customerId"
            label="客户名称"
            rules={[{ required: true, message: "请选择客户" }]}
          >
            <Select
              showSearch
              placeholder="选择客户"
              optionFilterProp="searchText"
              options={presets.customers.map((c) => ({
                value: c.id,
                label: `${c.code} ${c.name}`,
                searchText: `${c.code} ${c.name} ${c.shortName ?? ""}`.toLowerCase(),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="productId"
            label="商品型号"
            rules={[{ required: true, message: "请选择商品" }]}
          >
            <Select
              showSearch
              placeholder={customerId ? "输入型号/物料编号前缀搜索" : "请先选择客户"}
              optionFilterProp="label"
              disabled={!customerId}
              options={pool.map((p) => ({
                value: p.id,
                label: `${p.model || "—"} / ${p.customerMaterialCode || "—"}`,
              }))}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ marginTop: -6 }}>
            商品物料编号：{selectedProduct?.customerMaterialCode?.trim() || "—"}
          </Typography.Paragraph>
          <Form.Item
            name="changeSummary"
            label="变更内容"
            rules={[{ required: true, message: "请填写变更内容" }]}
          >
            <Input.TextArea rows={4} placeholder="例如：下次订单起将按键胶高度由 0.30 调整为 0.35" />
          </Form.Item>
          <Form.Item
            name="proposedAt"
            label="提出日期"
            rules={[{ required: true, message: "请选择提出日期" }]}
          >
            <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
