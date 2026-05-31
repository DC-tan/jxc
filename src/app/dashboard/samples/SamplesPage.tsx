"use client";

import { PlusOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  type SyntheticEvent,
} from "react";
import type { ResizeCallbackData } from "react-resizable";
import { ResizableTableTitle } from "@/components/ResizableTableTitle";
import { fetchJson } from "@/lib/fetch-json";
import { useMeTabPermissions } from "@/lib/use-me-tab-permissions";

const SAMPLE_TAB_PERM: Record<string, string> = {
  add: "tab.sample.add",
  open: "tab.sample.open",
  query: "tab.sample.query",
};

type CustomerOpt = { id: string; code: string; name: string };

type SampleRow = {
  id: string;
  customerId: string;
  customer: CustomerOpt;
  model: string;
  materialNames: string;
  quantity: number;
  sampleDueAt: string;
  status: "PENDING" | "DELIVERED";
  deliveredAt: string | null;
  trackingNo: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
};

type SampleFormValues = {
  customerId: string;
  model: string;
  materialNames: string;
  quantity: number;
  sampleDueAt: dayjs.Dayjs;
  remark?: string;
};

type SampleQueryValues = {
  dateRange?: [dayjs.Dayjs, dayjs.Dayjs];
  customerId?: string;
  trackingNo?: string;
  keyword?: string;
};

type DeliverFormValues = {
  deliveredQuantity: number;
  trackingNo: string;
};

const statusText = (s: SampleRow["status"]) =>
  s === "DELIVERED" ? "已交样" : "未交样";

function sampleDueDayLabel(iso: string) {
  const d = dayjs(iso).startOf("day");
  const today = dayjs().startOf("day");
  const diff = d.diff(today, "day");
  if (diff < 0) return `已逾期 ${-diff} 天`;
  if (diff === 0) return "今天";
  return `还有 ${diff} 天`;
}

const DEFAULT_SAMPLE_LIST_WIDTH: Record<string, number> = {
  customer: 180,
  model: 150,
  materialNames: 240,
  quantity: 90,
  sampleDueAt: 120,
  due: 110,
  status: 88,
  trackingNo: 150,
  createdAt: 150,
  remark: 180,
  op: 190,
};

function attachResizeSampleList<T extends object>(
  columns: ColumnsType<T>,
  widths: Record<string, number>,
  setWidths: Dispatch<SetStateAction<Record<string, number>>>,
  defaults: Record<string, number>,
): ColumnsType<T> {
  return columns.map((col) => {
    // 修复：先检查 col 是否有 dataIndex 属性（排除分组列）
    const keyFromDataIndex = ('dataIndex' in col && typeof col.dataIndex === "string") ? col.dataIndex : "";
    const key = col.key != null ? String(col.key) : keyFromDataIndex;
    if (!key) return col;
    const w = widths[key] ?? defaults[key] ?? (col.width as number) ?? 120;
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

function HelpTip({ text }: { text: ReactNode }) {
  return (
    <Tooltip title={<span style={{ whiteSpace: "normal" }}>{text}</span>} placement="topLeft">
      <QuestionCircleOutlined style={{ color: "#8c8c8c", cursor: "help" }} />
    </Tooltip>
  );
}

export function SamplesPage() {
  const { message, modal } = App.useApp();
  const [tab, setTab] = useState("add");
  const { loading: tabPermLoading, allowed } = useMeTabPermissions();

  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  const [todayRows, setTodayRows] = useState<SampleRow[]>([]);
  const [openRows, setOpenRows] = useState<SampleRow[]>([]);
  const [queryRows, setQueryRows] = useState<SampleRow[]>([]);
  const [loadingToday, setLoadingToday] = useState(false);
  const [loadingOpen, setLoadingOpen] = useState(false);
  const [loadingQuery, setLoadingQuery] = useState(false);

  const [createForm] = Form.useForm<SampleFormValues>();
  const [queryForm] = Form.useForm<SampleQueryValues>();
  const [submitting, setSubmitting] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<SampleRow | null>(null);
  const [editForm] = Form.useForm<SampleFormValues>();
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [delivering, setDelivering] = useState<SampleRow | null>(null);
  const [deliverForm] = Form.useForm<DeliverFormValues>();
  const [sampleColWidths, setSampleColWidths] = useState<Record<string, number>>({});

  const visibleSampleTabKeys = useMemo(
    () =>
      (["add", "open", "query"] as const).filter((k) =>
        allowed([SAMPLE_TAB_PERM[k]]),
      ),
    [allowed],
  );

  useEffect(() => {
    if (tabPermLoading) return;
    if (visibleSampleTabKeys.length === 0) return;
    const keys = visibleSampleTabKeys as readonly string[];
    if (!keys.includes(tab)) {
      setTab(keys[0] ?? "add");
    }
  }, [tabPermLoading, visibleSampleTabKeys, tab]);

  const loadCustomers = useCallback(async () => {
    setLoadingCustomers(true);
    try {
      const data = await fetchJson<{ list: CustomerOpt[] }>("/api/customers", {
        credentials: "include",
      });
      setCustomers(data.list ?? []);
    } catch {
      setCustomers([]);
    } finally {
      setLoadingCustomers(false);
    }
  }, []);

  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        value: c.id,
        label: `${c.code} ${c.name}`,
      })),
    [customers],
  );

  const loadToday = useCallback(async () => {
    setLoadingToday(true);
    try {
      const start = dayjs().startOf("day").toISOString();
      const end = dayjs().endOf("day").toISOString();
      const data = await fetchJson<{ list: SampleRow[] }>(
        `/api/samples?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`,
        { credentials: "include" },
      );
      setTodayRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载今日样品失败");
      setTodayRows([]);
    } finally {
      setLoadingToday(false);
    }
  }, [message]);

  const loadOpen = useCallback(async () => {
    setLoadingOpen(true);
    try {
      const data = await fetchJson<{ list: SampleRow[] }>(
        "/api/samples?status=PENDING",
        { credentials: "include" },
      );
      setOpenRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载未交样品失败");
      setOpenRows([]);
    } finally {
      setLoadingOpen(false);
    }
  }, [message]);

  const loadQuery = useCallback(
    async (override?: Partial<SampleQueryValues>) => {
      setLoadingQuery(true);
      try {
        const v: Partial<SampleQueryValues> =
          override ??
          (await queryForm
            .validateFields()
            .catch((): Partial<SampleQueryValues> => ({})));
        const p = new URLSearchParams();
        // 样品查询仅查看已交样记录，不显示未交样品
        p.set("status", "DELIVERED");
        const range = v.dateRange;
        if (range?.[0]) p.set("from", range[0].startOf("day").toISOString());
        if (range?.[1]) p.set("to", range[1].endOf("day").toISOString());
        if (v.customerId) p.set("customerId", String(v.customerId));
        if (v.trackingNo) p.set("trackingNo", String(v.trackingNo).trim());
        if (v.keyword) p.set("keyword", String(v.keyword).trim());
        const data = await fetchJson<{ list: SampleRow[] }>(
          `/api/samples${p.toString() ? `?${p.toString()}` : ""}`,
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
    [message, queryForm],
  );

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    if (tab === "add") void loadToday();
  }, [tab, loadToday]);

  useEffect(() => {
    if (tab === "open") void loadOpen();
  }, [tab, loadOpen]);

  useEffect(() => {
    if (tab === "query") void loadQuery({});
  }, [tab, loadQuery]);

  const submitCreate = async () => {
    const v = await createForm.validateFields();
    setSubmitting(true);
    try {
      await fetchJson("/api/samples", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: v.customerId,
          model: v.model,
          materialNames: v.materialNames,
          quantity: v.quantity,
          sampleDueAt: v.sampleDueAt.startOf("day").toISOString(),
          remark: v.remark,
        }),
      });
      message.success("已创建样品记录");
      createForm.resetFields();
      createForm.setFieldsValue({ quantity: 1 });
      await Promise.all([loadToday(), loadOpen()]);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (r: SampleRow) => {
    setEditing(r);
    editForm.setFieldsValue({
      customerId: r.customerId,
      model: r.model,
      materialNames: r.materialNames,
      quantity: r.quantity,
      sampleDueAt: dayjs(r.sampleDueAt),
      remark: r.remark ?? undefined,
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!editing) return;
    const v = await editForm.validateFields();
    setSubmitting(true);
    try {
      await fetchJson(`/api/samples/${editing.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: v.customerId,
          model: v.model,
          materialNames: v.materialNames,
          quantity: v.quantity,
          sampleDueAt: v.sampleDueAt.startOf("day").toISOString(),
          remark: v.remark,
        }),
      });
      message.success("已保存");
      setEditOpen(false);
      setEditing(null);
      await Promise.all([loadToday(), loadOpen(), loadQuery({})]);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  const openDeliver = (r: SampleRow) => {
    setDelivering(r);
    deliverForm.setFieldsValue({
      deliveredQuantity: r.quantity,
      trackingNo: "",
    });
    setDeliverOpen(true);
  };

  const submitDeliver = async () => {
    if (!delivering) return;
    const v = await deliverForm.validateFields();
    try {
      await fetchJson(`/api/samples/${delivering.id}/deliver`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveredQuantity: v.deliveredQuantity,
          trackingNo: v.trackingNo,
        }),
      });
      message.success("已确认交样");
      setDeliverOpen(false);
      setDelivering(null);
      await Promise.all([loadToday(), loadOpen(), loadQuery({})]);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const deleteSample = (r: SampleRow) => {
    modal.confirm({
      title: "确认删除该样品记录？",
      okType: "danger",
      onOk: async () => {
        try {
          await fetchJson(`/api/samples/${r.id}`, {
            method: "DELETE",
            credentials: "include",
          });
          message.success("已删除");
          await Promise.all([loadToday(), loadOpen(), loadQuery({})]);
        } catch (e) {
          message.error(e instanceof Error ? e.message : "删除失败");
        }
      },
    });
  };

  const baseColumns: ColumnsType<SampleRow> = [
    {
      title: "客户名称",
      key: "customer",
      width: 160,
      ellipsis: true,
      render: (_, r) => `${r.customer.code} ${r.customer.name}`,
    },
    { title: "型号", dataIndex: "model", width: 150, ellipsis: true },
    {
      title: "包含物料名称",
      dataIndex: "materialNames",
      ellipsis: true,
      render: (v: string) => (
        <Typography.Text style={{ whiteSpace: "pre-line" }}>{v}</Typography.Text>
      ),
    },
    { title: "数量", dataIndex: "quantity", width: 80, align: "right" },
    {
      title: "交样日期",
      dataIndex: "sampleDueAt",
      width: 120,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD"),
    },
    {
      title: "距交样",
      key: "due",
      width: 110,
      render: (_, r) =>
        r.status === "PENDING" ? sampleDueDayLabel(r.sampleDueAt) : "已交样",
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 88,
      render: (s: SampleRow["status"]) => statusText(s),
    },
    {
      title: "运单号",
      dataIndex: "trackingNo",
      width: 150,
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "创建日期",
      dataIndex: "createdAt",
      width: 150,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm"),
    },
    { title: "备注", dataIndex: "remark", width: 160, ellipsis: true, render: (v: string | null) => v ?? "—" },
  ];

  const actionColumn: ColumnsType<SampleRow>[number] = {
    title: "操作",
    key: "op",
    fixed: "right",
    width: 190,
    render: (_, r) => (
      <Space size="small">
        {r.status === "PENDING" ? (
          <Button type="link" size="small" onClick={() => openDeliver(r)}>
            确认交样
          </Button>
        ) : null}
        <Button type="link" size="small" onClick={() => openEdit(r)}>
          编辑
        </Button>
        <Button type="link" size="small" danger onClick={() => deleteSample(r)}>
          删除
        </Button>
      </Space>
    ),
  };

  const sampleTable = (
    rows: SampleRow[],
    loading: boolean,
    emptyText: string,
    withActions = true,
  ) => {
    const cols = withActions ? [...baseColumns, actionColumn] : baseColumns;
    const resizedCols = attachResizeSampleList(
      cols,
      sampleColWidths,
      setSampleColWidths,
      DEFAULT_SAMPLE_LIST_WIDTH,
    );
    return (
      <Table<SampleRow>
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={resizedCols}
        scroll={{ x: "max-content" }}
        pagination={{ defaultPageSize: 10, showSizeChanger: true }}
        locale={{ emptyText }}
        tableLayout="fixed"
        components={{
          header: { cell: ResizableTableTitle },
        }}
      />
    );
  };

  const sampleForm = (form: typeof createForm) => (
    <Form form={form} layout="vertical" initialValues={{ quantity: 1 }}>
      <Form.Item
        name="customerId"
        label="客户名称"
        rules={[{ required: true, message: "请选择客户" }]}
      >
        <Select
          showSearch
          loading={loadingCustomers}
          options={customerOptions}
          optionFilterProp="label"
          placeholder="选择客户"
        />
      </Form.Item>
      <Form.Item
        name="model"
        label="型号"
        rules={[{ required: true, message: "请填写型号" }]}
      >
        <Input allowClear placeholder="手动输入型号" />
      </Form.Item>
      <Form.Item
        name="materialNames"
        label="包含物料名称"
        rules={[{ required: true, message: "请填写包含物料名称" }]}
      >
        <Input.TextArea
          rows={4}
          allowClear
          placeholder="手动输入，可多行；与物料档案无关联"
        />
      </Form.Item>
      <Space wrap align="start">
        <Form.Item
          name="quantity"
          label="数量"
          rules={[{ required: true, message: "请填写数量" }]}
        >
          <InputNumber min={1} precision={0} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item
          name="sampleDueAt"
          label="交样日期"
          rules={[{ required: true, message: "请选择交样日期" }]}
        >
          <DatePicker style={{ width: 180 }} />
        </Form.Item>
      </Space>
      <Form.Item name="remark" label="备注">
        <Input.TextArea rows={2} allowClear />
      </Form.Item>
    </Form>
  );

  return (
    <Card title="样品详情">
      {tabPermLoading ? (
        <div style={{ padding: 56, textAlign: "center" }}>
          <Typography.Text type="secondary">加载权限中…</Typography.Text>
        </div>
      ) : visibleSampleTabKeys.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          当前账号无可用的样品详情 TAB，请联系管理员在「员工管理 → 权限管理」中勾选对应 TAB。
        </Typography.Paragraph>
      ) : (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: "add",
              label: "新增样品",
              forceRender: true,
              children: (
                <Space direction="vertical" size="large" style={{ width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
                    <HelpTip text="样品记录为独立台账；除客户名称外，型号、包含物料名称等字段均为手工记录，不关联商品信息或物料信息。" />
                  </div>
                  <div style={{ maxWidth: 720 }}>
                    {sampleForm(createForm)}
                    <Space>
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        loading={submitting}
                        onClick={() => void submitCreate()}
                      >
                        新增样品
                      </Button>
                      <Button
                        onClick={() => createForm.resetFields()}
                        disabled={submitting}
                      >
                        重置
                      </Button>
                    </Space>
                  </div>
                  <div>
                    <Space style={{ marginBottom: 8 }}>
                      <Typography.Text strong>今日创建样品</Typography.Text>
                      <Button size="small" onClick={() => void loadToday()}>
                        刷新
                      </Button>
                    </Space>
                    {sampleTable(todayRows, loadingToday, "今日尚无样品记录")}
                  </div>
                </Space>
              ),
            },
            {
              key: "open",
              label: "未交样品",
              forceRender: true,
              children: (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Button onClick={() => void loadOpen()}>刷新</Button>
                  {sampleTable(openRows, loadingOpen, "暂无未交样品")}
                </Space>
              ),
            },
            {
              key: "query",
              label: "样品查询",
              forceRender: true,
              children: (
                <Space direction="vertical" style={{ width: "100%" }} size="middle">
                  <Form form={queryForm} layout="inline">
                    <Form.Item name="dateRange" label="交样日期">
                      <DatePicker.RangePicker />
                    </Form.Item>
                    <Form.Item name="customerId" label="客户">
                      <Select
                        allowClear
                        showSearch
                        loading={loadingCustomers}
                        options={customerOptions}
                        optionFilterProp="label"
                        placeholder="全部"
                        style={{ minWidth: 220 }}
                      />
                    </Form.Item>
                    <Form.Item name="keyword" label="关键字">
                      <Input allowClear placeholder="型号/物料/备注" />
                    </Form.Item>
                    <Form.Item name="trackingNo" label="运单号">
                      <Input allowClear placeholder="输入运单号" />
                    </Form.Item>
                    <Form.Item>
                      <Space>
                        <Button type="primary" onClick={() => void loadQuery()}>
                          查询
                        </Button>
                        <Button
                          onClick={() => {
                            queryForm.resetFields();
                            void loadQuery({});
                          }}
                        >
                          重置
                        </Button>
                      </Space>
                    </Form.Item>
                  </Form>
                  {sampleTable(queryRows, loadingQuery, "暂无已交样品记录")}
                </Space>
              ),
            },
          ].filter((item) => {
            const code = SAMPLE_TAB_PERM[String(item.key)];
            return code ? allowed([code]) : false;
          })}
        />
      )}

      <Modal
        title="编辑样品"
        open={editOpen}
        onCancel={() => {
          setEditOpen(false);
          setEditing(null);
        }}
        okText="保存"
        onOk={() => void submitEdit()}
        confirmLoading={submitting}
        destroyOnHidden
        forceRender
        width={720}
      >
        {sampleForm(editForm)}
      </Modal>

      <Modal
        title={delivering ? `确认交样 — ${delivering.model}` : "确认交样"}
        open={deliverOpen}
        onCancel={() => {
          setDeliverOpen(false);
          setDelivering(null);
        }}
        okText="确定并结单"
        onOk={() => void submitDeliver()}
        destroyOnHidden
      >
        <Form form={deliverForm} layout="vertical">
          <Form.Item
            name="deliveredQuantity"
            label="交样数量"
            rules={[
              { required: true, message: "请填写交样数量" },
              { type: "number", min: 1, message: "交样数量必须大于 0" },
            ]}
          >
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="trackingNo"
            label="运单号"
            rules={[{ required: true, message: "请填写运单号" }]}
          >
            <Input allowClear maxLength={64} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}