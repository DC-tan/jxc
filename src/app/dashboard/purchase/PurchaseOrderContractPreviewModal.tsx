"use client";

import { App, Button, Modal, Space, Spin, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { exportHtmlNodeToPdf } from "@/lib/exportHtmlNodeToPdf";
import { mergeVisualEditorState, type VisualEditorState } from "@/lib/purchase-template-visual";
import type { ContractPreviewLine, ContractPreviewSupplier } from "./PurchaseContractPreview";
import type { PurchaseExtraFeeRow } from "@/lib/purchase-extra-fees";
import { PurchaseVisualContractPreview } from "./PurchaseVisualContractPreview";

type ContractDetailSupplier = ContractPreviewSupplier & {
  id: string;
  priceIncludesTax: boolean;
};

type ContractDetailPayload = {
  id: string;
  orderNo: string;
  /** 采购单「要求交货日期」（与销售订单交货日区分） */
  deliveryDueAt: string | null;
  supplier: ContractDetailSupplier;
  salesOrder: {
    customerOrderNo: string;
    customerModel: string;
    deliveryDueAt: string | null;
    customer: { code: string; name: string };
  } | null;
  lines: {
    id: string;
    quantity: string;
    unitPrice: string;
    remark: string | null;
    material: {
      id: string;
      code: string;
      name: string;
      unit: string;
      unitPrice: string;
      partDescription: string | null;
    };
  }[];
  /** 采购单详情接口附带，合同预览不使用 */
  receiptBatches?: { materialId: string; quantity: number; receivedAt: string }[];
  extraFees?: { id: string; amount: string; purpose: string }[];
};

/** 原始下单数量：合成明细（syn-*）直接使用数量；其余为待收 + 本单入库汇总 */
function orderQuantityForContractLine(
  lineQty: string,
  lineId: string,
  materialId: string,
  batches:
    | { materialId: string; quantity: number; receivedAt: string }[]
    | undefined,
): number {
  if (lineId.startsWith("syn-")) {
    return Math.round(Number(lineQty));
  }
  const pending = Math.round(Number(lineQty));
  if (!Number.isFinite(pending) || !batches?.length) return pending;
  const receivedSum = batches
    .filter((b) => b.materialId === materialId)
    .reduce((s, b) => s + b.quantity, 0);
  return pending + receivedSum;
}

function mapDetailToPreview(d: ContractDetailPayload): {
  supplier: ContractPreviewSupplier;
  lines: ContractPreviewLine[];
  customerLine: string;
  deliveryDueAtIso: string | null;
} {
  const supplier: ContractPreviewSupplier = {
    code: d.supplier.code,
    name: d.supplier.name,
    shortName: d.supplier.shortName ?? null,
    contactPerson: d.supplier.contactPerson,
    phone: d.supplier.phone,
    address: d.supplier.address,
    bankName: d.supplier.bankName,
    bankAccount: d.supplier.bankAccount,
    taxRegistrationNo: d.supplier.taxRegistrationNo,
    priceIncludesTax: d.supplier.priceIncludesTax ?? false,
  };
  const lines: ContractPreviewLine[] = d.lines.map((l) => ({
    code: l.material.code,
    model: l.material.name,
    spec: l.material.partDescription?.trim() || "—",
    unit: l.material.unit,
    quantity: orderQuantityForContractLine(
      l.quantity,
      l.id,
      l.material.id,
      d.receiptBatches,
    ),
    unitPriceNum: Number(l.unitPrice),
    remark: l.remark?.trim() ?? "",
  }));
  const customerLine = d.salesOrder
    ? `${d.salesOrder.customer.code} ${d.salesOrder.customer.name} ${d.salesOrder.customerOrderNo?.trim() || "—"}`
    : "（无关联销售订单）";
  return {
    supplier,
    lines,
    customerLine,
    deliveryDueAtIso: d.deliveryDueAt ?? null,
  };
}

export function PurchaseOrderContractPreviewModal({
  open,
  purchaseOrderId,
  orderNo,
  onClose,
}: {
  open: boolean;
  purchaseOrderId: string | null;
  orderNo: string | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const printRootRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ContractDetailPayload | null>(null);
  const [visual, setVisual] = useState<VisualEditorState | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [extraFees, setExtraFees] = useState<PurchaseExtraFeeRow[]>([]);

  useEffect(() => {
    if (!open || !purchaseOrderId) {
      setDetail(null);
      setVisual(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [d, tpl] = await Promise.all([
          fetchJson<ContractDetailPayload>(`/api/purchase-orders/${purchaseOrderId}`, {
            credentials: "include",
          }),
          fetchJson<{ config: Record<string, unknown> }>("/api/purchase-print-template", {
            credentials: "include",
          }),
        ]);
        const ve = (tpl.config as { visualEditor?: unknown }).visualEditor;
        if (!cancelled) {
          setDetail(d);
          setVisual(mergeVisualEditorState(ve));
          setExtraFees(
            (d.extraFees ?? []).map((f) => ({
              id: f.id,
              amount: Number(f.amount),
              purpose: f.purpose,
            })),
          );
        }
      } catch (e) {
        if (!cancelled) {
          message.error(e instanceof Error ? e.message : "加载失败");
          setDetail(null);
          setVisual(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, purchaseOrderId, message]);

  /** 打印/另存为 PDF 时浏览器建议的文件名多取自页面标题 */
  useEffect(() => {
    if (!open) return;
    const raw = (orderNo ?? detail?.orderNo ?? "").trim();
    if (!raw) return;
    const prev = document.title;
    document.title = raw;
    return () => {
      document.title = prev;
    };
  }, [open, orderNo, detail?.orderNo]);

  const printPreview = useCallback(() => {
    window.print();
  }, []);

  const downloadPdf = useCallback(async () => {
    const el = printRootRef.current;
    if (!el) {
      message.warning("预览区域未就绪");
      return;
    }
    const raw = (orderNo ?? detail?.orderNo ?? "order").trim() || "order";
    const name = raw.replace(/[/\\?%*:|"<>]/g, "-");
    setPdfBusy(true);
    try {
      await exportHtmlNodeToPdf(el, `${name}.pdf`);
      message.success("已下载 PDF");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出 PDF 失败");
    } finally {
      setPdfBusy(false);
    }
  }, [detail?.orderNo, message, orderNo]);

  const previewProps = detail ? mapDetailToPreview(detail) : null;

  return (
    <>
      <Modal
        title={`订单预览${orderNo ? ` · ${orderNo}` : ""}`}
        open={open}
        onCancel={onClose}
        width="min(1600px, 94vw)"
        centered
        styles={{
          body: { maxHeight: "calc(100vh - 140px)", overflow: "auto" },
        }}
        destroyOnHidden
        footer={
          <Space wrap>
            <Button onClick={onClose}>关闭</Button>
            <Button onClick={printPreview} disabled={!previewProps}>
              打印 / 另存为 PDF
            </Button>
            <Button type="primary" loading={pdfBusy} disabled={!previewProps} onClick={() => void downloadPdf()}>
              下载 PDF
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph
          type="secondary"
          className="purchase-contract-print-ui"
          style={{ marginBottom: 8 }}
        >
          「打印 / 另存为 PDF」将打开系统打印对话框，另存为 PDF 时默认文件名一般与页面标题一致（已设为当前采购单号）。「下载 PDF」文件名为「采购单号.pdf」（长合同自动分页）。附加费用请在生成采购单前的「确认生成预览」中维护，此处仅展示与打印。
        </Typography.Paragraph>
        <Spin spinning={loading}>
          <div id="purchase-order-contract-print-root" ref={printRootRef} style={{ padding: 8 }}>
            {previewProps && visual ? (
              <PurchaseVisualContractPreview
                visual={visual}
                supplier={previewProps.supplier}
                lines={previewProps.lines}
                deliveryDueAtIso={previewProps.deliveryDueAtIso}
                customerLine={previewProps.customerLine}
                contractNoOverride={orderNo ?? detail?.orderNo ?? null}
                extraFees={extraFees}
              />
            ) : !loading ? (
              <Typography.Text type="secondary">暂无数据</Typography.Text>
            ) : null}
          </div>
        </Spin>
      </Modal>

      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    height: auto !important;
    background: #fff !important;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .purchase-contract-print-ui { display: none !important; }
  body * { visibility: hidden !important; }
  #purchase-order-contract-print-root,
  #purchase-order-contract-print-root * { visibility: visible !important; }
  #purchase-order-contract-print-root {
    position: fixed !important;
    left: 0 !important;
    top: 0 !important;
    right: 0 !important;
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    box-sizing: border-box !important;
    background: #fff !important;
    z-index: 2147483647 !important;
    overflow: visible !important;
  }
  #purchase-order-contract-print-root .purchase-visual-print-root {
    max-width: 100% !important;
    margin: 0 auto !important;
  }
}`,
        }}
      />
    </>
  );
}
