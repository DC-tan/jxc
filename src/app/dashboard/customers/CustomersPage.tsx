"use client";

import {
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlusOutlined } from "@ant-design/icons";
import {
  CUSTOMER_QUALITY_LABEL,
  type CustomerQuality,
} from "@/lib/labels";

type Row = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  contactPerson: string | null;
  phone: string | null;
  address: string | null;
  mainProduct: string | null;
  quality: CustomerQuality;
  priceIncludesTax: boolean;
};

const qualityOptions = (Object.keys(CUSTOMER_QUALITY_LABEL) as CustomerQuality[]).map(
  (k) => ({ value: k, label: CUSTOMER_QUALITY_LABEL[k] }),
);

export function CustomersPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/customers", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "加载失败");
      setRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnsType<Row> = [
    { title: "客户编号", dataIndex: "code", width: 120 },
    { title: "客户全称", dataIndex: "name", width: 180, ellipsis: true },
    {
      title: "简称",
      dataIndex: "shortName",
      width: 100,
      ellipsis: true,
      render: (t: string | null) => t?.trim() || "—",
    },
    {
      title: "联系人",
      dataIndex: "contactPerson",
      width: 96,
      ellipsis: true,
      render: (t: string | null) => t?.trim() || "—",
    },
    {
      title: "联系电话",
      dataIndex: "phone",
      width: 140,
      ellipsis: true,
      render: (t: string | null) => t?.trim() || "—",
    },
    {
      title: "地址",
      dataIndex: "address",
      ellipsis: true,
      render: (t: string | null) => t?.trim() || "—",
    },
    { title: "客户主营产品", dataIndex: "mainProduct", ellipsis: true },
    {
      title: "客户质量等级",
      dataIndex: "quality",
      width: 120,
      render: (v: CustomerQuality) => CUSTOMER_QUALITY_LABEL[v],
    },
    {
      title: "操作",
      key: "a",
      width: 160,
      render: (_, r) => (
        <Space>
          <Button type="link" onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Button type="link" danger onClick={() => onDelete(r)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ quality: "MEDIUM", priceIncludesTax: false });
    setOpen(true);
  };

  const openEdit = (r: Row) => {
    setEditing(r);
    form.setFieldsValue({
      code: r.code,
      name: r.name,
      shortName: r.shortName,
      contactPerson: r.contactPerson,
      phone: r.phone,
      address: r.address,
      mainProduct: r.mainProduct,
      quality: r.quality,
      priceIncludesTax: r.priceIncludesTax,
    });
    setOpen(true);
  };

  const openCustomerIdQ = searchParams.get("openCustomerId");
  const customerLinkDone = useRef(false);
  useEffect(() => {
    if (!openCustomerIdQ) {
      customerLinkDone.current = false;
      return;
    }
    if (loading) return;
    if (customerLinkDone.current) return;
    const r = rows.find((x) => x.id === openCustomerIdQ);
    customerLinkDone.current = true;
    if (r) openEdit(r);
    else message.warning("未找到该客户或无权查看");
    router.replace(pathname, { scroll: false });
  }, [openCustomerIdQ, loading, rows, pathname, router, message]);

  const onDelete = (r: Row) => {
    Modal.confirm({
      title: "确认删除该客户？",
      okType: "danger",
      onOk: async () => {
        const res = await fetch(`/api/customers/${r.id}`, {
          method: "DELETE",
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) {
          message.error(data.error ?? "删除失败");
          return;
        }
        message.success("已删除");
        await load();
      },
    });
  };

  const submit = async () => {
    const v = await form.validateFields();
    try {
      if (!editing) {
        const res = await fetch("/api/customers", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "创建失败");
        message.success("已创建");
      } else {
        const res = await fetch(`/api/customers/${editing.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "保存失败");
        message.success("已保存");
      }
      setOpen(false);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  return (
    <Card title="客户信息">
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增客户
        </Button>
        <Typography.Text type="secondary">
          质量等级：高 / 中 / 低 / 差
        </Typography.Text>
      </Space>
      <Table<Row>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title={editing ? "编辑客户" : "新增客户"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        width={760}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="name"
                label="客户全称"
                rules={[{ required: true, message: "请填写客户全称" }]}
              >
                <Input placeholder="营业执照或正式名称" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="shortName" label="客户简称">
                <Input allowClear placeholder="可选" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="contactPerson" label="客户联系人">
                <Input allowClear placeholder="可选" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="phone" label="联系人电话">
                <Input allowClear placeholder="可选" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item name="address" label="地址">
                <Input.TextArea rows={2} allowClear placeholder="可选" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="priceIncludesTax"
                label="标价"
                tooltip="勾选「含税」时，销售单价按含税价录入；统计利润时按 ÷1.13 折成未税再算收入。"
              >
                <Radio.Group>
                  <Radio value={false}>未税</Radio>
                  <Radio value={true}>含税</Radio>
                </Radio.Group>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="code"
                label="客户编号"
                rules={[{ required: true, message: "请填写客户编号" }]}
              >
                <Input disabled={!!editing} placeholder="唯一编号" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="mainProduct" label="客户主营产品">
                <Input allowClear placeholder="可选" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="quality"
                label="客户质量等级"
                rules={[{ required: true, message: "请选择质量等级" }]}
              >
                <Select options={qualityOptions} placeholder="请选择" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </Card>
  );
}
