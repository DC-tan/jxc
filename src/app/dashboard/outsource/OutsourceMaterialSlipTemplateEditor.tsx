"use client";

import { PlusOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Space,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import {
  DEFAULT_OUTSOURCE_MATERIAL_SLIP_TEMPLATE,
  mergeOutsourcePrintConfig,
  parseOutsourcePrintConfigForSave,
  type OutsourceMaterialSlipTemplateConfig,
} from "@/lib/outsource-print-template";
import type { PurchaseOrderNumberRule } from "@/lib/purchase-print-template";
import {
  OutsourceMaterialSlipPreview,
  type OutsourceSlipPreviewLine,
} from "./OutsourceMaterialSlipPreview";

const SAMPLE_LINES: OutsourceSlipPreviewLine[] = [
  {
    materialCode: "E-C-001",
    kind: "电子料",
    materialName: "示例电容",
    partDescription: "0603 / 10uF",
    brand: "样品牌",
    unit: "PCS",
    quantity: 1000,
    remark: "",
  },
  {
    materialCode: "E-S-001",
    kind: "辅料",
    materialName: "示例锡线",
    partDescription: "Φ0.8mm",
    brand: "—",
    unit: "卷",
    quantity: 5,
    remark: "RoHS",
  },
];

function previewOrderNo(cfg: OutsourceMaterialSlipTemplateConfig): string {
  const p = cfg.orderNumberRule.prefix;
  const d = dayjs().format("YYYYMMDD");
  const w = cfg.orderNumberRule.sequenceDigits;
  return `${p}-示例简称-${d}-${String(1).padStart(w, "0")}`;
}

function applyOutsourceTemplatePatch(
  prev: OutsourceMaterialSlipTemplateConfig,
  patch: Partial<OutsourceMaterialSlipTemplateConfig>,
): OutsourceMaterialSlipTemplateConfig {
  const mergedTop = {
    ...prev,
    ...patch,
    orderNumberRule:
      patch.orderNumberRule !== undefined
        ? { ...prev.orderNumberRule, ...patch.orderNumberRule }
        : prev.orderNumberRule,
    tableColumnHeaders: patch.tableColumnHeaders ?? prev.tableColumnHeaders,
    specialNoticeItems: patch.specialNoticeItems ?? prev.specialNoticeItems,
  };
  return mergeOutsourcePrintConfig(mergedTop);
}

export function OutsourceMaterialSlipTemplateEditor() {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<OutsourceMaterialSlipTemplateConfig>(
    DEFAULT_OUTSOURCE_MATERIAL_SLIP_TEMPLATE,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [ruleForm] = Form.useForm<PurchaseOrderNumberRule>();
  const [advancedForm] = Form.useForm<{
    footerNote: string;
    paperMaxWidthPx: number;
    customCss: string;
  }>();

  const patchDraft = useCallback((patch: Partial<OutsourceMaterialSlipTemplateConfig>) => {
    setDraft((prev) => applyOutsourceTemplatePatch(prev, patch));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ config: Record<string, unknown> }>(
        "/api/outsource-print-template",
        { credentials: "include" },
      );
      const merged = mergeOutsourcePrintConfig(data.config ?? {});
      setDraft(merged);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
      setDraft(DEFAULT_OUTSOURCE_MATERIAL_SLIP_TEMPLATE);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (ruleOpen) ruleForm.setFieldsValue(draft.orderNumberRule);
  }, [ruleOpen, draft.orderNumberRule, ruleForm]);

  useEffect(() => {
    if (advancedOpen) {
      advancedForm.setFieldsValue({
        footerNote: draft.footerNote,
        paperMaxWidthPx: draft.paperMaxWidthPx,
        customCss: draft.customCss,
      });
    }
  }, [advancedOpen, draft.footerNote, draft.paperMaxWidthPx, draft.customCss, advancedForm]);

  const save = async () => {
    const parsed = parseOutsourcePrintConfigForSave(draft);
    if (!parsed.ok) {
      message.error(parsed.error);
      return;
    }
    setSaving(true);
    try {
      await fetchJson("/api/outsource-print-template", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: parsed.config }),
      });
      message.success("已保存");
      void load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const addColumn = () => {
    if (draft.tableColumnHeaders.length >= 12) {
      message.warning("最多 12 列");
      return;
    }
    patchDraft({ tableColumnHeaders: [...draft.tableColumnHeaders, "新列"] });
  };

  const addNotice = () => {
    if (draft.specialNoticeItems.length >= 12) {
      message.warning("最多 12 条");
      return;
    }
    patchDraft({ specialNoticeItems: [...draft.specialNoticeItems, ""] });
  };

  return (
    <>
      <Card
        title="外发物料单模版"
        loading={loading}
        size="small"
        styles={{ body: { background: "#fafafa" } }}
        extra={
          <Space wrap>
            <Button onClick={() => setRuleOpen(true)}>单号规则</Button>
            <Button onClick={() => setAdvancedOpen(true)}>高级</Button>
            <Button type="primary" onClick={() => void save()} loading={saving}>
              保存模版
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          单击预览中带虚线的文字即可修改；表头、条款旁可删列/删条；单号示意请点红字或打开「单号规则」。以下为示意数据；正式外发单选择加工方后，单号按规则生成。
        </Typography.Paragraph>
        <Space wrap style={{ marginBottom: 12 }}>
          <Button type="dashed" icon={<PlusOutlined />} onClick={addColumn}>
            增加列
          </Button>
          <Button type="dashed" icon={<PlusOutlined />} onClick={addNotice}>
            增加条款
          </Button>
        </Space>
        <div style={{ background: "#f0f0f0", padding: 16, borderRadius: 8 }}>
          <OutsourceMaterialSlipPreview
            templateEditMode
            onTemplatePatch={patchDraft}
            onOpenOrderNumberRule={() => setRuleOpen(true)}
            cfg={draft}
            recipientName={draft.previewRecipientName}
            orderDateStr={dayjs().format("YYYY-MM-DD")}
            orderNo={previewOrderNo(draft)}
            productName={draft.previewProductName}
            productQtySetsDisplay={draft.previewProductQtySets}
            issuerName={draft.previewIssuerName}
            lines={SAMPLE_LINES}
          />
        </div>
      </Card>

      <Drawer
        title="单号规则"
        width={420}
        open={ruleOpen}
        onClose={() => setRuleOpen(false)}
        destroyOnHidden={false}
        footer={
          <Space>
            <Button onClick={() => setRuleOpen(false)}>取消</Button>
            <Button
              type="primary"
              onClick={() => {
                void ruleForm
                  .validateFields()
                  .then((v) => {
                    patchDraft({
                      orderNumberRule: {
                        ...draft.orderNumberRule,
                        ...v,
                        dateFormat: "YYYYMMDD",
                      },
                    });
                    setRuleOpen(false);
                  })
                  .catch(() => {});
              }}
            >
              确定
            </Button>
          </Space>
        }
      >
        <Form<PurchaseOrderNumberRule> form={ruleForm} layout="vertical">
          <Form.Item name="prefix" label="前缀" rules={[{ required: true, message: "必填" }]}>
            <Input maxLength={24} />
          </Form.Item>
          <Form.Item
            name="sequenceDigits"
            label="流水位数"
            rules={[{ required: true, message: "必填" }]}
          >
            <InputNumber min={2} max={8} className="w-full" />
          </Form.Item>
          <Form.Item
            name="startSequence"
            label="每年起始流水"
            rules={[{ required: true, message: "必填" }]}
          >
            <InputNumber min={1} max={99999} className="w-full" />
          </Form.Item>
          <Form.Item name="useShortName" valuePropName="checked" label="供应商中间段">
            <Checkbox>优先使用供应商简称（无简称则用编号）</Checkbox>
          </Form.Item>
          <Form.Item name="dateFormat" hidden initialValue="YYYYMMDD">
            <Input />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title="高级"
        width={480}
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        destroyOnHidden={false}
        footer={
          <Space>
            <Button onClick={() => setAdvancedOpen(false)}>取消</Button>
            <Button
              type="primary"
              onClick={() => {
                void advancedForm
                  .validateFields()
                  .then((v) => {
                    patchDraft({
                      footerNote: v.footerNote,
                      paperMaxWidthPx: v.paperMaxWidthPx,
                      customCss: v.customCss,
                    });
                    setAdvancedOpen(false);
                  })
                  .catch(() => {});
              }}
            >
              确定
            </Button>
          </Space>
        }
      >
        <Form form={advancedForm} layout="vertical">
          <Form.Item name="footerNote" label="页脚说明（仅屏幕预览，不打印）">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="paperMaxWidthPx"
            label="预览最大宽度（px）"
            rules={[{ required: true, message: "必填" }]}
          >
            <InputNumber min={400} max={1400} className="w-full" />
          </Form.Item>
          <Form.Item name="customCss" label="自定义 CSS（可选）">
            <Input.TextArea rows={4} placeholder=".outsource-slip-print-root { ... }" />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
