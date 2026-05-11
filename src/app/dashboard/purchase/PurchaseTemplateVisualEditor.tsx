"use client";

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { App, Button, Space, Typography, Upload, Slider } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { mergePurchasePrintConfig, parsePurchasePrintConfigForSave } from "@/lib/purchase-print-template";
import { PartyAFooterSealOverlay } from "./PartyAFooterSealOverlay";
import {
  DEFAULT_VISUAL_EDITOR_STATE,
  VISUAL_BLOCK_LABELS,
  type VisualBlockId,
  type VisualColumn,
  type VisualEditorState,
  mergeVisualEditorState,
} from "@/lib/purchase-template-visual";

const CELL: CSSProperties = {
  border: "1px solid #333",
  padding: "6px 8px",
  fontSize: 13,
};

function InlineEditable({
  textKey,
  value,
  onCommit,
  style,
}: {
  textKey: string;
  value: string;
  onCommit: (key: string, v: string) => void;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.textContent !== value) el.textContent = value;
  }, [value]);

  return (
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      style={{
        outline: "none",
        cursor: "text",
        minWidth: 8,
        display: "inline-block",
        ...style,
      }}
      title="单击编辑；双击或 F2 聚焦"
      onDoubleClick={() => ref.current?.focus()}
      onKeyDown={(e) => {
        if (e.key === "F2") {
          e.preventDefault();
          (e.currentTarget as HTMLSpanElement).focus();
        }
      }}
      onBlur={(e) => onCommit(textKey, e.currentTarget.textContent ?? "")}
    />
  );
}

function SortableBlockShell({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
    marginBottom: 12,
    border: "1px solid #e8e8e8",
    borderRadius: 8,
    background: "#fff",
    overflow: "hidden",
  };
  return (
    <div ref={setNodeRef} style={style}>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 0,
          background: "#fafafa",
          borderBottom: "1px solid #eee",
        }}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          style={{
            width: 36,
            cursor: "grab",
            border: "none",
            background: "#f0f0f0",
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
          }}
          aria-label={`拖拽排序：${label}`}
        >
          ⋮⋮
        </button>
        <div
          style={{
            flex: 1,
            padding: "6px 10px",
            fontSize: 12,
            color: "#666",
            display: "flex",
            alignItems: "center",
          }}
        >
          {label}
        </div>
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}

function SortableColumnChip({
  col,
  onLabelCommit,
}: {
  col: VisualColumn;
  onLabelCommit: (id: string, label: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: col.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 6px",
        background: "#f5f5f5",
        border: "1px solid #ccc",
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          cursor: "grab",
          border: "none",
          background: "transparent",
          padding: 0,
          fontSize: 12,
        }}
        aria-label="拖拽调整列顺序"
      >
        ≡
      </button>
      <InlineEditable
        textKey={`col:${col.id}`}
        value={col.label}
        onCommit={(_, v) => onLabelCommit(col.id, v)}
        style={{ fontWeight: 600 }}
      />
    </div>
  );
}

export function PurchaseTemplateVisualEditor() {
  const { message } = App.useApp();
  const [state, setState] = useState<VisualEditorState>(DEFAULT_VISUAL_EDITOR_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const setText = useCallback((key: string, v: string) => {
    setState((s) => ({ ...s, texts: { ...s.texts, [key]: v } }));
  }, []);

  const setColumnLabel = useCallback((id: string, label: string) => {
    setState((s) => ({
      ...s,
      columns: s.columns.map((c) => (c.id === id ? { ...c, label } : c)),
    }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ config: Record<string, unknown> }>(
        "/api/purchase-print-template",
        { credentials: "include" },
      );
      const ve = (data.config as { visualEditor?: unknown }).visualEditor;
      setState(mergeVisualEditorState(ve));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
      setState(DEFAULT_VISUAL_EDITOR_STATE);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const aid = String(active.id);
    const oid = String(over.id);
    const isCol = state.columns.some((c) => c.id === aid);
    if (isCol && state.columns.some((c) => c.id === oid)) {
      setState((s) => {
        const ia = s.columns.findIndex((c) => c.id === aid);
        const ib = s.columns.findIndex((c) => c.id === oid);
        if (ia < 0 || ib < 0) return s;
        return { ...s, columns: arrayMove(s.columns, ia, ib) };
      });
      return;
    }
    if (state.blockOrder.includes(aid) && state.blockOrder.includes(oid)) {
      setState((s) => {
        const ia = s.blockOrder.indexOf(aid);
        const ib = s.blockOrder.indexOf(oid);
        if (ia < 0 || ib < 0) return s;
        return { ...s, blockOrder: arrayMove(s.blockOrder, ia, ib) };
      });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const latest = await fetchJson<{ config: Record<string, unknown> }>(
        "/api/purchase-print-template",
        { credentials: "include" },
      );
      const mergedBase = mergePurchasePrintConfig(latest.config);
      const nextConfig = {
        ...(mergedBase as unknown as Record<string, unknown>),
        visualEditor: state,
      };
      const parsed = parsePurchasePrintConfigForSave(nextConfig);
      if (!parsed.ok) {
        message.error(parsed.error);
        return;
      }
      await fetchJson("/api/purchase-print-template", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: parsed.config }),
      });
      message.success("模板已保存");
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const renderBlock = (bid: string) => {
    const b = bid as VisualBlockId;
    const t = state.texts;
    const label = VISUAL_BLOCK_LABELS[b] ?? bid;

    switch (b) {
      case "logoTitle":
        return (
          <SortableBlockShell key={bid} id={bid} label={label}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div>
                {state.logo.mode === "image" && state.logo.imageUrl?.trim() ? (
                  <img
                    src={state.logo.imageUrl.trim()}
                    alt="LOGO"
                    style={{ maxHeight: 48, maxWidth: 160, objectFit: "contain" }}
                  />
                ) : (
                  <InlineEditable
                    textKey="logoText"
                    value={state.logo.text}
                    onCommit={(_, v) =>
                      setState((s) => ({ ...s, logo: { ...s.logo, text: v } }))
                    }
                    style={{
                      fontSize: 20,
                      fontWeight: 800,
                      color: "#1677ff",
                    }}
                  />
                )}
                <Space style={{ marginTop: 8 }}>
                  <Button
                    size="small"
                    onClick={() =>
                      setState((s) => ({
                        ...s,
                        logo: { ...s.logo, mode: s.logo.mode === "text" ? "image" : "text" },
                      }))
                    }
                  >
                    {state.logo.mode === "text" ? "切换为图片 LOGO" : "切换为文字 LOGO"}
                  </Button>
                  <Upload
                    accept="image/jpeg,image/png,image/webp"
                    showUploadList={false}
                    beforeUpload={async (file) => {
                      const fd = new FormData();
                      fd.append("file", file);
                      const res = await fetch("/api/upload/purchase-template-asset", {
                        method: "POST",
                        body: fd,
                        credentials: "include",
                      });
                      const data = (await res.json()) as { url?: string; error?: string };
                      if (!res.ok) {
                        message.error(data.error ?? "上传失败");
                        return false;
                      }
                      if (data.url) {
                        setState((s) => ({
                          ...s,
                          logo: { ...s.logo, imageUrl: data.url!, mode: "image" },
                        }));
                        message.success("已替换 LOGO 图片");
                      }
                      return false;
                    }}
                  >
                    <Button size="small" icon={<UploadOutlined />}>
                      上传图片
                    </Button>
                  </Upload>
                </Space>
              </div>
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 4 }}>
                  <InlineEditable
                    textKey="documentTitle"
                    value={t.documentTitle}
                    onCommit={setText}
                  />
                </div>
              </div>
            </div>
          </SortableBlockShell>
        );
      case "meta":
        return (
          <SortableBlockShell key={bid} id={bid} label={label}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={{ ...CELL, width: "18%" }}>
                    <InlineEditable
                      textKey="contractNoLabel"
                      value={t.contractNoLabel}
                      onCommit={setText}
                    />
                  </td>
                  <td style={CELL}>
                    <InlineEditable
                      textKey="contractNoValue"
                      value={t.contractNoValue}
                      onCommit={setText}
                      style={{ color: "#cf1322" }}
                    />
                  </td>
                  <td style={{ ...CELL, width: "18%" }}>
                    <InlineEditable
                      textKey="signDateLabel"
                      value={t.signDateLabel}
                      onCommit={setText}
                    />
                  </td>
                  <td style={CELL}>
                    <InlineEditable
                      textKey="signDateValue"
                      value={t.signDateValue}
                      onCommit={setText}
                      style={{ color: "#cf1322" }}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </SortableBlockShell>
        );
      case "parties":
        return (
          <SortableBlockShell key={bid} id={bid} label={label}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={{ ...CELL, width: "50%", fontWeight: 600 }}>
                    <InlineEditable
                      textKey="partyALabel"
                      value={t.partyALabel}
                      onCommit={setText}
                    />
                  </td>
                  <td style={{ ...CELL, width: "50%", fontWeight: 600 }}>
                    <InlineEditable
                      textKey="partyBLabel"
                      value={t.partyBLabel}
                      onCommit={setText}
                    />
                  </td>
                </tr>
                <tr>
                  <td style={CELL}>
                    <div>
                      <InlineEditable
                        textKey="partyARow"
                        value={t.partyARow}
                        onCommit={setText}
                      />
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <InlineEditable
                        textKey="partyAContactLine"
                        value={t.partyAContactLine}
                        onCommit={setText}
                      />
                    </div>
                  </td>
                  <td style={CELL}>
                    <div style={{ color: "#cf1322" }}>
                      <InlineEditable
                        textKey="partyBNamePlaceholder"
                        value={t.partyBNamePlaceholder}
                        onCommit={setText}
                      />
                    </div>
                    <div style={{ color: "#cf1322", marginTop: 4 }}>
                      <InlineEditable
                        textKey="partyBPhonePlaceholder"
                        value={t.partyBPhonePlaceholder}
                        onCommit={setText}
                      />
                    </div>
                    <div style={{ color: "#cf1322", marginTop: 4 }}>
                      <InlineEditable
                        textKey="partyBContactPlaceholder"
                        value={t.partyBContactPlaceholder}
                        onCommit={setText}
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </SortableBlockShell>
        );
      case "intro":
        return (
          <SortableBlockShell key={bid} id={bid} label={label}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                lineHeight: 1.55,
                padding: "6px 0",
                whiteSpace: "pre-wrap",
              }}
            >
              <InlineEditable
                textKey="introLine"
                value={t.introLine}
                onCommit={setText}
                style={{ display: "block", whiteSpace: "pre-wrap" }}
              />
            </div>
          </SortableBlockShell>
        );
      case "products":
        return (
          <SortableBlockShell key={bid} id={bid} label={label}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 400,
                lineHeight: 1.55,
                marginBottom: 6,
              }}
            >
              <InlineEditable
                textKey="sectionOneTitle"
                value={t.sectionOneTitle}
                onCommit={setText}
              />
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 6 }}>
              拖动「≡」调整列顺序；点击列名编辑
            </Typography.Text>
            <SortableContext
              items={state.columns.map((c) => c.id)}
              strategy={horizontalListSortingStrategy}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                {state.columns.map((c) => (
                  <SortableColumnChip
                    key={c.id}
                    col={c}
                    onLabelCommit={setColumnLabel}
                  />
                ))}
              </div>
            </SortableContext>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {state.columns.map((c) => (
                    <th key={c.id} style={{ ...CELL, textAlign: "center", background: "#f5f5f5" }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {state.columns.map((_, i) => (
                    <td key={i} style={{ ...CELL, textAlign: "center", color: "#999" }}>
                      —
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </SortableBlockShell>
        );
      case "terms":
        return (
          <SortableBlockShell key={bid} id={bid} label={label}>
            <div style={{ fontSize: 12, lineHeight: 1.55 }}>
              {(
                [
                  "term2",
                  "term3",
                  "term4",
                  "term5",
                  "term6",
                  "term7",
                  "term8",
                  "term9",
                  "term10",
                ] as const
              ).map((k) => (
                <p key={k} style={{ margin: "4px 0" }}>
                  <InlineEditable textKey={k} value={t[k]} onCommit={setText} />
                </p>
              ))}
            </div>
          </SortableBlockShell>
        );
      case "footer":
        return (
          <SortableBlockShell key={bid} id={bid} label={label}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                <tr>
                  <td style={{ ...CELL, width: "50%", fontWeight: 600 }}>
                    <InlineEditable
                      textKey="footerPartyATitle"
                      value={t.footerPartyATitle}
                      onCommit={setText}
                    />
                  </td>
                  <td style={{ ...CELL, width: "50%", fontWeight: 600 }}>
                    <InlineEditable
                      textKey="footerPartyBTitle"
                      value={t.footerPartyBTitle}
                      onCommit={setText}
                    />
                  </td>
                </tr>
                <tr>
                  <td style={{ ...CELL, whiteSpace: "pre-wrap", verticalAlign: "top", overflow: "visible" }}>
                    <PartyAFooterSealOverlay
                      seal={state.partyASeal}
                      textMinHeight={state.partyASeal.imageUrl?.trim() ? 160 : undefined}
                      onSealOffsetChange={(next) =>
                        setState((s) => ({ ...s, partyASeal: { ...s.partyASeal, ...next } }))
                      }
                    >
                      <InlineEditable
                        textKey="footerPartyABody"
                        value={t.footerPartyABody}
                        onCommit={setText}
                        style={{
                          display: "block",
                          whiteSpace: "pre-wrap",
                        }}
                      />
                    </PartyAFooterSealOverlay>
                    <Space direction="vertical" size="small" style={{ width: "100%", marginTop: 10 }}>
                      <Upload
                        accept="image/png,image/jpeg,image/webp"
                        showUploadList={false}
                        beforeUpload={async (file) => {
                          const fd = new FormData();
                          fd.append("file", file);
                          const res = await fetch("/api/upload/purchase-template-asset", {
                            method: "POST",
                            body: fd,
                            credentials: "include",
                          });
                          const data = (await res.json()) as { url?: string; error?: string };
                          if (!res.ok) {
                            message.error(data.error ?? "上传失败");
                            return false;
                          }
                          if (data.url) {
                            setState((s) => ({
                              ...s,
                              partyASeal: { ...s.partyASeal, imageUrl: data.url! },
                            }));
                            message.success("已设置甲方印章图");
                          }
                          return false;
                        }}
                      >
                        <Button size="small" icon={<UploadOutlined />}>
                          上传甲方印章 PNG
                        </Button>
                      </Upload>
                      {state.partyASeal.imageUrl?.trim() ? (
                        <>
                          <div>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              印章叠在文字上：拖动图片调整位置；下方滑块调宽度
                            </Typography.Text>
                            <Slider
                              min={40}
                              max={240}
                              value={state.partyASeal.widthPx}
                              onChange={(v) =>
                                setState((s) => ({
                                  ...s,
                                  partyASeal: { ...s.partyASeal, widthPx: v },
                                }))
                              }
                            />
                          </div>
                          <Button
                            size="small"
                            type="link"
                            onClick={() =>
                              setState((s) => ({
                                ...s,
                                partyASeal: { ...DEFAULT_VISUAL_EDITOR_STATE.partyASeal },
                              }))
                            }
                          >
                            清除印章
                          </Button>
                        </>
                      ) : null}
                    </Space>
                  </td>
                  <td style={{ ...CELL, color: "#cf1322", whiteSpace: "pre-wrap" }}>
                    <InlineEditable
                      textKey="footerPartyBBody"
                      value={t.footerPartyBBody}
                      onCommit={setText}
                      style={{ display: "block", whiteSpace: "pre-wrap" }}
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </SortableBlockShell>
        );
      default:
        return null;
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        左侧为<strong>真实合同样式预览</strong>：拖动手柄调整大区块顺序；表格上方可拖动列名调整列顺序；点击任意文字即可编辑，失焦后写入内存（点「保存模板」写入服务器 JSON）。
      </Typography.Paragraph>
      <Space>
        <Button type="primary" loading={saving} disabled={loading} onClick={() => void save()}>
          保存模板
        </Button>
        <Button disabled={loading} onClick={() => void load()}>
          重新加载
        </Button>
      </Space>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 260px",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div
          style={{
            border: "1px solid #d9d9d9",
            borderRadius: 8,
            padding: 16,
            background: "#fff",
            minHeight: 640,
          }}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={state.blockOrder}
              strategy={verticalListSortingStrategy}
            >
              <div style={{ maxWidth: 900, margin: "0 auto" }}>
                {state.blockOrder.map((bid) => renderBlock(bid))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        <div
          style={{
            border: "1px dashed #d9d9d9",
            borderRadius: 8,
            minHeight: 320,
            background: "#fafafa",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#bbb",
            fontSize: 13,
            padding: 16,
            textAlign: "center",
          }}
        >
          右侧预留（无需配置面板，所有操作在左侧完成）
        </div>
      </div>
    </Space>
  );
}
