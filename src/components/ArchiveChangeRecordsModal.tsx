"use client";

import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Space,
  Table,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";

export type ArchiveChangeKind = "VERSION" | "PRICE";

type ChangeRow = {
  id: string;
  kind: ArchiveChangeKind;
  changedAt: string;
  beforeText: string;
  afterText: string;
  reason: string | null;
  createdAt: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  targetType: "PRODUCT" | "MATERIAL";
  targetId: string | null;
  kind: ArchiveChangeKind;
  subjectLabel?: string;
  canEdit: boolean;
};

function kindTitle(kind: ArchiveChangeKind) {
  return kind === "VERSION" ? "版本变更记录" : "价格变更记录";
}

function apiBase(targetType: "PRODUCT" | "MATERIAL", targetId: string) {
  return targetType === "PRODUCT"
    ? `/api/products/${targetId}/change-records`
    : `/api/materials/${targetId}/change-records`;
}

export function ArchiveChangeRecordsModal({
  open,
  onClose,
  targetType,
  targetId,
  kind,
  subjectLabel,
  canEdit,
}: Props) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    if (!targetId) return;
    setLoading(true);
    try {
      const data = await fetchJson<{ list: ChangeRow[] }>(
        `${apiBase(targetType, targetId)}?kind=${kind}`,
        { credentials: "include" },
      );
      setRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [kind, message, targetId, targetType]);

  useEffect(() => {
    if (!open || !targetId) return;
    form.resetFields();
    form.setFieldsValue({
      changedAt: dayjs(),
      beforeText: "",
      afterText: "",
      reason: "",
    });
    void load();
  }, [form, load, open, targetId]);

  const onOk = async () => {
    if (!canEdit || !targetId) {
      onClose();
      return;
    }
    const v = form.getFieldsValue() as {
      changedAt?: dayjs.Dayjs;
      beforeText?: string;
      afterText?: string;
      reason?: string;
    };
    const before = (v.beforeText ?? "").trim();
    const after = (v.afterText ?? "").trim();
    // 未填写新内容时直接关闭
    if (!before && !after) {
      onClose();
      return;
    }
    try {
      await form.validateFields(["changedAt", "beforeText", "afterText"]);
    } catch {
      return;
    }
    setSaving(true);
    try {
      await fetchJson(apiBase(targetType, targetId), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          changedAt: (v.changedAt ?? dayjs()).format("YYYY-MM-DD"),
          beforeText: before,
          afterText: after,
          reason: (v.reason ?? "").trim() || null,
        }),
      });
      message.success("已保存");
      onClose();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<ChangeRow> = [
    {
      title: "变更日期",
      dataIndex: "changedAt",
      width: 110,
      render: (v: string) => dayjs(v).format("YYYY-MM-DD"),
    },
    { title: "变更前", dataIndex: "beforeText", ellipsis: true },
    { title: "变更后", dataIndex: "afterText", ellipsis: true },
    {
      title: "变更原因",
      dataIndex: "reason",
      ellipsis: true,
      render: (t: string | null) => t?.trim() || "—",
    },
  ];

  const title = subjectLabel
    ? `${kindTitle(kind)} · ${subjectLabel}`
    : kindTitle(kind);

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      onOk={() => void onOk()}
      okText="确定"
      cancelText="取消"
      confirmLoading={saving}
      width={720}
      destroyOnHidden
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Table<ChangeRow>
          size="small"
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ y: 240 }}
          locale={{ emptyText: "暂无记录" }}
        />
        {canEdit ? (
          <Form form={form} layout="vertical" style={{ marginBottom: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "4px 8px",
                      borderBottom: "1px solid #f0f0f0",
                      width: 130,
                    }}
                  >
                    变更日期
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "4px 8px",
                      borderBottom: "1px solid #f0f0f0",
                    }}
                  >
                    变更前
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "4px 8px",
                      borderBottom: "1px solid #f0f0f0",
                    }}
                  >
                    变更后
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "4px 8px",
                      borderBottom: "1px solid #f0f0f0",
                    }}
                  >
                    变更原因
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: "8px 4px", verticalAlign: "top" }}>
                    <Form.Item
                      name="changedAt"
                      rules={[{ required: true, message: "必填" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <DatePicker style={{ width: "100%" }} />
                    </Form.Item>
                  </td>
                  <td style={{ padding: "8px 4px", verticalAlign: "top" }}>
                    <Form.Item
                      name="beforeText"
                      rules={[{ required: true, message: "必填" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input allowClear placeholder="变更前" />
                    </Form.Item>
                  </td>
                  <td style={{ padding: "8px 4px", verticalAlign: "top" }}>
                    <Form.Item
                      name="afterText"
                      rules={[{ required: true, message: "必填" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input allowClear placeholder="变更后" />
                    </Form.Item>
                  </td>
                  <td style={{ padding: "8px 4px", verticalAlign: "top" }}>
                    <Form.Item name="reason" style={{ marginBottom: 0 }}>
                      <Input allowClear placeholder="可选" />
                    </Form.Item>
                  </td>
                </tr>
              </tbody>
            </table>
          </Form>
        ) : null}
      </Space>
    </Modal>
  );
}
