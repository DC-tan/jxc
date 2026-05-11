"use client";

import type { CSSProperties, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type {
  DeliveryNotePreviewLine,
  DeliveryNoteTemplateConfig,
} from "@/lib/delivery-note-print-template";

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
      className={[className, "delivery-note-slip-editable"].filter(Boolean).join(" ")}
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

function lineToCells(cfg: DeliveryNoteTemplateConfig): string[] {
  const p = cfg.previewLine;
  return [p.orderNo, p.materialCode, p.nameSpec, p.unit, p.quantity, p.remark];
}

export function lineToCellsFromLine(l: DeliveryNotePreviewLine): string[] {
  return [l.orderNo, l.materialCode, l.nameSpec, l.unit, l.quantity, l.remark];
}

function patchPreviewLine(
  cfg: DeliveryNoteTemplateConfig,
  index: number,
  value: string,
): DeliveryNoteTemplateConfig["previewLine"] {
  const keys = [
    "orderNo",
    "materialCode",
    "nameSpec",
    "unit",
    "quantity",
    "remark",
  ] as const;
  const k = keys[index];
  return { ...cfg.previewLine, [k]: value };
}

export type DeliveryNoteLiveSlip = {
  customerName: string;
  dateStr: string;
  documentNo: string;
  issuerName: string;
  lines: DeliveryNotePreviewLine[];
};

export type DeliveryNoteTemplatePreviewProps = {
  cfg: DeliveryNoteTemplateConfig;
  templateEditMode?: boolean;
  onTemplatePatch?: (patch: Partial<DeliveryNoteTemplateConfig>) => void;
  /** 正式送货单数据（与模版编辑互斥） */
  liveSlip?: DeliveryNoteLiveSlip;
  /** 附加在根节点 className，便于打印样式 */
  rootClassName?: string;
  /** 屏上改「数量」列、点击行；打印走 printText */
  liveSlipQuantityOverride?: (
    rowIndex: number,
    cellStyle: CSSProperties,
    printText: string,
  ) => ReactNode;
  liveSlipActiveRow?: number;
  onLiveSlipRowClick?: (rowIndex: number) => void;
};

const cell: CSSProperties = {
  border: "1px solid #333",
  padding: "5px 6px",
  fontSize: 13,
  textAlign: "center",
  verticalAlign: "middle",
  wordBreak: "break-word",
  overflowWrap: "anywhere",
};

/** 正式送货单：压缩留白与字号，便于 A5 横向单页打印 */
const cellLive: CSSProperties = {
  ...cell,
  padding: "2px 4px",
  fontSize: 11,
  lineHeight: 1.2,
};

/** 出货行越少，单元格略加高，避免表身过扁 */
/** 正式送货单：窄列按内容收紧；全表单元格文字居中（与表头一致） */
function liveSlipColStyle(ci: number, base: CSSProperties): CSSProperties {
  const narrow = ci === 0 || ci === 1 || ci === 3 || ci === 4;
  // 备注列：字符串内 \n 必须在屏上/打印时换行，否则会合成一行
  const remark = ci === 5;
  return {
    ...base,
    textAlign: "center",
    verticalAlign: "middle",
    ...(narrow ? { whiteSpace: "nowrap" as const } : {}),
    ...(remark ? { whiteSpace: "pre-line" as const } : {}),
  };
}

function liveCellByLineCount(lineCount: number): CSSProperties {
  if (lineCount <= 2) {
    return {
      ...cellLive,
      padding: "8px 6px",
      fontSize: 12,
      lineHeight: 1.45,
    };
  }
  if (lineCount <= 4) {
    return {
      ...cellLive,
      padding: "6px 5px",
      fontSize: 11.5,
      lineHeight: 1.35,
    };
  }
  if (lineCount <= 7) {
    return {
      ...cellLive,
      padding: "4px 4px",
      fontSize: 11,
      lineHeight: 1.28,
    };
  }
  return cellLive;
}

export function DeliveryNoteTemplatePreview({
  cfg,
  templateEditMode = false,
  onTemplatePatch,
  liveSlip,
  rootClassName,
  liveSlipQuantityOverride,
  liveSlipActiveRow,
  onLiveSlipRowClick,
}: DeliveryNoteTemplatePreviewProps) {
  const w = cfg.paperMaxWidthPx;
  const edit = !liveSlip && templateEditMode && !!onTemplatePatch;
  const patch = onTemplatePatch ?? (() => {});
  const headers = cfg.tableColumnHeaders;
  const sampleCells = lineToCells(cfg);
  const liveLineCount = liveSlip?.lines.length ?? 0;
  const tc = !liveSlip
    ? cell
    : liveLineCount < 1
      ? cellLive
      : liveCellByLineCount(liveLineCount);

  const slipHeader = (
    <>
      <div style={{ textAlign: "center", marginBottom: liveSlip ? 2 : 6 }}>
        <div style={{ fontSize: liveSlip ? 15 : 18, fontWeight: 600 }}>
          <SlipInlineEditable
            templateEditMode={edit}
            value={cfg.companyNameCn}
            onCommit={(v) => patch({ companyNameCn: v })}
            style={{ fontSize: "inherit", fontWeight: 600 }}
          />
        </div>
        <div style={{ fontSize: liveSlip ? 10 : 13, marginTop: liveSlip ? 1 : 4 }}>
          <SlipInlineEditable
            templateEditMode={edit}
            value={cfg.companyNameEn}
            onCommit={(v) => patch({ companyNameEn: v })}
            style={{ fontSize: "inherit" }}
          />
        </div>
      </div>

      <div
        style={{
          textAlign: "center",
          fontSize: liveSlip ? 17 : 20,
          fontWeight: 700,
          letterSpacing: liveSlip ? 3 : 8,
          margin: liveSlip ? "4px 0 6px" : "10px 0 14px",
        }}
      >
        <SlipInlineEditable
          templateEditMode={edit}
          value={cfg.documentTitle}
          onCommit={(v) => patch({ documentTitle: v })}
          style={{ fontSize: "inherit", fontWeight: 700, letterSpacing: "inherit" }}
        />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: liveSlip ? 6 : 12,
          marginBottom: liveSlip ? 0 : 12,
        }}
      >
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <div
            style={{
              marginBottom: liveSlip ? 2 : 8,
              lineHeight: liveSlip ? 1.35 : 1.6,
            }}
          >
            <strong>
              <SlipInlineEditable
                templateEditMode={edit}
                value={cfg.customerNameLabel}
                onCommit={(v) => patch({ customerNameLabel: v })}
                style={{ fontWeight: 700 }}
              />
            </strong>
            ：
            {liveSlip ? (
              <span>{liveSlip.customerName}</span>
            ) : (
              <SlipInlineEditable
                templateEditMode={edit}
                value={cfg.previewCustomerName}
                onCommit={(v) => patch({ previewCustomerName: v })}
                style={dyn}
              />
            )}
          </div>
          <div style={{ lineHeight: liveSlip ? 1.35 : 1.6 }}>
            <strong>
              <SlipInlineEditable
                templateEditMode={edit}
                value={cfg.dateLabel}
                onCommit={(v) => patch({ dateLabel: v })}
                style={{ fontWeight: 700 }}
              />
            </strong>
            ：
            {liveSlip ? (
              <span>{liveSlip.dateStr}</span>
            ) : (
              <SlipInlineEditable
                templateEditMode={edit}
                value={cfg.previewDateNote}
                onCommit={(v) => patch({ previewDateNote: v })}
                style={dyn}
              />
            )}
          </div>
        </div>
        <div
          style={{
            flex: "0 1 220px",
            textAlign: "right",
            lineHeight: liveSlip ? 1.35 : 1.6,
          }}
        >
          <strong>
            <SlipInlineEditable
              templateEditMode={edit}
              value={cfg.documentNoLabel}
              onCommit={(v) => patch({ documentNoLabel: v })}
              style={{ fontWeight: 700 }}
            />
          </strong>
          ：
          {liveSlip ? (
            <span>{liveSlip.documentNo}</span>
          ) : (
            <SlipInlineEditable
              templateEditMode={edit}
              value={cfg.previewDocumentNo}
              onCommit={(v) => patch({ previewDocumentNo: v })}
              style={dyn}
            />
          )}
        </div>
      </div>
    </>
  );

  const slipTable = (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        marginBottom: liveSlip ? 0 : 10,
        tableLayout: liveSlip ? "auto" : "fixed",
      }}
    >
        <thead>
          <tr>
            {headers.map((h, hi) => (
              <th
                key={hi}
                style={{
                  ...(liveSlip ? liveSlipColStyle(hi, tc) : tc),
                  background: "#f5f5f5",
                  fontWeight: 600,
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
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {liveSlip ? (
            <>
              {liveSlip.lines.map((lineRow, ri) => (
                <tr
                  key={`live-${ri}`}
                  onClick={onLiveSlipRowClick ? () => onLiveSlipRowClick(ri) : undefined}
                  style={
                    onLiveSlipRowClick && liveSlipActiveRow === ri
                      ? { background: "rgba(24, 144, 255, 0.08)" }
                      : onLiveSlipRowClick
                        ? { cursor: "pointer" }
                        : undefined
                  }
                >
                  {lineToCellsFromLine(lineRow).map((cellVal, ci) => {
                    const cellSt = liveSlipColStyle(ci, tc);
                    return (
                      <td key={ci} style={cellSt}>
                        {ci === 4 && liveSlipQuantityOverride
                          ? liveSlipQuantityOverride(ri, cellSt, cellVal)
                          : cellVal}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </>
          ) : (
            <>
              <tr>
                {sampleCells.map((cellVal, ci) => (
                  <td key={ci} style={cell}>
                    <SlipInlineEditable
                      templateEditMode={edit}
                      value={cellVal}
                      onCommit={(v) =>
                        patch({ previewLine: patchPreviewLine(cfg, ci, v) })
                      }
                      style={dyn}
                    />
                  </td>
                ))}
              </tr>
              {Array.from({ length: cfg.tableBodyEmptyRows }).map((_, ri) => (
                <tr key={`empty-${ri}`}>
                  {headers.map((_, ci) => (
                    <td key={ci} style={cell}>
                      &nbsp;
                    </td>
                  ))}
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
  );

  const slipFooter = (
    <>
      <div style={{ marginBottom: liveSlip ? 3 : 8, flexShrink: 0 }}>
        <div style={{ fontWeight: 700, marginBottom: liveSlip ? 2 : 6 }}>
          <SlipInlineEditable
            templateEditMode={edit}
            value={cfg.specialNoticeTitle}
            onCommit={(v) => patch({ specialNoticeTitle: v })}
            style={{ fontWeight: 700 }}
          />
        </div>
        <ol
          style={{
            margin: 0,
            paddingLeft: liveSlip ? 14 : 20,
            lineHeight: liveSlip ? 1.25 : 1.5,
            fontSize: liveSlip ? 10.5 : 13,
          }}
        >
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
                    fontSize: 16,
                    color: "#999",
                    lineHeight: 1,
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    patch({
                      specialNoticeItems: cfg.specialNoticeItems.filter(
                        (_, i) => i !== idx,
                      ),
                    });
                  }}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ol>
        {edit ? (
          <ButtonAddNotice patch={patch} cfg={cfg} />
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: liveSlip ? 0 : 14,
          paddingTop: liveSlip ? 3 : 8,
          borderTop: "1px solid #eee",
          fontSize: liveSlip ? 12 : 14,
          flexShrink: 0,
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
          </strong>
          ：
          {liveSlip ? (
            <span>{liveSlip.issuerName}</span>
          ) : (
            <SlipInlineEditable
              templateEditMode={edit}
              value={cfg.previewIssuerName}
              onCommit={(v) => patch({ previewIssuerName: v })}
              style={dyn}
            />
          )}
        </div>
        <div>
          <strong>
            <SlipInlineEditable
              templateEditMode={edit}
              value={cfg.receiverSignLabel}
              onCommit={(v) => patch({ receiverSignLabel: v })}
              style={{ fontWeight: 700 }}
            />
          </strong>
          ：
          <span
            style={{
              borderBottom: "1px solid #333",
              display: "inline-block",
              minWidth: liveSlip ? 100 : 140,
            }}
          />
        </div>
      </div>

      {cfg.footerNote.trim() || edit ? (
        <div
          style={{
            marginTop: liveSlip ? 4 : 12,
            fontSize: liveSlip ? 10 : 13,
            color: "#666",
            flexShrink: 0,
          }}
        >
          <SlipInlineEditable
            templateEditMode={edit}
            multiline
            value={cfg.footerNote}
            onCommit={(v) => patch({ footerNote: v })}
            style={{ color: "inherit" }}
          />
        </div>
      ) : null}
    </>
  );

  return (
    <div
      className={[
        "delivery-note-print-root",
        templateEditMode ? "delivery-note-print-root--template-edit" : "",
        rootClassName ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        ...(liveSlip ? {} : { maxWidth: w }),
        margin: "0 auto",
        padding: liveSlip ? "4px 6px 5px" : "16px 18px 20px",
        background: "#fff",
        border: "1px solid #ddd",
        fontFamily: '"Microsoft YaHei", "SimHei", sans-serif',
        fontSize: liveSlip ? 12 : 14,
        lineHeight: liveSlip ? 1.25 : undefined,
        color: "#111",
        boxSizing: "border-box",
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
.delivery-note-print-root--template-edit { box-shadow: 0 0 0 2px #e6f4ff; }
.delivery-note-slip-editable:hover { background: rgba(24, 144, 255, 0.06); }
`,
        }}
      />
      {cfg.customCss ? (
        <style dangerouslySetInnerHTML={{ __html: cfg.customCss }} />
      ) : null}
      {liveSlip ? (
        <div
          className={
            liveLineCount <= 5
              ? "delivery-note-slip-a5-balance delivery-note-slip-a5-balance--center"
              : "delivery-note-slip-a5-balance delivery-note-slip-a5-balance--spread"
          }
        >
          <div className="delivery-note-slip-a5-zone delivery-note-slip-a5-zone--head">
            {slipHeader}
          </div>
          <div className="delivery-note-slip-a5-zone delivery-note-slip-a5-zone--table">
            {slipTable}
          </div>
          <div className="delivery-note-slip-a5-zone delivery-note-slip-a5-zone--foot">
            {slipFooter}
          </div>
        </div>
      ) : (
        <>
          {slipHeader}
          {slipTable}
          {edit ? (
            <div style={{ fontSize: 13, color: "#888", marginBottom: 8 }}>
              表格空白行数（不含上列示意行）：
              <SlipInlineEditable
                templateEditMode={edit}
                value={String(cfg.tableBodyEmptyRows)}
                onCommit={(v) => {
                  const n = Math.trunc(
                    Number(String(v).replace(/[^\d-]/g, "")) || 0,
                  );
                  patch({
                    tableBodyEmptyRows: Math.min(40, Math.max(0, n)),
                  });
                }}
                style={{ color: "#1890ff", fontWeight: 600 }}
              />
            </div>
          ) : null}
          {slipFooter}
        </>
      )}
    </div>
  );
}

function ButtonAddNotice({
  cfg,
  patch,
}: {
  cfg: DeliveryNoteTemplateConfig;
  patch: (p: Partial<DeliveryNoteTemplateConfig>) => void;
}) {
  return (
    <button
      type="button"
      style={{
        marginTop: 8,
        border: "1px dashed #1890ff",
        background: "#f0f9ff",
        color: "#1890ff",
        cursor: "pointer",
        fontSize: 14,
        padding: "2px 10px",
        borderRadius: 4,
      }}
      onClick={() =>
        patch({ specialNoticeItems: [...cfg.specialNoticeItems, "新条款（请编辑）"] })
      }
    >
      + 增加特别提示条款
    </button>
  );
}
