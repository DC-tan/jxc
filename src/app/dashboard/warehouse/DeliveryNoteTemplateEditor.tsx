"use client";

import { App, Button, Space, Spin, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import {
  DEFAULT_DELIVERY_NOTE_TEMPLATE,
  mergeDeliveryNotePrintConfig,
  parseDeliveryNotePrintConfigForSave,
  type DeliveryNoteTemplateConfig,
} from "@/lib/delivery-note-print-template";
import { DeliveryNoteTemplatePreview } from "./DeliveryNoteTemplatePreview";

function applyPatch(
  prev: DeliveryNoteTemplateConfig,
  patch: Partial<DeliveryNoteTemplateConfig>,
): DeliveryNoteTemplateConfig {
  const merged = { ...prev, ...patch };
  if (patch.previewLine) {
    merged.previewLine = { ...prev.previewLine, ...patch.previewLine };
  }
  return mergeDeliveryNotePrintConfig(merged);
}

export function DeliveryNoteTemplateEditor() {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<DeliveryNoteTemplateConfig>(
    DEFAULT_DELIVERY_NOTE_TEMPLATE,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const patchDraft = useCallback((patch: Partial<DeliveryNoteTemplateConfig>) => {
    setDraft((prev) => applyPatch(prev, patch));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ config: Record<string, unknown> }>(
        "/api/delivery-note-print-template",
        { credentials: "include" },
      );
      setDraft(mergeDeliveryNotePrintConfig(data.config ?? {}));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
      setDraft(DEFAULT_DELIVERY_NOTE_TEMPLATE);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const parsed = parseDeliveryNotePrintConfigForSave(draft);
    if (!parsed.ok) {
      message.error(parsed.error);
      return;
    }
    setSaving(true);
    try {
      await fetchJson("/api/delivery-note-print-template", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: parsed.config }),
      });
      message.success("已保存");
      setDraft(parsed.config);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        预览效果与正式送货单版式一致。<strong>单击</strong>带虚线下划线的文字即可修改；红色为占位示意。修改后请点击「保存模版」。
      </Typography.Paragraph>
      <Space wrap>
        <Button type="primary" onClick={() => void save()} loading={saving}>
          保存模版
        </Button>
        <Button onClick={() => void load()} disabled={loading}>
          重新加载
        </Button>
      </Space>
      {loading ? (
        <Spin />
      ) : (
        <DeliveryNoteTemplatePreview
          cfg={draft}
          templateEditMode
          onTemplatePatch={patchDraft}
        />
      )}
    </Space>
  );
}
