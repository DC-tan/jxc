"use client";

import {
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlusOutlined } from "@ant-design/icons";
import { fetchJson } from "@/lib/fetch-json";

type Row = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  materialType: string | null;
  level: string | null;
  contactPerson: string | null;
  phone: string | null;
  address: string | null;
  bankName: string | null;
  bankAccount: string | null;
  taxRegistrationNo: string | null;
  deliveryLeadDays: number | null;
  attrProduction: boolean;
  attrProcessing: boolean;
};

export function SuppliersPage() {
  const { message, modal } = App.useApp();
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
      const data = await fetchJson<{ list: Row[] }>("/api/suppliers", {
        credentials: "include",
      });
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
    { title: "供应商编号", dataIndex: "code", width: 140 },
    { title: "名称", dataIndex: "name", width: 200 },
    {
      title: "属性",
      key: "attr",
      width: 120,
      render: (_: unknown, r: Row) => (
        <Space size={4} wrap>
          {r.attrProduction ? <Tag color="blue">生产</Tag> : null}
          {r.attrProcessing ? <Tag color="orange">加工</Tag> : null}
          {!r.attrProduction && !r.attrProcessing ? (
            <Typography.Text type="secondary">—</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "简称",
      dataIndex: "shortName",
      width: 120,
      ellipsis: true,
      render: (t: string | null) => t?.trim() || "—",
    },
    { title: "联系人", dataIndex: "contactPerson", width: 100, ellipsis: true },
    { title: "电话", dataIndex: "phone", width: 120, ellipsis: true },
    { title: "主供物料类型", dataIndex: "materialType", ellipsis: true },
    { title: "供应商等级", dataIndex: "level", width: 100 },
    {
      title: "交货天数",
      dataIndex: "deliveryLeadDays",
      width: 96,
      render: (n: number | null) =>
        n != null && Number.isFinite(n) ? `${n} 天` : "—",
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
    setOpen(true);
  };

  const openEdit = (r: Row) => {
    setEditing(r);
    setOpen(true);
  };

  const openSupplierIdQ = searchParams.get("openSupplierId");
  const supplierLinkDone = useRef(false);
  useEffect(() => {
    if (!openSupplierIdQ) {
      supplierLinkDone.current = false;
      return;
    }
    if (loading) return;
    if (supplierLinkDone.current) return;
    const r = rows.find((x) => x.id === openSupplierIdQ);
    supplierLinkDone.current = true;
    if (r) openEdit(r);
    else message.warning("未找到该供应商或无权查看");
    router.replace(pathname, { scroll: false });
  }, [openSupplierIdQ, loading, rows, pathname, router, message]);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({
        code: editing.code,
        name: editing.name,
        shortName: editing.shortName,
        materialType: editing.materialType,
        level: editing.level,
        contactPerson: editing.contactPerson,
        phone: editing.phone,
        address: editing.address,
        bankName: editing.bankName,
        bankAccount: editing.bankAccount,
        taxRegistrationNo: editing.taxRegistrationNo,
        deliveryLeadDays: editing.deliveryLeadDays ?? undefined,
        attrProduction: editing.attrProduction,
        attrProcessing: editing.attrProcessing,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        attrProduction: true,
        attrProcessing: false,
      });
    }
  }, [open, editing, form]);

  const onDelete = (r: Row) => {
    modal.confirm({
      title: "确认删除该供应商？",
      okType: "danger",
      onOk: async () => {
        try {
          await fetchJson(`/api/suppliers/${r.id}`, {
            method: "DELETE",
            credentials: "include",
          });
          message.success("已删除");
          await load();
        } catch (e) {
          message.error(e instanceof Error ? e.message : "删除失败");
          throw e;
        }
      },
    });
  };

  const submit = async () => {
    try {
      const v = await form.validateFields();
      const payload = {
        ...v,
        attrProduction: Boolean(v.attrProduction),
        attrProcessing: Boolean(v.attrProcessing),
      };
      if (!editing) {
        await fetchJson("/api/suppliers", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        message.success("已创建");
      } else {
        await fetchJson(`/api/suppliers/${editing.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        message.success("已保存");
      }
      setOpen(false);
      await load();
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
      throw e;
    }
  };

  return (
    <Card title="供应商信息">
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增供应商
        </Button>
        <Typography.Text type="secondary">
          供应商等级可用文字自定义，例如：优 / 良 / 一般
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
        title={editing ? "编辑供应商" : "新增供应商"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => submit()}
        width={720}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ attrProduction: true, attrProcessing: false }}
        >
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item
                name="code"
                label="供应商编号"
                rules={[{ required: true, message: "请填写供应商编号" }]}
              >
                <Input disabled={!!editing} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={14}>
              <Form.Item
                name="name"
                label="名称"
                rules={[{ required: true, message: "请填写名称" }]}
              >
                <Input placeholder="供应商名称" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={10}>
              <Form.Item
                label="属性"
                tooltip="勾选「加工」后，该供应商会出现在「物料外发 → 新增外发订单」的加工方下拉框中。"
              >
                <Space size={12}>
                  <Form.Item
                    name="attrProduction"
                    valuePropName="checked"
                    noStyle
                  >
                    <Checkbox>生产</Checkbox>
                  </Form.Item>
                  <Form.Item
                    name="attrProcessing"
                    valuePropName="checked"
                    noStyle
                  >
                    <Checkbox>加工</Checkbox>
                  </Form.Item>
                </Space>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="shortName" label="简称">
                <Input allowClear placeholder="可选" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="contactPerson" label="联系人">
                <Input allowClear placeholder="可选" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="phone" label="电话">
                <Input allowClear placeholder="可选" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="materialType" label="主供物料类型">
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="address" label="地址">
                <Input.TextArea rows={2} allowClear placeholder="可选" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="bankName" label="开户银行">
                <Input allowClear placeholder="可选" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="bankAccount" label="帐号">
                <Input allowClear placeholder="可选" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="taxRegistrationNo" label="税务登记号">
                <Input allowClear placeholder="可选" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="level" label="供应商等级">
                <Input placeholder="例如：A级、战略合作等" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item
                name="deliveryLeadDays"
                label="交货天数"
                tooltip="新建采购单时，系统按「订单生成日 + 交货天数」计算该单的「交货时间」（自然日）。留空表示不自动计算。"
              >
                <InputNumber
                  min={0}
                  max={3650}
                  precision={0}
                  style={{ width: "100%" }}
                  placeholder="可选，如 10 表示下单日起第 10 个自然日为交货日"
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </Card>
  );
}
