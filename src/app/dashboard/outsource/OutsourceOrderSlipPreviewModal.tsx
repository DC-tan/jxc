"use client";

import { App, Button, Modal, Space, Spin, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { exportHtmlNodeToPdf } from "@/lib/exportHtmlNodeToPdf";
import type { MaterialKind } from "@/lib/materialLabels";
import { MATERIAL_KIND_LABEL } from "@/lib/materialLabels";
import { mergeOutsourcePrintConfig, type OutsourceMaterialSlipTemplateConfig } from "@/lib/outsource-print-template";
import {
  OUTSOURCE_SLIP_SHEET_FIT_CLASS,
  OutsourceMaterialSlipPreview,
  type OutsourceSlipPreviewLine,
} from "./OutsourceMaterialSlipPreview";

type SlipDetailMaterial = {
  id?: string;
  code: string;
  name: string;
  unit: string;
  partDescription: string | null;
  brand: string | null;
  kind: string | null;
  presetKind: { name: string } | null;
};

type SlipDetailPayload = {
  id: string;
  orderNo: string;
  status: string;
  productQty: number;
  remark: string | null;
  createdAt: string;
  supplier: {
    id: string;
    code: string;
    name: string;
    shortName: string | null;
  } | null;
  product: {
    model: string;
    customerMaterialCode: string;
    unit: string;
    customer: { code: string; name: string };
  };
  lines: {
    id: string;
    /** 仓库实发数（外发单预览/打印用，不含外发库存抵扣） */
    issuedQuantity?: number;
    quantity: number;
    material: SlipDetailMaterial;
  }[];
  materialReturnBatches?: {
    materialId: string;
    quantity: number;
    receivedAt: string;
  }[];
};

function kindLabel(m: SlipDetailMaterial): string {
  if (m.presetKind?.name?.trim()) return m.presetKind.name.trim();
  if (m.kind && m.kind in MATERIAL_KIND_LABEL) {
    return MATERIAL_KIND_LABEL[m.kind as MaterialKind];
  }
  return "—";
}

/** 外发单预览/打印：数量 = 仓库实发数（不含外发物料库存抵扣部分） */
function slipLineWarehouseQty(l: SlipDetailPayload["lines"][number]): number {
  if (typeof l.issuedQuantity === "number") {
    return Math.max(0, l.issuedQuantity);
  }
  return 0;
}

function mapDetailToSlipLines(d: SlipDetailPayload): OutsourceSlipPreviewLine[] {
  return d.lines
    .filter((l) => slipLineWarehouseQty(l) > 0)
    .map((l) => ({
      kind: kindLabel(l.material),
      materialName: l.material.name,
      partDescription: l.material.partDescription?.trim() || "—",
      brand: l.material.brand?.trim() || "—",
      unit: l.material.unit,
      quantity: slipLineWarehouseQty(l),
      remark: "",
    }));
}

/** 收件方：仅显示供应商中文全称（不显示编号、简称） */
function recipientLine(d: SlipDetailPayload): string {
  if (!d.supplier) return "—";
  return d.supplier.name.trim() || "—";
}

function slipProductName(d: SlipDetailPayload): string {
  const m = d.product.model?.trim();
  if (m) return m;
  const c = d.product.customerMaterialCode?.trim();
  if (c) return c;
  return "—";
}

export function OutsourceOrderSlipPreviewModal({
  open,
  outsourceOrderId,
  orderNo,
  onClose,
}: {
  open: boolean;
  outsourceOrderId: string | null;
  orderNo: string | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const printRootRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<SlipDetailPayload | null>(null);
  const [cfg, setCfg] = useState<OutsourceMaterialSlipTemplateConfig | null>(null);
  const [issuerName, setIssuerName] = useState<string>("—");
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    if (!open || !outsourceOrderId) {
      setDetail(null);
      setCfg(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [d, tpl, me] = await Promise.all([
          fetchJson<SlipDetailPayload>(`/api/outsource-orders/${outsourceOrderId}`, {
            credentials: "include",
          }),
          fetchJson<{ config: Record<string, unknown> }>("/api/outsource-print-template", {
            credentials: "include",
          }),
          fetch("/api/me", { credentials: "include" }),
        ]);
        let meName = "—";
        if (me.ok) {
          const u = (await me.json()) as { name?: string };
          if (u.name?.trim()) meName = u.name.trim();
        }
        if (!cancelled) {
          setDetail(d);
          setCfg(mergeOutsourcePrintConfig(tpl.config ?? {}));
          setIssuerName(meName);
        }
      } catch (e) {
        if (!cancelled) {
          message.error(e instanceof Error ? e.message : "加载失败");
          setDetail(null);
          setCfg(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, outsourceOrderId, message]);

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
    const slipNo = (orderNo ?? detail?.orderNo ?? "").trim();
    const prevTitle = document.title;
    let titleRestored = false;
    const restoreTitle = () => {
      if (titleRestored) return;
      titleRestored = true;
      document.title = prevTitle;
    };
    const onBeforePrint = () => {
      /* 页眉中间常取 document.title；改为单号可减少「站点标题」干扰（日期/网址仍由浏览器控制） */
      if (slipNo) document.title = slipNo;
    };
    window.addEventListener("beforeprint", onBeforePrint, { once: true });
    window.addEventListener("afterprint", restoreTitle, { once: true });
    window.print();
    /* 部分环境取消打印时不触发 afterprint */
    window.setTimeout(restoreTitle, 2500);
  }, [detail?.orderNo, orderNo]);

  const downloadPdf = useCallback(async () => {
    const el = printRootRef.current;
    if (!el) {
      message.warning("预览区域未就绪");
      return;
    }
    const slipInner = el.querySelector(".outsource-slip-print-root") as HTMLElement | null;
    const raw = (orderNo ?? detail?.orderNo ?? "outsource").trim() || "outsource";
    const name = raw.replace(/[/\\?%*:|"<>]/g, "-");
    setPdfBusy(true);
    slipInner?.classList.add(OUTSOURCE_SLIP_SHEET_FIT_CLASS);
    try {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      await exportHtmlNodeToPdf(el, `${name}.pdf`, {
        format: "a5",
        orientation: "landscape",
        innerSelector: ".outsource-slip-print-root",
      });
      message.success("已下载 PDF（A5 横向）");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出 PDF 失败");
    } finally {
      slipInner?.classList.remove(OUTSOURCE_SLIP_SHEET_FIT_CLASS);
      setPdfBusy(false);
    }
  }, [detail?.orderNo, message, orderNo]);

  const lines = detail ? mapDetailToSlipLines(detail) : [];
  const ready = detail && cfg;

  return (
    <>
      <Modal
        title={`外发单预览${orderNo ? ` · ${orderNo}` : ""}`}
        open={open}
        onCancel={onClose}
        width="min(960px, 94vw)"
        centered
        styles={{
          body: { maxHeight: "calc(100vh - 140px)", overflow: "auto" },
        }}
        destroyOnHidden
        footer={
          <Space wrap>
            <Button onClick={onClose}>关闭</Button>
            <Button onClick={printPreview} disabled={!ready}>
              打印 / 另存为 PDF
            </Button>
            <Button type="primary" loading={pdfBusy} disabled={!ready} onClick={() => void downloadPdf()}>
              下载 PDF（A5 横向）
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph
          type="secondary"
          className="outsource-slip-print-ui"
          style={{ marginBottom: 8 }}
        >
          <strong>去掉红圈里的页眉/页脚：</strong>那是浏览器自带的（日期、网页标题、网址、页码），
          <strong>网页无法强制关闭</strong>。请在打印预览右侧打开<strong>「更多设置」</strong>，取消勾选
          <strong>「页眉和页脚」</strong>（Chrome / Edge 中文界面；英文为 Headers and footers）。
          另：幅面请选择 <strong>A5 横向</strong>；不需要浏览器打印时，可用下方「下载 PDF」后只打印 PDF。
        </Typography.Paragraph>
        <Spin spinning={loading}>
          <div id="outsource-order-slip-print-root" ref={printRootRef} style={{ padding: 8 }}>
            {ready ? (
              <OutsourceMaterialSlipPreview
                cfg={cfg}
                recipientName={recipientLine(detail)}
                orderDateStr={new Date(detail.createdAt).toLocaleDateString("zh-CN", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                })}
                orderNo={detail.orderNo}
                productName={slipProductName(detail)}
                productQtySetsDisplay={String(detail.productQty)}
                issuerName={issuerName}
                lines={lines}
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
  @page { size: A5 landscape; margin: 5mm; }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    height: auto !important;
    min-height: 0 !important;
    background: #fff !important;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
    overflow: visible !important;
  }
  /*
   * DashboardShell 主壳是 minHeight:100vh 的侧栏布局；仅用 visibility:hidden 时仍占满第一页，
   * 打印会变成「第一页空白、第二页才是单据」。打印时把主壳移出排版流。
   */
  .ant-layout.ant-layout-has-sider {
    display: none !important;
  }
  .outsource-slip-print-ui { display: none !important; }
  .ant-modal-mask { display: none !important; }
  /* 避免 Modal 在打印时被 transform/高度限制裁成空白 */
  .ant-modal-root .ant-modal-wrap {
    position: static !important;
    inset: auto !important;
    overflow: visible !important;
    height: auto !important;
  }
  .ant-modal-root .ant-modal {
    max-width: none !important;
    padding: 0 !important;
    margin: 0 !important;
    top: 0 !important;
  }
  .ant-modal-root .ant-modal-content {
    box-shadow: none !important;
    overflow: visible !important;
  }
  .ant-modal-root .ant-modal-body {
    max-height: none !important;
    overflow: visible !important;
  }
  .ant-spin-nested-loading,
  .ant-spin-container {
    height: auto !important;
    overflow: visible !important;
  }
  body * { visibility: hidden !important; }
  /*
   * 只让「Modal → 打印根」这一条链上的节点可见。
   * 不要用 .ant-modal-root * { visible }：会把整棵子树都设为可见，再叠一层 position:fixed 的打印根，
   * 浏览器里常出现「同一份单据印两遍」。
   */
  .ant-modal-root,
  .ant-modal-wrap,
  .ant-modal,
  .ant-modal-content,
  .ant-modal-body,
  .ant-spin-nested-loading,
  .ant-spin-container,
  #outsource-order-slip-print-root {
    visibility: visible !important;
  }
  #outsource-order-slip-print-root * {
    visibility: visible !important;
  }
  /* 留在文档流内单份渲染；避免 fixed 叠在流内副本上造成双份 */
  #outsource-order-slip-print-root {
    position: static !important;
    left: auto !important;
    top: auto !important;
    right: auto !important;
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    box-sizing: border-box !important;
    background: #fff !important;
    z-index: auto !important;
    overflow: visible !important;
  }
  #outsource-order-slip-print-root .outsource-slip-print-root {
    max-width: 100% !important;
    width: 100% !important;
    margin: 0 !important;
    border: none !important;
    box-shadow: none !important;
  }
  .ant-modal-footer { display: none !important; }
  .ant-modal-header { display: none !important; }
}`,
        }}
      />
    </>
  );
}
