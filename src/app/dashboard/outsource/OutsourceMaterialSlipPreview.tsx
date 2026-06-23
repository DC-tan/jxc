"use client";

import type { CSSProperties } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { OutsourceMaterialSlipTemplateConfig } from "@/lib/outsource-print-template";

/** 导出 PDF 前挂到 `.outsource-slip-print-root`，使 html2canvas 应用与打印一致的紧凑版式（print 媒体对截图无效） */
export const OUTSOURCE_SLIP_SHEET_FIT_CLASS = "outsource-slip--sheet-fit";

export type OutsourceSlipPreviewLine = {
  materialCode?: string;
  kind: string;
  materialName: string;
  partDescription: string;
  brand: string;
  unit: string;
  quantity: string | number;
  remark: string;
};

export type OutsourceMaterialSlipPreviewProps = {
  cfg: OutsourceMaterialSlipTemplateConfig;
  recipientName: string;
  orderDateStr: string;
  orderNo: string;
  /** 品名（正式单取商品型号等；模版页取占位文案） */
  productName: string;
  /** 外发加工套数展示（正式单为数字；模版页为占位说明） */
  productQtySetsDisplay: string;
  issuerName: string;
  lines: OutsourceSlipPreviewLine[];
  /** 仅模版设置页为 true；订单预览/打印勿开 */
  templateEditMode?: boolean;
  onTemplatePatch?: (patch: Partial<OutsourceMaterialSlipTemplateConfig>) => void;
  /** 模版模式下点击单号示意区域 */
  onOpenOrderNumberRule?: () => void;
};

const dyn: CSSProperties = { color: "#d40000" };

function SlipInlineEditable({
  value,
  onCommit,
  style,
  multiline,
  templateEditMode,
  className,
  as: Tag = "span",
}: {
  value: string;
  onCommit: (v: string) => void;
  style?: CSSProperties;
  multiline?: boolean;
  templateEditMode: boolean;
  className?: string;
  as?: "span" | "div" | "strong";
}) {
  const ref = useRef<HTMLSpanElement | HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || focused) return;
    const next = value;
    if (el.textContent !== next) el.textContent = next;
  }, [value, focused]);

  if (!templateEditMode) {
    return (
      <Tag
        style={{
          ...style,
          whiteSpace: multiline ? "pre-wrap" : undefined,
        }}
        className={className}
      >
        {value}
      </Tag>
    );
  }

  return (
    <Tag
      ref={ref as never}
      className={[className, "outsource-slip-editable"].filter(Boolean).join(" ")}
      contentEditable
      suppressContentEditableWarning
      style={{
        ...style,
        outline: "none",
        cursor: "text",
        borderBottom: "1px dashed #aaa",
        minWidth: 8,
        display: multiline ? "block" : "inline",
        whiteSpace: multiline ? "pre-wrap" : undefined,
      }}
      title="单击编辑，失焦保存"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        setFocused(false);
        onCommit((e.currentTarget.textContent ?? "").replace(/\r/g, ""));
      }}
      onKeyDown={(e) => {
        if (!multiline && e.key === "Enter") e.preventDefault();
      }}
    />
  );
}

export function OutsourceMaterialSlipPreview({
  cfg,
  recipientName,
  orderDateStr,
  orderNo,
  productName,
  productQtySetsDisplay,
  issuerName,
  lines,
  templateEditMode = false,
  onTemplatePatch,
  onOpenOrderNumberRule,
}: OutsourceMaterialSlipPreviewProps) {
  const headers = cfg.tableColumnHeaders;
  const w = cfg.paperMaxWidthPx;
  const edit = templateEditMode && !!onTemplatePatch;

  const rowValues = (row: OutsourceSlipPreviewLine) => [
    row.materialCode ?? row.kind,
    row.materialName,
    row.partDescription,
    row.brand,
    row.unit,
    row.quantity,
    row.remark,
  ];

  const patch = onTemplatePatch ?? (() => {});

  return (
    <div
      className={[
        "outsource-slip-print-root",
        templateEditMode ? "outsource-slip-print-root--template-edit" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        maxWidth: w,
        margin: "0 auto",
        padding: "14px 16px 16px",
        background: "#fff",
        border: "1px solid #ddd",
        fontFamily: '"Microsoft YaHei", "SimHei", sans-serif',
        fontSize: 12,
        color: "#111",
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
.outsource-slip-print-root--template-edit { box-shadow: 0 0 0 2px #e6f4ff; }
.outsource-slip-editable:hover { background: rgba(24, 144, 255, 0.06); }
/* 打印：单页 A5 横向内尽量排下；页脚说明非业务单据内容，不打印 */
@media print {
  .outsource-slip-print-root {
    padding: 3.5mm 4.5mm !important;
    font-size: 8.8pt !important;
    border: none !important;
    max-width: 100% !important;
    width: 100% !important;
    box-sizing: border-box !important;
  }
  .outsource-slip-print-root .outsource-slip-editable {
    border-bottom: none !important;
    background: transparent !important;
  }
  .outsource-slip-print-root .outsource-slip-company-cn { font-size: 10pt !important; margin-bottom: 1mm !important; }
  .outsource-slip-print-root .outsource-slip-company-en { font-size: 8pt !important; }
  .outsource-slip-print-root .outsource-slip-doc-title {
    font-size: 12.5pt !important;
    letter-spacing: 1px !important;
    margin: 2.5mm 0 3mm !important;
  }
  .outsource-slip-print-root .outsource-slip-header-pack { margin-bottom: 2mm !important; gap: 2mm 4mm !important; }
  .outsource-slip-print-root .outsource-slip-header-left .outsource-slip-meta-row { margin-bottom: 2mm !important; line-height: 1.35 !important; }
  .outsource-slip-print-root .outsource-slip-header-left .outsource-slip-date-row { margin-bottom: 0 !important; gap: 8px 16px !important; }
  .outsource-slip-print-root .outsource-slip-header-right .outsource-slip-meta-row { margin-bottom: 1.5mm !important; line-height: 1.35 !important; }
  .outsource-slip-print-root .outsource-slip-table {
    margin-bottom: 2mm !important;
    break-inside: avoid;
    page-break-inside: avoid;
    width: 100% !important;
    max-width: 100% !important;
    table-layout: auto !important;
  }
  .outsource-slip-print-root .outsource-slip-table th,
  .outsource-slip-print-root .outsource-slip-table td {
    padding: 2px 4px !important;
    font-size: 8.2pt !important;
    text-align: center !important;
    vertical-align: middle !important;
  }
  .outsource-slip-print-root .outsource-slip-notice-title { margin-bottom: 1mm !important; }
  .outsource-slip-print-root .outsource-slip-notice-list { line-height: 1.32 !important; padding-left: 1.1em !important; font-size: 8.2pt !important; }
  .outsource-slip-print-root .outsource-slip-quad { font-size: 8pt !important; margin-bottom: 2mm !important; line-height: 1.3 !important; }
  .outsource-slip-print-root .outsource-slip-sign-row { margin-top: 3mm !important; padding-top: 2mm !important; }
  .outsource-slip-print-root .outsource-slip-footer-note { display: none !important; }
  .outsource-slip-print-root .outsource-slip-col-remove { display: none !important; }
}
/* PDF：html2canvas 不应用 @media print，用此类名复刻紧凑样式 */
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} {
  padding: 10px 12px 10px !important;
  font-size: 11px !important;
  border: none !important;
  max-width: 100% !important;
  width: 100% !important;
  box-sizing: border-box !important;
}
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-company-cn { font-size: 12px !important; margin-bottom: 2px !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-company-en { font-size: 10px !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-doc-title {
  font-size: 15px !important;
  letter-spacing: 1px !important;
  margin: 6px 0 8px !important;
}
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-header-pack { margin-bottom: 6px !important; gap: 8px 20px !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-header-left .outsource-slip-meta-row { margin-bottom: 6px !important; line-height: 1.35 !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-header-left .outsource-slip-date-row { margin-bottom: 0 !important; gap: 8px 16px !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-header-right .outsource-slip-meta-row { margin-bottom: 4px !important; line-height: 1.35 !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-table {
  margin-bottom: 6px !important;
  width: 100% !important;
  max-width: 100% !important;
  table-layout: auto !important;
}
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-table th,
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-table td {
  padding: 3px 3px !important;
  font-size: 10px !important;
  text-align: center !important;
  vertical-align: middle !important;
}
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-notice-list { line-height: 1.32 !important; padding-left: 1.1em !important; font-size: 10px !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-quad { font-size: 10px !important; margin-bottom: 6px !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-sign-row { margin-top: 8px !important; padding-top: 4px !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-footer-note { display: none !important; }
`,
        }}
      />
      {cfg.customCss ? (
        <style dangerouslySetInnerHTML={{ __html: cfg.customCss }} />
      ) : null}
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <div className="outsource-slip-company-cn" style={{ fontSize: 14, fontWeight: 600 }}>
          <SlipInlineEditable
            templateEditMode={edit}
            value={cfg.companyNameCn}
            onCommit={(v) => patch({ companyNameCn: v })}
            style={{ fontSize: "inherit", fontWeight: 600 }}
          />
        </div>
        <div className="outsource-slip-company-en" style={{ fontSize: 11, marginTop: 2 }}>
          <SlipInlineEditable
            templateEditMode={edit}
            value={cfg.companyNameEn}
            onCommit={(v) => patch({ companyNameEn: v })}
            style={{ fontSize: "inherit" }}
          />
        </div>
      </div>
      <div
        className="outsource-slip-doc-title"
        style={{
          textAlign: "center",
          fontSize: 17,
          fontWeight: 700,
          letterSpacing: 2,
          margin: "8px 0 10px",
        }}
      >
        <SlipInlineEditable
          templateEditMode={edit}
          value={cfg.documentTitle}
          onCommit={(v) => patch({ documentTitle: v })}
          style={{ fontSize: "inherit", fontWeight: 700, letterSpacing: "inherit" }}
        />
      </div>

      {/*
        与纸质单版式一致：标题紧下方为一块表头区——左侧 TO / 日期 / NO，右侧品名与数量（套），再接物料表。
      */}
      <div
        className="outsource-slip-header-pack"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
          columnGap: 28,
          rowGap: 10,
          marginBottom: 10,
        }}
      >
        <div className="outsource-slip-header-left" style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div className="outsource-slip-meta-row" style={{ marginBottom: 8, lineHeight: 1.55 }}>
            <span>
              <strong>
                <SlipInlineEditable
                  templateEditMode={edit}
                  value={cfg.toLabel}
                  onCommit={(v) => patch({ toLabel: v })}
                  style={{ fontWeight: 700 }}
                />
                ：
              </strong>
            </span>{" "}
            <SlipInlineEditable
              templateEditMode={edit}
              value={recipientName}
              onCommit={(v) => patch({ previewRecipientName: v })}
              style={dyn}
            />
          </div>
          <div
            className="outsource-slip-date-row"
            style={{ display: "flex", flexWrap: "wrap", gap: "10px 24px", marginBottom: 0 }}
          >
            <div>
              <strong>
                <SlipInlineEditable
                  templateEditMode={edit}
                  value={cfg.dateLabel}
                  onCommit={(v) => patch({ dateLabel: v })}
                  style={{ fontWeight: 700 }}
                />
                ：
              </strong>
              <span style={dyn}>{orderDateStr}</span>
            </div>
            <div>
              <strong>
                <SlipInlineEditable
                  templateEditMode={edit}
                  value={cfg.orderNoLabel}
                  onCommit={(v) => patch({ orderNoLabel: v })}
                  style={{ fontWeight: 700 }}
                />
                ：
              </strong>
              <span
                style={{
                  ...dyn,
                  ...(edit && onOpenOrderNumberRule
                    ? { cursor: "pointer", textDecoration: "underline dotted" }
                    : {}),
                }}
                title={edit && onOpenOrderNumberRule ? "单击调整单号规则（前缀、流水等）" : undefined}
                onClick={
                  edit && onOpenOrderNumberRule
                    ? () => {
                        onOpenOrderNumberRule();
                      }
                    : undefined
                }
                onKeyDown={
                  edit && onOpenOrderNumberRule
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenOrderNumberRule();
                        }
                      }
                    : undefined
                }
                role={edit && onOpenOrderNumberRule ? "button" : undefined}
                tabIndex={edit && onOpenOrderNumberRule ? 0 : undefined}
              >
                {orderNo}
              </span>
            </div>
          </div>
        </div>

        <div className="outsource-slip-header-right outsource-slip-product-rows" style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div className="outsource-slip-meta-row" style={{ marginBottom: 6, lineHeight: 1.55, textAlign: "left" }}>
            <span>
              <strong>
                <SlipInlineEditable
                  templateEditMode={edit}
                  value={cfg.productNameLabel}
                  onCommit={(v) => patch({ productNameLabel: v })}
                  style={{ fontWeight: 700 }}
                />
                ：
              </strong>
            </span>{" "}
            <SlipInlineEditable
              templateEditMode={edit}
              value={productName}
              onCommit={(v) => patch({ previewProductName: v })}
              style={dyn}
            />
          </div>
          <div className="outsource-slip-meta-row" style={{ lineHeight: 1.55, textAlign: "left" }}>
            <span>
              <strong>
                <SlipInlineEditable
                  templateEditMode={edit}
                  value={cfg.productQtySetsLabel}
                  onCommit={(v) => patch({ productQtySetsLabel: v })}
                  style={{ fontWeight: 700 }}
                />
                ：
              </strong>
            </span>{" "}
            <SlipInlineEditable
              templateEditMode={edit}
              value={productQtySetsDisplay}
              onCommit={(v) => patch({ previewProductQtySets: v })}
              style={dyn}
            />
          </div>
        </div>
      </div>

      <div className="outsource-slip-table-wrap" style={{ width: "100%" }}>
        <table
          className="outsource-slip-table"
          style={{
            width: "100%",
            maxWidth: "100%",
            borderCollapse: "collapse",
            tableLayout: "auto",
            marginBottom: 10,
          }}
        >
          <thead>
            <tr>
              {headers.map((h, hi) => (
                <th
                  key={`col-${hi}`}
                  style={{
                    border: "1px solid #333",
                    padding: "6px 8px",
                    fontSize: 12,
                    background: "#f5f5f5",
                    fontWeight: 600,
                    textAlign: "center",
                    verticalAlign: "middle",
                    whiteSpace: "nowrap",
                    position: "relative",
                  }}
                >
                  <SlipInlineEditable
                    templateEditMode={edit}
                    value={h}
                    onCommit={(v) => {
                      const next = [...cfg.tableColumnHeaders];
                      next[hi] = v;
                      patch({ tableColumnHeaders: next });
                    }}
                  />
                  {edit && headers.length > 5 ? (
                    <button
                      type="button"
                      className="outsource-slip-col-remove"
                      title="删除此列"
                      aria-label="删除此列"
                      style={{
                        position: "absolute",
                        top: 2,
                        right: 2,
                        border: "none",
                        background: "rgba(255,255,255,0.9)",
                        cursor: "pointer",
                        fontSize: 12,
                        lineHeight: 1,
                        padding: "0 4px",
                        color: "#999",
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        patch({
                          tableColumnHeaders: cfg.tableColumnHeaders.filter((_, i) => i !== hi),
                        });
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((row, i) => {
              const vals = rowValues(row);
              return (
                <tr key={i}>
                  {headers.map((_, ci) => (
                    <td key={ci} style={cell}>
                      {vals[ci] ?? ""}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginBottom: 6 }}>
        <div className="outsource-slip-notice-title" style={{ fontWeight: 700, marginBottom: 4 }}>
          <SlipInlineEditable
            templateEditMode={edit}
            value={cfg.specialNoticeTitle}
            onCommit={(v) => patch({ specialNoticeTitle: v })}
            style={{ fontWeight: 700 }}
          />
        </div>
        <ol className="outsource-slip-notice-list" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.45 }}>
          {cfg.specialNoticeItems.map((t, idx) => (
            <li
              key={idx}
              style={{
                position: "relative",
                paddingRight: edit && cfg.specialNoticeItems.length > 1 ? 22 : 0,
              }}
            >
              <SlipInlineEditable
                templateEditMode={edit}
                multiline
                value={t}
                onCommit={(v) => {
                  const next = [...cfg.specialNoticeItems];
                  next[idx] = v;
                  patch({ specialNoticeItems: next });
                }}
              />
              {edit && cfg.specialNoticeItems.length > 1 ? (
                <button
                  type="button"
                  title="删除此条"
                  aria-label="删除此条"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 0,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: 14,
                    color: "#999",
                    lineHeight: 1,
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    patch({
                      specialNoticeItems: cfg.specialNoticeItems.filter((_, i) => i !== idx),
                    });
                  }}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      {cfg.quadruplicateNote.trim() || edit ? (
        <div className="outsource-slip-quad" style={{ fontSize: 11, marginBottom: 8, lineHeight: 1.4 }}>
          <SlipInlineEditable
            templateEditMode={edit}
            multiline
            value={cfg.quadruplicateNote}
            onCommit={(v) => patch({ quadruplicateNote: v })}
          />
        </div>
      ) : null}

      <div
        className="outsource-slip-sign-row"
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 12,
          paddingTop: 6,
          borderTop: "1px solid #eee",
        }}
      >
        <div>
          <strong>
            <SlipInlineEditable
              templateEditMode={edit}
              value={cfg.issuerLabel}
              onCommit={(v) => patch({ issuerLabel: v })}
              style={{ fontWeight: 700 }}
            />
            ：
          </strong>
          <SlipInlineEditable
            templateEditMode={edit}
            value={issuerName}
            onCommit={(v) => patch({ previewIssuerName: v })}
            style={dyn}
          />
        </div>
        <div>
          <strong>
            <SlipInlineEditable
              templateEditMode={edit}
              value={cfg.receiverSignLabel}
              onCommit={(v) => patch({ receiverSignLabel: v })}
              style={{ fontWeight: 700 }}
            />
            ：
          </strong>
          <span style={{ borderBottom: "1px solid #333", display: "inline-block", minWidth: 120 }} />
        </div>
      </div>

      {cfg.footerNote.trim() || edit ? (
        <div className="outsource-slip-footer-note" style={{ marginTop: 10, fontSize: 11, color: "#666" }}>
          <SlipInlineEditable
            templateEditMode={edit}
            multiline
            value={cfg.footerNote}
            onCommit={(v) => patch({ footerNote: v })}
            style={{ color: "inherit", fontSize: "inherit" }}
          />
        </div>
      ) : null}
    </div>
  );
}

const cell: CSSProperties = {
  border: "1px solid #333",
  padding: "4px 8px",
  fontSize: 11,
  textAlign: "center",
  verticalAlign: "middle",
  wordBreak: "break-word",
  overflowWrap: "anywhere",
};
