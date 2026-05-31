"use client";

import { App, Button, Form, Input, InputNumber, Modal, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { fetchJson } from "@/lib/fetch-json";
import {
  ensureExtraFeeRowId,
  ensureExtraFeeRowIds,
  type PurchaseExtraFeeRow,
} from "@/lib/purchase-extra-fees";

export type { PurchaseExtraFeeRow };

export type PurchaseOrderExtraFeesPanelHandle = {
  openAddFee: () => void;
};

type Props = {
  purchaseOrderId: string | null;
  /** 父级已加载费用时传入，避免重复请求 */
  fees?: PurchaseExtraFeeRow[];
  onFeesChange?: (fees: PurchaseExtraFeeRow[]) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
};

export const PurchaseOrderExtraFeesPanel = forwardRef<
  PurchaseOrderExtraFeesPanelHandle,
  Props
>(function PurchaseOrderExtraFeesPanel(
  {
    purchaseOrderId,
    fees: controlledFees,
    onFeesChange,
    disabled = false,
    className,
    title = "本单附加费用",
  },
  ref,
) {
  const { message } = App.useApp();
  const [internalFees, setInternalFees] = useState<PurchaseExtraFeeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [feeModalOpen, setFeeModalOpen] = useState(false);
  const [feeSaving, setFeeSaving] = useState(false);
  const [feeForm] = Form.useForm<{ amount: number; purpose: string }>();

  const isControlled = controlledFees !== undefined;
  /** 无采购单 ID、由父组件接管列表：生成前预览等场景 */
  const isDraft = !purchaseOrderId && isControlled;
  const fees = isControlled ? controlledFees : internalFees;

  useEffect(() => {
    if (!isControlled || !onFeesChange || !controlledFees?.length) return;
    if (controlledFees.every((f) => f.id?.trim())) return;
    onFeesChange(ensureExtraFeeRowIds(controlledFees));
  }, [isControlled, controlledFees, onFeesChange]);

  const setFees = useCallback(
    (next: PurchaseExtraFeeRow[]) => {
      const normalized = ensureExtraFeeRowIds(next);
      if (onFeesChange) onFeesChange(normalized);
      if (!isControlled) setInternalFees(normalized);
    },
    [isControlled, onFeesChange],
  );

  useEffect(() => {
    if (isControlled || !purchaseOrderId) {
      if (!purchaseOrderId && !isControlled) setInternalFees([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const d = await fetchJson<{ extraFees?: { id: string; amount: string; purpose: string }[] }>(
          `/api/purchase-orders/${purchaseOrderId}`,
          { credentials: "include" },
        );
        if (!cancelled) {
          setInternalFees(
            (d.extraFees ?? []).map((f) => ({
              id: f.id,
              amount: Number(f.amount),
              purpose: f.purpose,
            })),
          );
        }
      } catch (e) {
        if (!cancelled) {
          message.error(e instanceof Error ? e.message : "加载附加费用失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isControlled, purchaseOrderId, message]);

  const saveExtraFees = useCallback(
    async (next: PurchaseExtraFeeRow[]) => {
      if (!purchaseOrderId) return;
      setFeeSaving(true);
      try {
        await fetchJson(`/api/purchase-orders/${purchaseOrderId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            extraFees: next.map((f) => ({
              amount: f.amount,
              purpose: f.purpose,
            })),
          }),
        });
        setFees(next);
        message.success("附加费用已保存");
      } catch (e) {
        message.error(e instanceof Error ? e.message : "保存失败");
        throw e;
      } finally {
        setFeeSaving(false);
      }
    },
    [message, purchaseOrderId, setFees],
  );

  const openAddFee = useCallback(() => {
    if (!purchaseOrderId && !isDraft) {
      message.warning("请先生成并保存采购单后再添加费用");
      return;
    }
    feeForm.resetFields();
    setFeeModalOpen(true);
  }, [feeForm, isDraft, message, purchaseOrderId]);

  useImperativeHandle(ref, () => ({ openAddFee }), [openAddFee]);

  const submitAddFee = async () => {
    let v: { amount: number; purpose: string };
    try {
      v = await feeForm.validateFields();
    } catch {
      return;
    }
    const next = [
      ...fees,
      ensureExtraFeeRowId({ amount: v.amount, purpose: v.purpose.trim() }),
    ];
    if (isDraft) {
      setFees(next);
      setFeeModalOpen(false);
      return;
    }
    try {
      await saveExtraFees(next);
      setFeeModalOpen(false);
    } catch {
      /* message shown */
    }
  };

  const removeFee = async (feeId: string) => {
    const next = fees.filter((f) => f.id !== feeId);
    if (isDraft) {
      setFees(next);
      return;
    }
    try {
      await saveExtraFees(next);
    } catch {
      /* message shown */
    }
  };

  const feeColumns: ColumnsType<PurchaseExtraFeeRow> = [
    {
      title: "金额",
      dataIndex: "amount",
      width: 120,
      align: "right",
      render: (v: number) =>
        v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 }),
    },
    { title: "用途", dataIndex: "purpose", ellipsis: true },
    {
      title: "操作",
      key: "op",
      width: 72,
      render: (_, record) => (
        <Button
          type="link"
          danger
          size="small"
          disabled={feeSaving || disabled}
          onClick={() => void removeFee(record.id!)}
        >
          删除
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className={className} style={{ marginBottom: 12 }}>
        <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
          <Typography.Text strong>{title}</Typography.Text>
          <Button
            onClick={openAddFee}
            disabled={(!purchaseOrderId && !isDraft) || disabled || loading}
          >
            添加费用
          </Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0", fontSize: 12 }}>
          {isDraft
            ? "如开模费、测试架费等；点击「确定生成」后写入当前供应商对应的采购单，并出现在合同打印与采购对账中。"
            : "如开模费、测试架费等；保存后会在合同打印与采购对账「附加费用」列显示。"}
        </Typography.Paragraph>
        <Table<PurchaseExtraFeeRow>
          size="small"
          rowKey={(record) => record.id!}
          loading={loading}
          columns={feeColumns}
          dataSource={fees}
          pagination={false}
          locale={{ emptyText: "暂无附加费用" }}
          style={{ marginTop: 8 }}
        />
      </div>

      <Modal
        title="添加费用"
        open={feeModalOpen}
        onCancel={() => setFeeModalOpen(false)}
        onOk={() => void submitAddFee()}
        confirmLoading={feeSaving}
        forceRender
        destroyOnHidden
      >
        <Form form={feeForm} layout="vertical">
          <Form.Item
            name="amount"
            label="金额"
            rules={[{ required: true, message: "请填写金额" }]}
          >
            <InputNumber min={0} precision={4} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="purpose"
            label="用途"
            rules={[{ required: true, message: "请填写用途" }]}
          >
            <Input.TextArea rows={2} placeholder="如：C01 开模、测试架" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
});
