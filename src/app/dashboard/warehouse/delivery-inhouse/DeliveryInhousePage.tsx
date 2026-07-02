"use client";

import { App, Button, Card, InputNumber, Space, Spin, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { bomNeedForShort } from "@/lib/bom-need";
import { fetchJson } from "@/lib/fetch-json";
import {
  defaultInhouseProduceQty,
  inhouseProduceTooLowToShipMessage,
  shipmentNeedsInhouseStep,
} from "@/lib/warehouse-delivery-inhouse-step";
import {
  WAREHOUSE_DELIVERY_DRAFT_KEY,
  type WarehouseDeliveryDraft,
  isMergedDeliveryDraft,
} from "@/lib/warehouse-delivery-draft";
import { runMergedDeliverPreview } from "@/lib/warehouse-merged-deliver";

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
  defaultProduceQty?: number;
  inhouseProduceQty?: number;
  bom: BomRow[] | null;
};

type PreviewOk = { needsInhouseStep: boolean; lines: PreviewLine[] };

function readDraft(): WarehouseDeliveryDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(WAREHOUSE_DELIVERY_DRAFT_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as WarehouseDeliveryDraft;
    if (!Array.isArray(j.lines)) return null;
    if (!j.orderId && !(j.orderIds?.length ?? 0)) return null;
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
      const fetchPreview = (orderId: string, body: object) =>
        fetchJson<PreviewOk>(
          `/api/warehouse/sales-orders/${orderId}/deliver-preview`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
      let res: PreviewOk;
      if (isMergedDeliveryDraft(d)) {
        const merged = await runMergedDeliverPreview(d, fetchPreview);
        res = {
          needsInhouseStep: merged.needsInhouseStep,
          lines: merged.lines as PreviewLine[],
        };
      } else {
        res = await fetchPreview(d.orderId, {
          lines: d.lines.filter((x) => x.shipQty > 0),
          inhouseProduceByLineId: d.inhouseProduceByLineId,
          hybridInhouseProduceByLineId: d.hybridInhouseProduceByLineId,
        });
      }
      setPreview(res);
      const shipByLine = Object.fromEntries(
        d.lines.map((row) => [row.lineId, row.shipQty]),
      );
      const produceByLine = {
        ...d.inhouseProduceByLineId,
        ...d.hybridInhouseProduceByLineId,
      };
      const stepLines = res.lines.map((ln) => ({
        lineId: ln.lineId,
        processingMode: ln.processingMode,
        productStock: ln.productStock,
      }));
      const needsStep =
        d.needsInhouseStep === true ||
        (d.needsInhouseStep !== false &&
          res.needsInhouseStep &&
          shipmentNeedsInhouseStep(stepLines, shipByLine, produceByLine));
      if (!needsStep) {
        sessionStorage.setItem(
          WAREHOUSE_DELIVERY_DRAFT_KEY,
          JSON.stringify({ ...d, needsInhouseStep: false }),
        );
        router.replace("/dashboard/warehouse/delivery-note");
        return;
      }
      const next: Record<string, number> = { ...produceByLine };
      for (const ln of res.lines) {
        if (ln.short <= 0) continue;
        const minProduce =
          ln.defaultProduceQty ??
          defaultInhouseProduceQty(ln.shipQty, ln.productStock);
        const total = ln.inhouseProduceQty ?? minProduce + ln.short;
        const fromDraft =
          d.hybridInhouseProduceByLineId?.[ln.lineId] ??
          d.inhouseProduceByLineId?.[ln.lineId];
        const cur = next[ln.lineId];
        next[ln.lineId] =
          typeof fromDraft === "number" && fromDraft >= minProduce
            ? fromDraft
            : typeof cur === "number" && cur >= minProduce
              ? cur
              : total;
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
      const minProduce =
        ln.defaultProduceQty ??
        defaultInhouseProduceQty(ln.shipQty, ln.productStock);
      const p = produceByLine[ln.lineId] ?? minProduce + ln.short;
      if (p < minProduce) {
        msg.error(inhouseProduceTooLowToShipMessage(ln.productLabel));
        return;
      }
      for (const b of ln.bom ?? []) {
        const need = bomNeedForShort(b.usageQty, p);
        if (need > 0 && b.materialStock < need) {
          msg.error(
            `按现入库 ${p} 件测算：物料「${(b as { materialPart?: string }).materialPart ?? b.materialName ?? b.materialCode}」需 ${need}，库存 ${b.materialStock} 不足。请调低入库或先补料。`,
          );
          return;
        }
      }
    }
    const inhouseProduceByLineId: Record<string, number> = {
      ...draft.inhouseProduceByLineId,
    };
    const hybridInhouseProduceByLineId: Record<string, number> = {
      ...draft.hybridInhouseProduceByLineId,
    };
    for (const ln of inhouseShortLines) {
      const minProduce =
        ln.defaultProduceQty ??
        defaultInhouseProduceQty(ln.shipQty, ln.productStock);
      const p = produceByLine[ln.lineId] ?? minProduce + ln.short;
      inhouseProduceByLineId[ln.lineId] = p;
      if (ln.processingMode === "OUTSOURCE_INHOUSE") {
        hybridInhouseProduceByLineId[ln.lineId] = p;
      }
    }
    const nextDraft: WarehouseDeliveryDraft = {
      ...draft,
      inhouseProduceByLineId,
      hybridInhouseProduceByLineId,
      needsInhouseStep: true,
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
        title: "现库存",
        key: "stock",
        width: 108,
        align: "right",
        render: (_, r) => r.productStock,
      },
      {
        title: "不足/超出",
        key: "short",
        width: 96,
        align: "right",
        render: (_, r) => {
          if (r.short <= 0) return "0";
          return (
            <Typography.Text type="danger">+{r.short} 补产</Typography.Text>
          );
        },
      },
      {
        title: "本批自加工完工",
        key: "in",
        width: 200,
        render: (_, r) => {
          if (r.short <= 0) {
            return <Typography.Text type="secondary">—</Typography.Text>;
          }
          const minVal =
            r.defaultProduceQty ??
            defaultInhouseProduceQty(r.shipQty, r.productStock);
          return (
            <InputNumber
              min={0}
              max={1_000_000}
              precision={0}
              value={produceByLine[r.lineId] ?? minVal + r.short}
              onChange={(v) => {
                if (v === null || v === undefined) return;
                const raw = Math.trunc(Number(v));
                if (!Number.isFinite(raw)) return;
                const n = Math.max(0, Math.min(1_000_000, raw));
                setProduceByLine((prev) => ({ ...prev, [r.lineId]: n }));
              }}
              onBlur={() => {
                const p = produceByLine[r.lineId] ?? minVal + r.short;
                if (p < minVal) {
                  msg.warning(inhouseProduceTooLowToShipMessage(r.productLabel));
                }
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
          当确认出货时填写的<strong>本批自加工完工数</strong>大于系统默认数（默认 = 本批出货 − 商品库存，库存≥出货时为
          0）时进入本页。请确认或调整<strong>本批自加工完工</strong>
          件数，下方为 BOM 物料扣量。外发+自加工另须外发回收库≥本批自加工完工数。送货单点<strong>完成</strong>后扣料、登记库存与出货。
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
          dataSource={inhouseShortLines}
          scroll={{ x: "max-content" }}
          defaultExpandedRowKeys={inhouseShortLines.map((r) => r.lineId)}
          expandable={{
            expandedRowRender: (r) => {
              if (r.short <= 0) {
                return (
                  <Typography.Text type="secondary">
                    本行无完工超出，无需确认
                  </Typography.Text>
                );
              }
              const minP =
                r.defaultProduceQty ??
                defaultInhouseProduceQty(r.shipQty, r.productStock);
              const p = produceByLine[r.lineId] ?? minP + r.short;
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
