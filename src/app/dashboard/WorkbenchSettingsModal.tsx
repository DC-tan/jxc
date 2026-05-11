"use client";

import { App, Form, InputNumber, Modal, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import type { UrgencyThresholds } from "@/lib/dashboard-urgency";
import type { ReconcilePromptSettings } from "@/lib/workbench-settings";

export type WorkbenchStateFromApi = UrgencyThresholds & ReconcilePromptSettings;

type Props = {
  open: boolean;
  onClose: () => void;
  workbench: WorkbenchStateFromApi;
  onSaved: () => void;
};

type FormValues = WorkbenchStateFromApi;

export function WorkbenchSettingsModal({ open, onClose, workbench, onSaved }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({ ...workbench });
  }, [open, workbench, form]);

  const handleOk = useCallback(async () => {
    try {
      const v = await form.validateFields();
      setSubmitting(true);
      const body: WorkbenchStateFromApi = { ...v };
      await fetchJson("/api/me/workbench-settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      message.success("工作台设置已保存");
      onSaved();
      onClose();
    } catch (e) {
      if (e && typeof e === "object" && "errorFields" in (e as object)) {
        return;
      }
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  }, [form, message, onClose, onSaved]);

  return (
    <Modal
      title="工作台设置（全系统）"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={submitting}
      width={520}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
        此处为<strong>全系统</strong>配置：保存后对所有员工的首页工作台生效（交期色阶、对账起始日等）。对账横幅的「完成」仍按<strong>各人账号</strong>分别记录。
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
        交期分档采用固定四色（深红 → 浅红 → 黄 → 蓝，无交期为灰），颜色不可改。行底色在首页销售交付、收料看板中按距交期天数应用。
      </Typography.Paragraph>
      <Form form={form} layout="vertical" requiredMark="optional" autoComplete="off">
        <Typography.Text strong>交期分档（自然日，含已逾期）</Typography.Text>
        <Form.Item
          name="urgentRedMaxDays"
          label="逾期 / 紧急（深红）"
          extra="距交期自然日数 ≤ 该值时为深红档。"
          rules={[{ required: true, type: "number", min: 0, max: 365 }]}
        >
          <InputNumber min={0} max={365} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          name="lightRedMaxDays"
          label="临近（浅红）"
          extra="大于深红上界且 ≤ 本值为浅红；须 ≥ 深红上界。"
          rules={[
            { required: true, type: "number", min: 0, max: 365 },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (value == null) return Promise.resolve();
                const u = getFieldValue("urgentRedMaxDays");
                if (typeof u === "number" && value < u) {
                  return Promise.reject(new Error("须不小于深红上界"));
                }
                return Promise.resolve();
              },
            }),
          ]}
        >
          <InputNumber min={0} max={365} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          name="yellowMaxDays"
          label="次临近（黄）"
          extra="大于浅红上界且 ≤ 本值为黄档，更大为蓝档。"
          rules={[
            { required: true, type: "number", min: 0, max: 365 },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (value == null) return Promise.resolve();
                const l = getFieldValue("lightRedMaxDays");
                if (typeof l === "number" && value < l) {
                  return Promise.reject(new Error("须不小于浅红上界"));
                }
                return Promise.resolve();
              },
            }),
          ]}
        >
          <InputNumber min={0} max={365} style={{ width: "100%" }} />
        </Form.Item>
        <Typography.Text strong>对帐提醒</Typography.Text>
        <Form.Item
          name="supplierReconcileStartDay"
          label="采购对帐：每月几号起提示"
          extra="自本月该日起，对具备采购权限的账号在首页显示红字对帐提醒，直至其点击「完成」。新月份将按同一起始日再提示，直至再次完成。"
          rules={[{ required: true, type: "number", min: 1, max: 31 }]}
        >
          <InputNumber min={1} max={31} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          name="customerReconcileStartDay"
          label="客户/仓库出货对帐：每月几号起提示"
          extra="对具备仓库出货权限的账号；规则同上。"
          rules={[{ required: true, type: "number", min: 1, max: 31 }]}
        >
          <InputNumber min={1} max={31} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          name="otherReconcileStartDay"
          label="仅统计综合：每月几号起提示"
          extra="仅当账号仅有「统计与对帐」、无采购与仓库权限时生效。"
          rules={[{ required: true, type: "number", min: 1, max: 31 }]}
        >
          <InputNumber min={1} max={31} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
