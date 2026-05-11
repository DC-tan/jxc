"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Checkbox,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";

type KindRow = { id: string; name: string; prefix: string; sortOrder: number };
type NameRow = { id: string; name: string; namePrefix: string; sortOrder: number };
type BrandRow = { id: string; name: string; sortOrder: number };
type UnitRow = { id: string; name: string; isDefault: boolean; sortOrder: number };
type CodeRuleRow = {
  id: string;
  presetKindId: string;
  presetNameId: string;
  namePrefix: string;
  startNumber: number;
  nextNumber: number;
  presetKind: { id: string; name: string; prefix: string };
  presetName: { id: string; name: string; namePrefix: string };
};

type Bundle = {
  kinds: KindRow[];
  names: NameRow[];
  brands: BrandRow[];
  units: UnitRow[];
  codeRules: CodeRuleRow[];
};

export function MaterialSettingsTab() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [bundle, setBundle] = useState<Bundle | null>(null);

  const [kindModal, setKindModal] = useState<null | { mode: "create" | "edit"; row?: KindRow }>(null);
  const [nameModal, setNameModal] = useState<null | { mode: "create" | "edit"; row?: NameRow }>(null);
  const [brandModal, setBrandModal] = useState<null | { mode: "create" | "edit"; row?: BrandRow }>(null);
  const [unitModal, setUnitModal] = useState<null | { mode: "create" | "edit"; row?: UnitRow }>(null);
  const [ruleModal, setRuleModal] = useState<null | { mode: "create" | "edit"; row?: CodeRuleRow }>(null);

  const [kindForm] = Form.useForm();
  const [nameForm] = Form.useForm();
  const [brandForm] = Form.useForm();
  const [unitForm] = Form.useForm();
  const [ruleForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<Bundle>("/api/material-presets", {
        credentials: "include",
      });
      setBundle(data);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const kindColumns: ColumnsType<KindRow> = [
    { title: "种类名称", dataIndex: "name", ellipsis: true },
    { title: "种类前缀", dataIndex: "prefix", width: 120, render: (v: string) => v || "—" },
    { title: "排序", dataIndex: "sortOrder", width: 80 },
    {
      title: "操作",
      key: "op",
      width: 160,
      render: (_, r) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setKindModal({ mode: "edit", row: r });
              kindForm.setFieldsValue(r);
            }}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              Modal.confirm({
                title: "删除该种类？",
                onOk: async () => {
                  try {
                    await fetchJson(`/api/material-presets/kinds/${r.id}`, {
                      method: "DELETE",
                      credentials: "include",
                    });
                    message.success("已删除");
                    await load();
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : "删除失败");
                  }
                },
              });
            }}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const nameColumns: ColumnsType<NameRow> = [
    { title: "物料名称", dataIndex: "name", ellipsis: true },
    {
      title: "物料前缀",
      dataIndex: "namePrefix",
      width: 100,
      render: (v: string) => v || "—",
    },
    { title: "排序", dataIndex: "sortOrder", width: 80 },
    {
      title: "操作",
      key: "op",
      width: 160,
      render: (_, r) => (
        <Space>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setNameModal({ mode: "edit", row: r });
              nameForm.setFieldsValue(r);
            }}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: "删除该物料名称？",
                onOk: async () => {
                  try {
                    await fetchJson(`/api/material-presets/names/${r.id}`, {
                      method: "DELETE",
                      credentials: "include",
                    });
                    message.success("已删除");
                    await load();
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : "删除失败");
                  }
                },
              });
            }}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const brandColumns: ColumnsType<BrandRow> = [
    { title: "品牌", dataIndex: "name", ellipsis: true },
    { title: "排序", dataIndex: "sortOrder", width: 80 },
    {
      title: "操作",
      key: "op",
      width: 160,
      render: (_, r) => (
        <Space>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setBrandModal({ mode: "edit", row: r });
              brandForm.setFieldsValue(r);
            }}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: "删除该品牌？",
                onOk: async () => {
                  try {
                    await fetchJson(`/api/material-presets/brands/${r.id}`, {
                      method: "DELETE",
                      credentials: "include",
                    });
                    message.success("已删除");
                    await load();
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : "删除失败");
                  }
                },
              });
            }}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const unitColumns: ColumnsType<UnitRow> = [
    { title: "单位", dataIndex: "name", ellipsis: true },
    {
      title: "默认",
      dataIndex: "isDefault",
      width: 80,
      render: (v: boolean) => (v ? "是" : "—"),
    },
    { title: "排序", dataIndex: "sortOrder", width: 80 },
    {
      title: "操作",
      key: "op",
      width: 160,
      render: (_, r) => (
        <Space>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setUnitModal({ mode: "edit", row: r });
              unitForm.setFieldsValue(r);
            }}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: "删除该单位？",
                onOk: async () => {
                  try {
                    await fetchJson(`/api/material-presets/units/${r.id}`, {
                      method: "DELETE",
                      credentials: "include",
                    });
                    message.success("已删除");
                    await load();
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : "删除失败");
                  }
                },
              });
            }}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const ruleColumns: ColumnsType<CodeRuleRow> = [
    {
      title: "物料种类",
      key: "kn",
      render: (_, r) => r.presetKind.name,
    },
    {
      title: "物料名称",
      key: "nn",
      render: (_, r) => r.presetName.name,
    },
    { title: "名称前缀", dataIndex: "namePrefix", width: 100 },
    { title: "起始号", dataIndex: "startNumber", width: 80 },
    { title: "下一号", dataIndex: "nextNumber", width: 80 },
    {
      title: "操作",
      key: "op",
      width: 180,
      render: (_, r) => (
        <Space wrap>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setRuleModal({ mode: "edit", row: r });
              ruleForm.setFieldsValue({
                namePrefix: r.namePrefix,
                startNumber: r.startNumber,
                nextNumber: r.nextNumber,
              });
            }}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: "删除该编号规则？",
                onOk: async () => {
                  try {
                    await fetchJson(`/api/material-presets/code-rules/${r.id}`, {
                      method: "DELETE",
                      credentials: "include",
                    });
                    message.success("已删除");
                    await load();
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : "删除失败");
                  }
                },
              });
            }}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const submitKind = async () => {
    const v = await kindForm.validateFields();
    try {
      if (kindModal?.mode === "create") {
        await fetchJson("/api/material-presets/kinds", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        });
      } else if (kindModal?.row) {
        await fetchJson(`/api/material-presets/kinds/${kindModal.row.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        });
      }
      message.success("已保存");
      setKindModal(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  const submitName = async () => {
    const v = await nameForm.validateFields();
    try {
      if (nameModal?.mode === "create") {
        await fetchJson("/api/material-presets/names", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        });
      } else if (nameModal?.row) {
        await fetchJson(`/api/material-presets/names/${nameModal.row.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        });
      }
      message.success("已保存");
      setNameModal(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  const submitBrand = async () => {
    const v = await brandForm.validateFields();
    try {
      if (brandModal?.mode === "create") {
        await fetchJson("/api/material-presets/brands", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        });
      } else if (brandModal?.row) {
        await fetchJson(`/api/material-presets/brands/${brandModal.row.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        });
      }
      message.success("已保存");
      setBrandModal(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  const submitUnit = async () => {
    const v = await unitForm.validateFields();
    try {
      if (unitModal?.mode === "create") {
        await fetchJson("/api/material-presets/units", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        });
      } else if (unitModal?.row) {
        await fetchJson(`/api/material-presets/units/${unitModal.row.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        });
      }
      message.success("已保存");
      setUnitModal(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  const submitRule = async () => {
    const v = await ruleForm.validateFields();
    try {
      if (ruleModal?.mode === "create") {
        await fetchJson("/api/material-presets/code-rules", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        });
      } else if (ruleModal?.row) {
        await fetchJson(`/api/material-presets/code-rules/${ruleModal.row.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        });
      }
      message.success("已保存");
      setRuleModal(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  if (!bundle && loading) {
    return <Typography.Text type="secondary">加载中…</Typography.Text>;
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        在此维护物料种类、物料名称、品牌、单位；并为「种类 + 物料名称」配置编号规则（种类前缀在种类表中维护）。新建物料时将按规则生成编号，格式为：
        <strong>种类前缀-名称前缀-四位序号</strong>（如 DZL-R-0001）。若仅需改已有物料编号，请在「新增物料」列表中编辑。
      </Typography.Paragraph>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <div>
            <Space style={{ marginBottom: 8 }}>
              <Typography.Title level={5} style={{ margin: 0 }}>
                物料种类
              </Typography.Title>
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => {
                  kindForm.resetFields();
                  setKindModal({ mode: "create" });
                }}
              >
                新增
              </Button>
            </Space>
            <Table<KindRow>
              rowKey="id"
              size="small"
              loading={loading}
              columns={kindColumns}
              dataSource={bundle?.kinds ?? []}
              pagination={false}
            />
          </div>
        </Col>
        <Col xs={24} lg={12}>
          <div>
            <Space style={{ marginBottom: 8 }}>
              <Typography.Title level={5} style={{ margin: 0 }}>
                物料名称
              </Typography.Title>
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => {
                  nameForm.resetFields();
                  setNameModal({ mode: "create" });
                }}
              >
                新增
              </Button>
            </Space>
            <Table<NameRow>
              rowKey="id"
              size="small"
              loading={loading}
              columns={nameColumns}
              dataSource={bundle?.names ?? []}
              pagination={false}
            />
          </div>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <div>
            <Space style={{ marginBottom: 8 }}>
              <Typography.Title level={5} style={{ margin: 0 }}>
                品牌
              </Typography.Title>
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => {
                  brandForm.resetFields();
                  setBrandModal({ mode: "create" });
                }}
              >
                新增
              </Button>
            </Space>
            <Table<BrandRow>
              rowKey="id"
              size="small"
              loading={loading}
              columns={brandColumns}
              dataSource={bundle?.brands ?? []}
              pagination={false}
            />
          </div>
        </Col>
        <Col xs={24} lg={12}>
          <div>
            <Space style={{ marginBottom: 8 }}>
              <Typography.Title level={5} style={{ margin: 0 }}>
                单位
              </Typography.Title>
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => {
                  unitForm.resetFields();
                  setUnitModal({ mode: "create" });
                }}
              >
                新增
              </Button>
            </Space>
            <Table<UnitRow>
              rowKey="id"
              size="small"
              loading={loading}
              columns={unitColumns}
              dataSource={bundle?.units ?? []}
              pagination={false}
            />
          </div>
        </Col>
      </Row>

      <div>
        <Space style={{ marginBottom: 8 }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            编号规则（种类 + 物料名称）
          </Typography.Title>
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              ruleForm.resetFields();
              ruleForm.setFieldsValue({ startNumber: 1 });
              setRuleModal({ mode: "create" });
            }}
          >
            新增规则
          </Button>
        </Space>
        <Table<CodeRuleRow>
          rowKey="id"
          size="small"
          loading={loading}
          columns={ruleColumns}
          dataSource={bundle?.codeRules ?? []}
          pagination={false}
          scroll={{ x: 720 }}
        />
      </div>

      <Modal
        title={kindModal?.mode === "create" ? "新增种类" : "编辑种类"}
        open={!!kindModal}
        onCancel={() => setKindModal(null)}
        onOk={() => void submitKind()}
        destroyOnHidden
      >
        <Form form={kindForm} layout="vertical">
          <Form.Item name="name" label="种类名称" rules={[{ required: true }]}>
            <Input placeholder="如 电子料" />
          </Form.Item>
          <Form.Item name="prefix" label="种类前缀" rules={[{ required: true, message: "请填写种类前缀" }]}>
            <Input placeholder="如 DZL" />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={nameModal?.mode === "create" ? "新增物料名称" : "编辑物料名称"}
        open={!!nameModal}
        onCancel={() => setNameModal(null)}
        onOk={() => void submitName()}
        destroyOnHidden
      >
        <Form form={nameForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="如 电阻" />
          </Form.Item>
          <Form.Item name="namePrefix" label="物料前缀">
            <Input placeholder="编号中的名称段，如 R、C（可选）" allowClear />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={brandModal?.mode === "create" ? "新增品牌" : "编辑品牌"}
        open={!!brandModal}
        onCancel={() => setBrandModal(null)}
        onOk={() => void submitBrand()}
        destroyOnHidden
      >
        <Form form={brandForm} layout="vertical">
          <Form.Item name="name" label="品牌" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={unitModal?.mode === "create" ? "新增单位" : "编辑单位"}
        open={!!unitModal}
        onCancel={() => setUnitModal(null)}
        onOk={() => void submitUnit()}
        destroyOnHidden
      >
        <Form form={unitForm} layout="vertical">
          <Form.Item name="name" label="单位" rules={[{ required: true }]}>
            <Input placeholder="如 PCS" />
          </Form.Item>
          <Form.Item name="isDefault" valuePropName="checked">
            <Checkbox>作为默认单位（新建物料默认选此项）</Checkbox>
          </Form.Item>
          <Form.Item name="sortOrder" label="排序">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={ruleModal?.mode === "create" ? "新增编号规则" : "编辑编号规则"}
        open={!!ruleModal}
        onCancel={() => setRuleModal(null)}
        onOk={() => void submitRule()}
        destroyOnHidden
        width={520}
      >
        <Form form={ruleForm} layout="vertical">
          {ruleModal?.mode === "create" ? (
            <>
              <Form.Item
                name="presetKindId"
                label="物料种类"
                rules={[{ required: true, message: "请选择" }]}
              >
                <Select
                  placeholder="选择种类"
                  options={(bundle?.kinds ?? []).map((k) => ({
                    value: k.id,
                    label: `${k.name}（前缀 ${k.prefix || "未设"}）`,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="presetNameId"
                label="物料名称"
                rules={[{ required: true, message: "请选择" }]}
              >
                <Select
                  placeholder="选择物料名称"
                  options={(bundle?.names ?? []).map((n) => ({
                    value: n.id,
                    label: n.name,
                  }))}
                  onChange={(id) => {
                    const n = bundle?.names.find((x) => x.id === id);
                    if (n?.namePrefix) {
                      ruleForm.setFieldsValue({ namePrefix: n.namePrefix });
                    }
                  }}
                />
              </Form.Item>
              <Form.Item
                name="namePrefix"
                label="名称前缀"
                rules={[{ required: true, message: "如 电阻填 R" }]}
              >
                <Input placeholder="如 R" />
              </Form.Item>
              <Form.Item
                name="startNumber"
                label="起始号"
                rules={[{ required: true }]}
                initialValue={1}
              >
                <InputNumber min={1} style={{ width: "100%" }} />
              </Form.Item>
            </>
          ) : (
            <>
              <Typography.Paragraph type="secondary">
                {ruleModal?.row
                  ? `${ruleModal.row.presetKind.name} + ${ruleModal.row.presetName.name}`
                  : null}
              </Typography.Paragraph>
              <Form.Item name="namePrefix" label="名称前缀" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="startNumber" label="起始号（记录用）">
                <InputNumber min={1} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="nextNumber" label="下一分配序号">
                <InputNumber min={1} style={{ width: "100%" }} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </Space>
  );
}
