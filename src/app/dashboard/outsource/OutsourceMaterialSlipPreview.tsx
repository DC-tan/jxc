"use client";

import type { CSSProperties } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type {
  OutsourceMaterialSlipTemplateConfig,
  OutsourceSlipColumnKey,
} from "@/lib/outsource-print-template";
import { normalizeOutsourceSlipColumns } from "@/lib/outsource-print-template";

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
  const { headers, keys: columnKeys } = normalizeOutsourceSlipColumns(
    cfg.tableColumnHeaders,
    cfg.tableColumnKeys,
  );
  const w = cfg.paperMaxWidthPx;
  const edit = templateEditMode && !!onTemplatePatch;

  const cellValue = (
    row: OutsourceSlipPreviewLine,
    key: OutsourceSlipColumnKey,
  ): string | number => {
    switch (key) {
      case "materialCode":
        return row.materialCode?.trim() || row.kind || "";
      case "materialName":
        return row.materialName;
      case "partDescription":
        return row.partDescription;
      case "brand":
        return row.brand;
      case "unit":
        return row.unit;
      case "quantity":
        return row.quantity;
      case "remark":
        return row.remark;
      default:
        return "";
    }
  };

  const patch = onTemplatePatch ?? (() => {});

  const patchColumns = (
    nextHeaders: string[],
    nextKeys: OutsourceSlipColumnKey[],
  ) => {
    patch({ tableColumnHeaders: nextHeaders, tableColumnKeys: nextKeys });
  };

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
        padding: "8px 12px 10px",
        background: "#fff",
        border: "1px solid #ddd",
        fontFamily: '"Microsoft YaHei", "SimHei", sans-serif',
        fontSize: 12,
        color: "#111",
        lineHeight: 1.2,
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
.outsource-slip-print-root--template-edit { box-shadow: 0 0 0 2px #e6f4ff; }
.outsource-slip-editable:hover { background: rgba(24, 144, 255, 0.06); }
.outsource-slip-print-root .outsource-slip-table th,
.outsource-slip-print-root .outsource-slip-table td {
  line-height: 1.15;
}
/* 打印：单页 A5 横向内尽量排下；页脚说明非业务单据内容，不打印 */
@media print {
  .outsource-slip-print-root {
    padding: 2.5mm 3.5mm !important;
    font-size: 8.5pt !important;
    line-height: 1.15 !important;
    border: none !important;
    max-width: 100% !important;
    width: 100% !important;
    box-sizing: border-box !important;
  }
  .outsource-slip-print-root .outsource-slip-editable {
    border-bottom: none !important;
    background: transparent !important;
  }
  .outsource-slip-print-root .outsource-slip-company-cn { font-size: 10pt !important; margin-bottom: 0 !important; line-height: 1.15 !important; }
  .outsource-slip-print-root .outsource-slip-company-en { display: none !important; }
  .outsource-slip-print-root .outsource-slip-doc-title {
    font-size: 12pt !important;
    letter-spacing: 1px !important;
    margin: 1mm 0 1.5mm !important;
    line-height: 1.15 !important;
  }
  .outsource-slip-print-root .outsource-slip-header-pack { margin-bottom: 1.2mm !important; gap: 1mm 3mm !important; }
  .outsource-slip-print-root .outsource-slip-header-left .outsource-slip-meta-row { margin-bottom: 0.8mm !important; line-height: 1.2 !important; }
  .outsource-slip-print-root .outsource-slip-header-left .outsource-slip-date-row { margin-bottom: 0 !important; gap: 4px 10px !important; line-height: 1.2 !important; }
  .outsource-slip-print-root .outsource-slip-header-right .outsource-slip-meta-row { margin-bottom: 0.6mm !important; line-height: 1.2 !important; }
  .outsource-slip-print-root .outsource-slip-table {
    margin-bottom: 1.2mm !important;
    break-inside: avoid;
    page-break-inside: avoid;
    width: 100% !important;
    max-width: 100% !important;
    table-layout: auto !important;
  }
  .outsource-slip-print-root .outsource-slip-table th,
  .outsource-slip-print-root .outsource-slip-table td {
    padding: 1px 3px !important;
    font-size: 8pt !important;
    line-height: 1.1 !important;
    text-align: center !important;
    vertical-align: middle !important;
  }
  .outsource-slip-print-root .outsource-slip-notice-wrap { margin-bottom: 1mm !important; }
  .outsource-slip-print-root .outsource-slip-notice-title { margin-bottom: 0.4mm !important; line-height: 1.15 !important; }
  .outsource-slip-print-root .outsource-slip-notice-list { line-height: 1.2 !important; padding-left: 1em !important; font-size: 7.8pt !important; margin: 0 !important; }
  .outsource-slip-print-root .outsource-slip-notice-list li { margin: 0 !important; padding: 0 !important; }
  .outsource-slip-print-root .outsource-slip-quad { font-size: 7.5pt !important; margin-bottom: 1mm !important; line-height: 1.15 !important; }
  .outsource-slip-print-root .outsource-slip-sign-row { margin-top: 1.5mm !important; padding-top: 1mm !important; line-height: 1.2 !important; }
  .outsource-slip-print-root .outsource-slip-footer-note { display: none !important; }
  .outsource-slip-print-root .outsource-slip-col-remove { display: none !important; }
}
/* PDF：html2canvas 不应用 @media print，用此类名复刻紧凑样式 */
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} {
  padding: 6px 8px 6px !important;
  font-size: 10px !important;
  line-height: 1.15 !important;
  border: none !important;
  max-width: 100% !important;
  width: 100% !important;
  box-sizing: border-box !important;
}
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-company-cn { font-size: 12px !important; margin-bottom: 0 !important; line-height: 1.15 !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-company-en { display: none !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-doc-title {
  font-size: 14px !important;
  letter-spacing: 1px !important;
  margin: 3px 0 4px !important;
  line-height: 1.15 !important;
}
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-header-pack { margin-bottom: 4px !important; gap: 4px 12px !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-header-left .outsource-slip-meta-row { margin-bottom: 2px !important; line-height: 1.2 !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-header-left .outsource-slip-date-row { margin-bottom: 0 !important; gap: 4px 10px !important; line-height: 1.2 !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-header-right .outsource-slip-meta-row { margin-bottom: 2px !important; line-height: 1.2 !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-table {
  margin-bottom: 4px !important;
  width: 100% !important;
  max-width: 100% !important;
  table-layout: auto !important;
}
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-table th,
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-table td {
  padding: 1px 3px !important;
  font-size: 9.5px !important;
  line-height: 1.1 !important;
  text-align: center !important;
  vertical-align: middle !important;
}
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-notice-wrap { margin-bottom: 3px !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-notice-title { margin-bottom: 1px !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-notice-list { line-height: 1.2 !important; padding-left: 1em !important; font-size: 9.5px !important; margin: 0 !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-notice-list li { margin: 0 !important; padding: 0 !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-quad { font-size: 9.5px !important; margin-bottom: 3px !important; line-height: 1.15 !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-sign-row { margin-top: 4px !important; padding-top: 2px !important; }
.outsource-slip-print-root.${OUTSOURCE_SLIP_SHEET_FIT_CLASS} .outsource-slip-footer-note { display: none !important; }
`,
        }}
      />
      {cfg.customCss ? (
        <style dangerouslySetInnerHTML={{ __html: cfg.customCss }} />
      ) : null}
      <div style={{ textAlign: "center", marginBottom: 0 }}>
        <div className="outsource-slip-company-cn" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.15 }}>
          <SlipInlineEditable
            templateEditMode={edit}
            value={cfg.companyNameCn}
            onCommit={(v) => patch({ companyNameCn: v })}
            style={{ fontSize: "inherit", fontWeight: 600 }}
          />
        </div>
      </div>
      <div
        className="outsource-slip-doc-title"
        style={{
          textAlign: "center",
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: 2,
          margin: "4px 0 6px",
          lineHeight: 1.15,
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
          columnGap: 20,
          rowGap: 4,
          marginBottom: 6,
        }}
      >
        <div className="outsource-slip-header-left" style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div className="outsource-slip-meta-row" style={{ marginBottom: 3, lineHeight: 1.25 }}>
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
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "4px 16px",
              marginBottom: 0,
              lineHeight: 1.25,
            }}
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
          <div className="outsource-slip-meta-row" style={{ marginBottom: 3, lineHeight: 1.25, textAlign: "left" }}>
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
          <div className="outsource-slip-meta-row" style={{ lineHeight: 1.25, textAlign: "left" }}>
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
            marginBottom: 6,
          }}
        >
          <thead>
            <tr>
              {headers.map((h, hi) => (
                <th
                  key={`col-${hi}`}
                  style={{
                    border: "1px solid #333",
                    padding: "2px 4px",
                    fontSize: 11,
                    lineHeight: 1.15,
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
                      const next = [...headers];
                      next[hi] = v;
                      patchColumns(next, columnKeys);
                    }}
                  />
                  {edit && headers.length > 1 ? (
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
                        patchColumns(
                          headers.filter((_, i) => i !== hi),
                          columnKeys.filter((_, i) => i !== hi),
                        );
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
            {lines.map((row, i) => (
              <tr key={i}>
                {columnKeys.map((key, ci) => (
                  <td key={`${key}-${ci}`} style={cell}>
                    {cellValue(row, key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="outsource-slip-notice-wrap" style={{ marginBottom: 4 }}>
        <div className="outsource-slip-notice-title" style={{ fontWeight: 700, marginBottom: 2, lineHeight: 1.2 }}>
          <SlipInlineEditable
            templateEditMode={edit}
            value={cfg.specialNoticeTitle}
            onCommit={(v) => patch({ specialNoticeTitle: v })}
            style={{ fontWeight: 700 }}
          />
        </div>
        <ol className="outsource-slip-notice-list" style={{ margin: 0, paddingLeft: 16, lineHeight: 1.25 }}>
          {cfg.specialNoticeItems.map((t, idx) => (
            <li
              key={idx}
              style={{
                position: "relative",
                margin: 0,
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
        <div className="outsource-slip-quad" style={{ fontSize: 11, marginBottom: 4, lineHeight: 1.2 }}>
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
          marginTop: 6,
          paddingTop: 3,
          borderTop: "1px solid #eee",
          lineHeight: 1.25,
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

      {/* 仅模版设置页展示；打印与 PDF 导出已隐藏，不占纸面 */}
      {edit ? (
        <div
          className="outsource-slip-footer-note"
          style={{ marginTop: 6, fontSize: 10, color: "#666", lineHeight: 1.25 }}
        >
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
  padding: "1px 4px",
  fontSize: 11,
  lineHeight: 1.15,
  textAlign: "center",
  verticalAlign: "middle",
  wordBreak: "break-word",
  overflowWrap: "anywhere",
};
