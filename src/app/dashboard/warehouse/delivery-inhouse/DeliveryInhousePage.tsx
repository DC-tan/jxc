"use client";

import { App, Button, Card, InputNumber, Space, Spin, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { bomNeedForShort } from "@/lib/bom-need";
import { fetchJson } from "@/lib/fetch-json";
import {
  WAREHOUSE_DELIVERY_DRAFT_KEY,
  type WarehouseDeliveryDraft,
} from "@/lib/warehouse-delivery-draft";

type BomRow = {
  materialId: string;
  materialCode: string;
  materialName: string;
  usageQty: number;
  materialStock: number;
  needWhenProduceEqualsShort: number;
};

type PreviewLine = {
  lineId: string;
  productLabel: string;
  unit: string;
  processingMode: "INHOUSE" | "OUTSOURCE" | "OUTSOURCE_INHOUSE";
  shipQty: number;
  productStock: number;
  short: number;
  bom: BomRow[] | null;
};

type PreviewOk = { needsInhouseStep: boolean; lines: PreviewLine[] };

function readDraft(): WarehouseDeliveryDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(WAREHOUSE_DELIVERY_DRAFT_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as WarehouseDeliveryDraft;
    if (!j?.orderId || !Array.isArray(j.lines)) return null;
    return j;
  } catch {
    return null;
  }
}

export function DeliveryInhousePage() {
  const { message: msg } = App.useApp();
  const router = useRouter();
  const [draft, setDraft] = useState<WarehouseDeliveryDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewOk | null>(null);
  const [produceByLine, setProduceByLine] = useState<Record<string, number>>({});

  const load = useCallback(async (d: WarehouseDeliveryDraft) => {
    setLoading(true);
    try {
      const res = await fetchJson<PreviewOk>(
        `/api/warehouse/sales-orders/${d.orderId}/deliver-preview`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines: d.lines.filter((x) => x.shipQty > 0) }),
        },
      );
      setPreview(res);
      if (!res.needsInhouseStep) {
        sessionStorage.setItem(WAREHOUSE_DELIVERY_DRAFT_KEY, JSON.stringify(d));
        router.replace("/dashboard/warehouse/delivery-note");
        return;
      }
      const next: Record<string, number> = { ...d.inhouseProduceByLineId };
      for (const ln of res.lines) {
        if (ln.short > 0) {
          const cur = next[ln.lineId];
          next[ln.lineId] =
            typeof cur === "number" && cur >= ln.short
              ? cur
              : ln.short;
        }
      }
      setProduceByLine(next);
    } catch (e) {
      msg.error(e instanceof Error ? e.message : "预检失败");
    } finally {
      setLoading(false);
    }
  }, [msg, router]);

  useEffect(() => {
    const d = readDraft();
    if (!d) {
      setDraft(null);
      setLoading(false);
      return;
    }
    setDraft(d);
    void load(d);
  }, [load]);

  const inhouseShortLines = useMemo(
    () => (preview?.lines ?? []).filter((l) => l.short > 0),
    [preview],
  );

  const handleNext = useCallback(() => {
    if (!draft || !preview) return;
    for (const ln of inhouseShortLines) {
      const p = produceByLine[ln.lineId] ?? 0;
      if (p < ln.short) {
        msg.error(
          `「${ln.productLabel}」现入库不能少于本批不足数（至少 ${ln.short}）`,
        );
        return;
      }
      for (const b of ln.bom ?? []) {
        const need = bomNeedForShort(b.usageQty, p);
        if (need > 0 && b.materialStock < need) {
          msg.error(
            `按现入库 ${p} 件测算：物料 ${b.materialCode} 需 ${need}，库存 ${b.materialStock} 不足。请调低入库或先补料。`,
          );
          return;
        }
      }
    }
    const inhouseProduceByLineId: Record<string, number> = {};
    for (const ln of inhouseShortLines) {
      inhouseProduceByLineId[ln.lineId] = produceByLine[ln.lineId] ?? ln.short;
    }
    const nextDraft: WarehouseDeliveryDraft = {
      ...draft,
      inhouseProduceByLineId: {
        ...draft.inhouseProduceByLineId,
        ...inhouseProduceByLineId,
      },
    };
    sessionStorage.setItem(WAREHOUSE_DELIVERY_DRAFT_KEY, JSON.stringify(nextDraft));
    router.push("/dashboard/warehouse/delivery-note");
  }, [draft, preview, inhouseShortLines, produceByLine, msg, router]);

  const handleCancel = useCallback(() => {
    sessionStorage.removeItem(WAREHOUSE_DELIVERY_DRAFT_KEY);
    router.push("/dashboard/warehouse");
  }, [router]);

  const columns: ColumnsType<PreviewLine> = useMemo(
    () => [
      { title: "产品", dataIndex: "productLabel", width: 200, ellipsis: true },
      { title: "单位", dataIndex: "unit", width: 56 },
      {
        title: "本次发货",
        dataIndex: "shipQty",
        width: 96,
        align: "right",
      },
      {
        title: "现商品库存",
        dataIndex: "productStock",
        width: 108,
        align: "right",
      },
      {
        title: "不足",
        key: "short",
        width: 88,
        align: "right",
        render: (_, r) =>
          r.short > 0 ? <Typography.Text type="danger">{r.short}</Typography.Text> : "0",
      },
      {
        title: "现入库（补产）",
        key: "in",
        width: 200,
        render: (_, r) => {
          if (r.short <= 0) {
            return <Typography.Text type="secondary">—</Typography.Text>;
          }
          return (
            <InputNumber
              min={r.short}
              max={1_000_000}
              value={produceByLine[r.lineId] ?? r.short}
              onChange={(v) => {
                const n =
                  v === null || v === undefined
                    ? r.short
                    : Math.max(
                        r.short,
                        Math.trunc(
                          Number.isFinite(Number(v)) ? Number(v) : r.short,
                        ),
                      );
                setProduceByLine((prev) => ({ ...prev, [r.lineId]: n }));
              }}
            />
          );
        },
      },
    ],
    [produceByLine],
  );

  if (!draft && !loading) {
    return (
      <Card title="自加工补产入库存">
        <Typography.Paragraph>没有出货草稿。请从仓库「确认出货」进入。</Typography.Paragraph>
        <Link href="/dashboard/warehouse">返回仓库出货</Link>
      </Card>
    );
  }

  return (
    <Card
      className="warehouse-delivery-inhouse-scope"
      title="自加工补产入库存"
      extra={
        <Space>
          <Button onClick={handleCancel}>取消</Button>
          <Button type="primary" onClick={() => void handleNext()}>
            下一步：打印送货单
          </Button>
        </Space>
      }
    >
      <div style={{ marginBottom: 16 }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          对<strong>商品库存不足</strong>的本批自加工行，请填写<strong>现入库（补产）</strong>件数，须
          <strong>不少于「不足」</strong>；超出入库部分会留在成品库存。下方根据入库数显示对应 BOM
          物料需扣量与当前物料库存。点击「下一步」后进入送货单；仅在送货单点击<strong>完成</strong>后才扣料、登记成品入出库与本次出货。点「取消」不保存、不记库存。
        </Typography.Paragraph>
      </div>
      {loading || !preview ? (
        <Spin />
      ) : (
        <Table<PreviewLine>
          rowKey="lineId"
          size="small"
          pagination={false}
          columns={columns}
          dataSource={preview.lines}
          scroll={{ x: "max-content" }}
          defaultExpandedRowKeys={inhouseShortLines.map((r) => r.lineId)}
          expandable={{
            expandedRowRender: (r) => {
              if (r.short <= 0) {
                return <Typography.Text type="secondary">本行库存充足，无需补产</Typography.Text>;
              }
              const p = produceByLine[r.lineId] ?? r.short;
              return (
                <div style={{ maxWidth: 800 }}>
                  <Typography.Text strong>BOM 物料（按现入库 {p} 件测算）</Typography.Text>
                  <ul style={{ margin: "8px 0 0 0", paddingLeft: 20 }}>
                    {(r.bom ?? []).map((b) => {
                      const need = bomNeedForShort(b.usageQty, p);
                      const bad = need > 0 && b.materialStock < need;
                      return (
                        <li
                          key={b.materialId}
                          style={bad ? { color: "var(--ant-color-error)" } : undefined}
                        >
                          {b.materialName}（{b.materialCode}）单套用量 {b.usageQty}，本批需扣{" "}
                          <strong>{need}</strong>，当前物料库存 {b.materialStock}
                          {bad ? " 不足" : ""}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            },
            rowExpandable: (r) => r.bom != null && r.bom.length > 0,
          }}
        />
      )}
    </Card>
  );
}
