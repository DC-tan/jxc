"use client";

import { App, Button, Card, Input, InputNumber, Modal, Select, Space, Spin, Typography } from "antd";
import dayjs from "dayjs";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  mergeDeliveryNotePrintConfig,
  type DeliveryNoteTemplateConfig,
} from "@/lib/delivery-note-print-template";
import { fetchJson } from "@/lib/fetch-json";
import type { WarehouseDeliveryDraft } from "@/lib/warehouse-delivery-draft";
import type { WarehouseDeliveryLineDraft } from "@/lib/warehouse-delivery-draft";
import {
  WAREHOUSE_DELIVERY_DRAFT_KEY,
  buildNoOrderDeliveryDraft,
} from "@/lib/warehouse-delivery-draft";
import { WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK } from "@/lib/warehouse-product-ship-out";
import {
  buildShipmentQueryPreview,
  getDeliveryNoteNoForBatchAt,
  listUniqueShipmentBatchAts,
  parseShipmentBatchIndex,
} from "@/lib/warehouse-shipment-query-preview";
import {
  buildDeliveryLineRemarkText,
  lineOutboundTotal,
  slipQuantityDisplay,
} from "@/lib/warehouse-delivery-remark";
import {
  DeliveryNoteTemplatePreview,
  type DeliveryNoteLiveSlip,
} from "../DeliveryNoteTemplatePreview";
import "./print.css";

/** 与 print.css 中 @page margin 一致，PDF 可印区与浏览器打印对齐 */
const A5_PRINT_MARGIN_MM = 5;

type CustomerBrief = { id: string; code: string; name: string; shortName?: string | null };

type DetailLine = {
  id: string;
  quantity: number;
  quantityShipped: number;
  remaining: number;
  shipHistory?: {
    at: string;
    qty: number;
    spareQty?: number;
    deliveryNoteNo?: string | null;
  }[];
  unitPrice: string;
  remark: string | null;
  product: {
    id: string;
    customerMaterialCode: string;
    model: string;
    spec: string;
    unit: string;
    productRemark: string | null;
  };
};

type DetailPayload = {
  id: string;
  customerOrderNo: string;
  customerModel: string;
  actualDeliveredAt: string | null;
  customer: CustomerBrief;
  lines: DetailLine[];
};

function buildNoOrderDetailPayload(draft: WarehouseDeliveryDraft): DetailPayload {
  const c = draft.noOrderCustomer!;
  const meta = draft.noOrderLineMeta ?? {};
  return {
    id: draft.orderId,
    customerOrderNo: "—",
    customerModel: "—",
    actualDeliveredAt: draft.actualDeliveredAt,
    customer: {
      id: draft.customerId ?? draft.orderId,
      code: c.code,
      name: c.name,
      shortName: c.shortName,
    },
    lines: draft.lines.map((row) => {
      const m = meta[row.lineId];
      const qty = Math.max(0, Math.trunc(row.shipQty));
      return {
        id: row.lineId,
        quantity: qty,
        quantityShipped: 0,
        remaining: 0,
        unitPrice: "0",
        remark:
          draft.noOrderShipOutRemark?.trim() || WAREHOUSE_NO_ORDER_SHIP_OUT_REMARK,
        product: {
          id: m?.productId ?? row.lineId,
          customerMaterialCode: m?.customerMaterialCode?.trim() || "—",
          model: m?.model?.trim() || "—",
          spec: m?.spec?.trim() || "",
          unit: m?.unit?.trim() || "—",
          productRemark: null,
        },
      };
    }),
  };
}

/** 仅备品、附加备注在打印页维护；实出数量在仓库「确认出货」弹窗填写 */
type LineState = { spare: number; userRemark: string };

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

function saveDraftToSession(next: WarehouseDeliveryDraft) {
  try {
    sessionStorage.setItem(WAREHOUSE_DELIVERY_DRAFT_KEY, JSON.stringify(next));
  } catch {
    /* */
  }
}

function initLineStateFromDraft(d: WarehouseDeliveryDraft): Record<string, LineState> {
  const o: Record<string, LineState> = {};
  for (const l of d.lines) {
    o[l.lineId] = {
      spare: Math.max(0, Math.trunc(l.spareQty ?? 0)),
      userRemark: (l.userRemark ?? "").trim(),
    };
  }
  return o;
}

function mergeLineIntoDraft(
  d: WarehouseDeliveryDraft,
  state: Record<string, LineState>,
): WarehouseDeliveryDraft {
  return {
    ...d,
    lines: d.lines.map((row) => {
      const s = state[row.lineId];
      if (!s) return row;
      return {
        ...row,
        spareQty: s.spare,
        userRemark: s.userRemark || undefined,
      };
    }),
  };
}

type InhouseBackfillBomLine = { materialCode: string; qty: number };

type DeliverOkResponse = {
  ok?: boolean;
  fullyDelivered?: boolean;
  actualDeliveredAt?: string | null;
  inhouseBackfills?: {
    productLabel: string;
    shortQty: number;
    bomLines: InhouseBackfillBomLine[];
  }[];
};

export function DeliveryNotePrintPage() {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<WarehouseDeliveryDraft | null>(null);
  const [lineState, setLineState] = useState<Record<string, LineState>>({});
  const [activeRow, setActiveRow] = useState(0);
  const [spareOpen, setSpareOpen] = useState(false);
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [spareInput, setSpareInput] = useState(1);
  const [userRemarkInput, setUserRemarkInput] = useState("");
  const [cfg, setCfg] = useState<DeliveryNoteTemplateConfig | null>(null);
  const [order, setOrder] = useState<DetailPayload | null>(null);
  const [issuerName, setIssuerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [voidingBatch, setVoidingBatch] = useState(false);
  const [allocatingNo, setAllocatingNo] = useState(false);
  const [docNo, setDocNo] = useState("");
  /** 从「出货查询」进入，只读预览（含分批） */
  const [shipmentQueryPreview, setShipmentQueryPreview] = useState(false);
  /** 出货查询拉取的整单，用于多批切换 */
  const [shipmentPreviewOrder, setShipmentPreviewOrder] = useState<DetailPayload | null>(null);
  const [effShippedBeforeByLine, setEffShippedBeforeByLine] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [bootstrapDone, setBootstrapDone] = useState(false);

  const orderIdFromQuery = searchParams.get("orderId");
  const viewShipment = searchParams.get("view") === "shipment";
  const batchQ = searchParams.get("batch");
  const pathname = usePathname();

  const shipmentBatchAts = useMemo(
    () => (shipmentPreviewOrder ? listUniqueShipmentBatchAts(shipmentPreviewOrder) : []),
    [shipmentPreviewOrder],
  );

  const batchIndex = useMemo(
    () => parseShipmentBatchIndex(shipmentBatchAts, batchQ),
    [shipmentBatchAts, batchQ],
  );

  /** 出货查询：只拉单；批次由 URL `batch` 下标在下一 effect 应用 */
  useEffect(() => {
    let cancelled = false;
    const sessionDraft = readDraft();

    if (
      !viewShipment &&
      sessionDraft?.noOrderShipOut &&
      sessionDraft.customerId
    ) {
      setDraft(sessionDraft);
      setLineState(initLineStateFromDraft(sessionDraft));
      if (sessionDraft.documentNo) setDocNo(sessionDraft.documentNo);
      setShipmentPreviewOrder(null);
      setShipmentQueryPreview(false);
      setEffShippedBeforeByLine(new Map());
      setBootstrapDone(true);
      return () => {
        cancelled = true;
      };
    }

    if (viewShipment && orderIdFromQuery?.startsWith("no-order:")) {
      const inboundId = orderIdFromQuery.slice("no-order:".length);
      (async () => {
        try {
          const preview = await fetchJson<{
            draft: WarehouseDeliveryDraft;
            documentNo: string | null;
          }>(`/api/warehouse/product-ship-out/delivery-preview/${encodeURIComponent(inboundId)}`, {
            credentials: "include",
          });
          if (cancelled) return;
          const d: WarehouseDeliveryDraft = {
            ...preview.draft,
            documentNo: preview.documentNo ?? preview.draft.documentNo,
          };
          setDraft(d);
          setLineState(initLineStateFromDraft(d));
          setDocNo(d.documentNo?.trim() ?? "");
          setShipmentQueryPreview(true);
          setShipmentPreviewOrder(null);
        } catch (e) {
          if (!cancelled) {
            message.error(e instanceof Error ? e.message : "加载失败");
            setDraft(null);
            setShipmentPreviewOrder(null);
          }
        } finally {
          if (!cancelled) setBootstrapDone(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    if (viewShipment && orderIdFromQuery) {
      (async () => {
        try {
          const ord = await fetchJson<DetailPayload>(
            `/api/warehouse/sales-orders/${orderIdFromQuery}`,
            { credentials: "include" },
          );
          if (cancelled) return;
          setShipmentPreviewOrder(ord);
          setShipmentQueryPreview(true);
        } catch (e) {
          if (!cancelled) {
            message.error(e instanceof Error ? e.message : "加载失败");
            setDraft(null);
            setShipmentPreviewOrder(null);
          }
        } finally {
          if (!cancelled) setBootstrapDone(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    setShipmentPreviewOrder(null);
    const d = readDraft();
    if (d) {
      setDraft(d);
      setLineState(initLineStateFromDraft(d));
      if (d.documentNo) setDocNo(d.documentNo);
    } else {
      setDraft(null);
    }
    setShipmentQueryPreview(false);
    setEffShippedBeforeByLine(new Map());
    setBootstrapDone(true);
  }, [viewShipment, orderIdFromQuery, message]);

  /** 按 `batch` 下标生成本批送货单草稿；URL 中 `batch` 为 0 起。 */
  useEffect(() => {
    if (!viewShipment || !shipmentPreviewOrder || !shipmentQueryPreview) return;
    const ats = listUniqueShipmentBatchAts(shipmentPreviewOrder);
    const idx = parseShipmentBatchIndex(ats, batchQ);
    const built = buildShipmentQueryPreview(shipmentPreviewOrder, ats, idx);
    if (!built) {
      message.error("无法根据出货记录生成本批送货单预览");
      setDraft(null);
      return;
    }
    setEffShippedBeforeByLine(built.effShippedBeforeByLineId);
    setDraft(built.draft);
    setLineState(initLineStateFromDraft(built.draft));
    setDocNo("");
  }, [viewShipment, shipmentPreviewOrder, shipmentQueryPreview, batchQ, message]);

  /** 打印/打印预览时仅版式送货单区域，与 print.css 中 body.delivery-slip-print-mode 配合 */
  useEffect(() => {
    document.body.classList.add("delivery-slip-print-mode");
    return () => {
      document.body.classList.remove("delivery-slip-print-mode");
    };
  }, []);

  useEffect(() => {
    if (!draft) {
      setLoading(false);
      return;
    }
    const fromShipmentList =
      shipmentQueryPreview && shipmentPreviewOrder && draft.orderId === shipmentPreviewOrder.id;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (fromShipmentList) {
          const [tpl, me] = await Promise.all([
            fetchJson<{ config: unknown }>("/api/delivery-note-print-template", {
              credentials: "include",
            }),
            fetchJson<{ name: string; loginName: string }>("/api/me", {
              credentials: "include",
            }),
          ]);
          if (cancelled) return;
          setCfg(mergeDeliveryNotePrintConfig(tpl.config));
          setOrder(shipmentPreviewOrder);
          setIssuerName(me.name?.trim() || me.loginName || "—");
        } else if (draft.noOrderShipOut && draft.noOrderCustomer) {
          const [tpl, me] = await Promise.all([
            fetchJson<{ config: unknown }>("/api/delivery-note-print-template", {
              credentials: "include",
            }),
            fetchJson<{ name: string; loginName: string }>("/api/me", {
              credentials: "include",
            }),
          ]);
          if (cancelled) return;
          setCfg(mergeDeliveryNotePrintConfig(tpl.config));
          setOrder(buildNoOrderDetailPayload(draft));
          setIssuerName(me.name?.trim() || me.loginName || "—");
        } else {
          const [tpl, ord, me] = await Promise.all([
            fetchJson<{ config: unknown }>("/api/delivery-note-print-template", {
              credentials: "include",
            }),
            fetchJson<DetailPayload>(`/api/warehouse/sales-orders/${draft.orderId}`, {
              credentials: "include",
            }),
            fetchJson<{ name: string; loginName: string }>("/api/me", {
              credentials: "include",
            }),
          ]);
          if (cancelled) return;
          setCfg(mergeDeliveryNotePrintConfig(tpl.config));
          setOrder(ord);
          setIssuerName(me.name?.trim() || me.loginName || "—");
        }
      } catch (e) {
        if (!cancelled) {
          message.error(e instanceof Error ? e.message : "加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draft, message, shipmentQueryPreview, shipmentPreviewOrder]);

  /** 分配送货单 NO（与销售订单出货相同：进入打印页自动分配） */
  const [docNoTick, setDocNoTick] = useState(0);
  useEffect(() => {
    if (!draft) return;
    if (shipmentQueryPreview) return;

    const existing = docNo.trim() || draft.documentNo?.trim() || "";
    if (existing) {
      if (!docNo.trim() && draft.documentNo?.trim()) {
        setDocNo(draft.documentNo.trim());
      }
      return;
    }

    const readyToAllocate = draft.noOrderShipOut
      ? Boolean(draft.customerId && draft.actualDeliveredAt)
      : Boolean(order);
    if (!readyToAllocate) return;

    let cancelled = false;
    (async () => {
      setAllocatingNo(true);
      try {
        const res = await fetchJson<{ documentNo: string }>(
          "/api/delivery-note-sequence/allocate",
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              draft.noOrderShipOut && draft.customerId
                ? {
                    customerId: draft.customerId,
                    atIso: draft.actualDeliveredAt,
                  }
                : {
                    orderId: draft.orderId,
                    atIso: draft.actualDeliveredAt,
                  },
            ),
          },
        );
        if (cancelled) return;
        setDocNo(res.documentNo);
        setDraft((d) => {
          if (!d) return d;
          const n = { ...d, documentNo: res.documentNo };
          saveDraftToSession(n);
          return n;
        });
      } catch (e) {
        if (!cancelled) {
          message.error(e instanceof Error ? e.message : "分配单号失败");
        }
      } finally {
        if (!cancelled) setAllocatingNo(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    draft,
    order?.id,
    docNo,
    message,
    docNoTick,
    shipmentQueryPreview,
  ]);

  const goShipmentBatch = useCallback(
    (nextIdx: number) => {
      if (shipmentBatchAts.length === 0) return;
      const i = Math.min(Math.max(0, nextIdx), shipmentBatchAts.length - 1);
      const next = new URLSearchParams(searchParams.toString());
      next.set("batch", String(i));
      if (orderIdFromQuery) next.set("orderId", orderIdFromQuery);
      next.set("view", "shipment");
      router.push(`${pathname}?${next.toString()}`);
    },
    [shipmentBatchAts.length, searchParams, pathname, router, orderIdFromQuery],
  );

  const byLine = useMemo(() => {
    const m = new Map<string, DetailLine>();
    for (const l of order?.lines ?? []) m.set(l.id, l);
    return m;
  }, [order]);

  /** 出货查询预览：与完成出货时落库的送货单号一致 */
  const shipmentQueryDocumentNo = useMemo(() => {
    if (!shipmentQueryPreview) return null;
    if (draft?.noOrderShipOut) {
      return draft.documentNo?.trim() || docNo.trim() || null;
    }
    if (!shipmentPreviewOrder) return null;
    if (shipmentBatchAts.length > 0) {
      const bAt = shipmentBatchAts[batchIndex];
      if (!bAt) return null;
      return getDeliveryNoteNoForBatchAt(shipmentPreviewOrder, bAt);
    }
    for (const line of shipmentPreviewOrder.lines) {
      for (const h of line.shipHistory ?? []) {
        const t = h.deliveryNoteNo?.trim();
        if (t) return t;
      }
    }
    return null;
  }, [shipmentQueryPreview, draft, shipmentPreviewOrder, shipmentBatchAts, batchIndex, docNo]);

  const currentBatchAt = useMemo(() => {
    if (!shipmentQueryPreview || shipmentBatchAts.length === 0) return null;
    return shipmentBatchAts[batchIndex] ?? null;
  }, [shipmentQueryPreview, shipmentBatchAts, batchIndex]);

  const slipDocumentNo = useMemo(() => {
    const saved =
      docNo.trim() ||
      draft?.documentNo?.trim() ||
      shipmentQueryDocumentNo?.trim() ||
      "";
    if (saved) return saved;
    if (shipmentQueryPreview) return "—";
    if (allocatingNo) return "分配中…";
    return "（单号待分配，请稍候或点重试）";
  }, [
    shipmentQueryPreview,
    shipmentQueryDocumentNo,
    docNo,
    draft?.documentNo,
    allocatingNo,
  ]);

  const liveSlip: DeliveryNoteLiveSlip | null = useMemo(() => {
    if (!draft || !order || !cfg) return null;
    const at = dayjs(draft.actualDeliveredAt);
    const merged = mergeLineIntoDraft(draft, lineState);
    const slipLines = merged.lines
      .filter((row) => lineOutboundTotal(row) > 0)
      .map((row) => {
        const l = byLine.get(row.lineId);
        if (!l) return null;
        const nameSpec = [l.product.model?.trim(), l.product.spec?.trim()]
          .filter(Boolean)
          .join(" ");
        const effBefore = shipmentQueryPreview
          ? (effShippedBeforeByLine.get(l.id) ?? 0)
          : l.quantityShipped;
        const remark = buildDeliveryLineRemarkText({
          line: row,
          orderLine: l,
          effShippedBefore: effBefore,
        });
        return {
          orderNo: order.customerOrderNo?.trim() || "—",
          materialCode: l.product.customerMaterialCode?.trim() || "—",
          nameSpec: nameSpec || "—",
          unit: l.product.unit || "—",
          quantity: String(slipQuantityDisplay(row)),
          remark,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (slipLines.length === 0) return null;
    return {
      customerName: order.customer.name || order.customer.code,
      dateStr: at.format("YYYY-MM-DD"),
      documentNo: slipDocumentNo,
      issuerName,
      lines: slipLines,
    };
  }, [
    draft,
    order,
    cfg,
    issuerName,
    byLine,
    lineState,
    slipDocumentNo,
    shipmentQueryPreview,
    effShippedBeforeByLine,
  ]);

  const cfgForPrint = useMemo(() => {
    if (!cfg) return null;
    return { ...cfg, footerNote: "" };
  }, [cfg]);

  const persistLineState = useCallback(
    (next: Record<string, LineState> | ((p: Record<string, LineState>) => Record<string, LineState>)) => {
      setLineState((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        setDraft((d) => {
          if (!d) return d;
          const m = mergeLineIntoDraft(d, resolved);
          saveDraftToSession(m);
          return m;
        });
        return resolved;
      });
    },
    [],
  );

  const rowCount = draft?.lines.length ?? 0;
  const getLineIdForRow = useCallback(
    (ri: number) => (draft ? draft.lines[ri]?.lineId : undefined),
    [draft],
  );

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handlePdf = useCallback(async () => {
    const el = document.getElementById("delivery-note-print-area");
    if (!el) {
      message.error("未找到打印区域");
      return;
    }
    setPdfLoading(true);
    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a5",
      });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const m = A5_PRINT_MARGIN_MM;
      const maxW = pageW - 2 * m;
      const maxH = pageH - 2 * m;

      const imgProps = pdf.getImageProperties(imgData);
      const iw = imgProps.width;
      const ih = imgProps.height;
      const rImg = iw / ih;
      const rBox = maxW / maxH;
      let drawW: number;
      let drawH: number;
      if (rImg > rBox) {
        drawW = maxW;
        drawH = maxW / rImg;
      } else {
        drawH = maxH;
        drawW = maxH * rImg;
      }
      const x = m + (maxW - drawW) / 2;
      const y = m + (maxH - drawH) / 2;
      pdf.addImage(imgData, "PNG", x, y, drawW, drawH, undefined, "FAST");
      const name = order?.customerOrderNo?.trim() || draft?.orderId || "送货单";
      const batchPart =
        shipmentQueryPreview && shipmentBatchAts.length > 1
          ? `第${batchIndex + 1}批_`
          : "";
      pdf.save(`送货单_${batchPart}${name}_${dayjs().format("YYYYMMDD_HHmmss")}.pdf`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setPdfLoading(false);
    }
  }, [
    batchIndex,
    draft?.orderId,
    message,
    order?.customerOrderNo,
    shipmentQueryPreview,
    shipmentBatchAts.length,
  ]);

  const handleComplete = useCallback(async () => {
    if (!draft || shipmentQueryPreview) return;
    if (draft.noOrderShipOut) {
      const doc = draft.documentNo?.trim() || docNo.trim();
      if (!doc) {
        message.error("送货单号尚未分配，请稍候或点重试");
        return;
      }
      if (!draft.customerId) {
        message.error("缺少客户信息，请从无单出货重新进入");
        return;
      }
      setCompleting(true);
      const merged = mergeLineIntoDraft(draft, lineState);
      try {
        if (draft.noOrderInboundIds?.length) {
          await fetchJson("/api/warehouse/product-ship-out/attach-delivery-note", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              inboundIds: draft.noOrderInboundIds,
              documentNo: doc,
            }),
          });
        } else {
          await fetchJson("/api/warehouse/product-ship-out", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customerId: draft.customerId,
              shippedAt: merged.actualDeliveredAt,
              deliveryNoteNo: doc,
              remark: draft.noOrderShipOutRemark?.trim() || undefined,
              lines: merged.lines
                .map((l) => ({
                  productId: l.lineId,
                  shipQty: lineOutboundTotal(l),
                }))
                .filter((x) => x.shipQty > 0),
            }),
          });
        }
        sessionStorage.removeItem(WAREHOUSE_DELIVERY_DRAFT_KEY);
        message.success("无单出货已完成，库存已扣减");
        router.push("/dashboard/warehouse?tab=query");
      } catch (e) {
        message.error(e instanceof Error ? e.message : "提交失败");
      } finally {
        setCompleting(false);
      }
      return;
    }
    setCompleting(true);
    const merged = mergeLineIntoDraft(draft, lineState);
    try {
      const res = await fetchJson<DeliverOkResponse>(
        `/api/warehouse/sales-orders/${draft.orderId}/deliver`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actualDeliveredAt: draft.actualDeliveredAt,
            documentNo: draft.documentNo?.trim() || null,
            lines: merged.lines
              .map((l) => ({
                lineId: l.lineId,
                shipQty: slipQuantityDisplay(l),
                spareQty: Math.max(0, Math.trunc(l.spareQty ?? 0)),
              }))
              .filter((x) => x.shipQty > 0),
            ...(draft.inhouseProduceByLineId &&
            Object.keys(draft.inhouseProduceByLineId).length > 0
              ? { inhouseProduceByLineId: draft.inhouseProduceByLineId }
              : {}),
            ...(draft.hybridInhouseProduceByLineId &&
            Object.keys(draft.hybridInhouseProduceByLineId).length > 0
              ? {
                  hybridInhouseProduceByLineId:
                    draft.hybridInhouseProduceByLineId,
                }
              : {}),
          }),
        },
      );
      sessionStorage.removeItem(WAREHOUSE_DELIVERY_DRAFT_KEY);

      const goWarehouse = () => router.push("/dashboard/warehouse");

      if (res.fullyDelivered) {
        message.success("出货已完成，库存已扣减");
      } else {
        message.success("本批出货已确认，库存已扣减");
      }
      goWarehouse();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setCompleting(false);
    }
  }, [draft, docNo, lineState, message, router, shipmentQueryPreview]);

  const handleCancel = useCallback(() => {
    if (shipmentQueryPreview) {
      router.push("/dashboard/warehouse?tab=query");
      return;
    }
    sessionStorage.removeItem(WAREHOUSE_DELIVERY_DRAFT_KEY);
    router.push("/dashboard/warehouse");
  }, [router, shipmentQueryPreview]);

  const handleBackStep = useCallback(() => {
    if (shipmentQueryPreview) {
      router.push("/dashboard/warehouse?tab=query");
      return;
    }
    if (draft?.noOrderShipOut) {
      router.push("/dashboard/warehouse");
      return;
    }
    if (!draft) return;
    saveDraftToSession(mergeLineIntoDraft(draft, lineState));
    if (draft.needsInhouseStep) {
      router.push("/dashboard/warehouse/delivery-inhouse");
    } else {
      router.push("/dashboard/warehouse");
    }
  }, [draft, lineState, router, shipmentQueryPreview]);

  const voidCurrentBatch = useCallback(() => {
    if (!shipmentQueryPreview || !shipmentPreviewOrder || !currentBatchAt) {
      message.warning("当前批次信息缺失，无法作废");
      return;
    }
    modal.confirm({
      title: "作废当前送货单批次？",
      content:
        "作废后仅回退当前批次出货数量，其他批次不受影响；对应订单会按剩余出货情况自动回到可出货状态。",
      okType: "danger",
      okText: "确认作废",
      cancelText: "取消",
      onOk: async () => {
        setVoidingBatch(true);
        try {
          const res = await fetchJson<{ revertedQty?: number }>(
            `/api/warehouse/sales-orders/${shipmentPreviewOrder.id}/void-batch`,
            {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                batchDeliveredAt: currentBatchAt,
                deliveryNoteNo: shipmentQueryDocumentNo,
              }),
            },
          );
          message.success(`已作废本批，回退数量 ${Math.max(0, Number(res.revertedQty ?? 0))}`);
          const ord = await fetchJson<DetailPayload>(
            `/api/warehouse/sales-orders/${shipmentPreviewOrder.id}`,
            { credentials: "include" },
          );
          setShipmentPreviewOrder(ord);
          const ats = listUniqueShipmentBatchAts(ord);
          if (ats.length === 0) {
            router.push("/dashboard/warehouse?tab=query");
            return;
          }
          if (batchIndex >= ats.length) {
            const next = new URLSearchParams(searchParams.toString());
            next.set("batch", String(ats.length - 1));
            next.set("view", "shipment");
            next.set("orderId", shipmentPreviewOrder.id);
            router.push(`${pathname}?${next.toString()}`);
          }
        } catch (e) {
          message.error(e instanceof Error ? e.message : "作废失败");
          throw e;
        } finally {
          setVoidingBatch(false);
        }
      },
    });
  }, [
    shipmentQueryPreview,
    shipmentPreviewOrder,
    currentBatchAt,
    shipmentQueryDocumentNo,
    message,
    modal,
    router,
    batchIndex,
    searchParams,
    pathname,
  ]);

  const openAddSpare = useCallback(() => {
    if (!draft || rowCount === 0) return;
    if (activeRow < 0 || activeRow >= rowCount) {
      message.warning("请先在左侧送货单表格中点击一行");
      return;
    }
    const lid = getLineIdForRow(activeRow);
    if (!lid) return;
    const cur = lineState[lid] ?? { spare: 0, userRemark: "" };
    setSpareInput(Math.max(0, cur.spare));
    setSpareOpen(true);
  }, [draft, rowCount, activeRow, getLineIdForRow, lineState, message]);

  const openAddUserRemark = useCallback(() => {
    if (!draft || rowCount === 0) return;
    if (activeRow < 0 || activeRow >= rowCount) {
      message.warning("请先在左侧送货单表格中点击一行");
      return;
    }
    const lid = getLineIdForRow(activeRow);
    if (!lid) return;
    setUserRemarkInput((lineState[lid] ?? { spare: 0, userRemark: "" }).userRemark);
    setRemarkOpen(true);
  }, [draft, rowCount, activeRow, getLineIdForRow, lineState, message]);

  const applySpare = useCallback(() => {
    const n = Math.max(0, Math.trunc(spareInput));
    const lid = getLineIdForRow(activeRow);
    if (!lid) return;
    setSpareOpen(false);
    persistLineState((prev) => {
      const cur = prev[lid] ?? { spare: 0, userRemark: "" };
      return { ...prev, [lid]: { ...cur, spare: n } };
    });
  }, [spareInput, getLineIdForRow, activeRow, persistLineState]);

  const applyUserRemark = useCallback(() => {
    const lid = getLineIdForRow(activeRow);
    if (!lid) return;
    setRemarkOpen(false);
    const text = userRemarkInput.replace(/\r/g, "").trim();
    persistLineState((prev) => {
      const cur = prev[lid] ?? { spare: 0, userRemark: "" };
      return { ...prev, [lid]: { ...cur, userRemark: text } };
    });
  }, [getLineIdForRow, activeRow, userRemarkInput, persistLineState]);

  const isBootingShipmentQuery = viewShipment && orderIdFromQuery && !bootstrapDone;
  if (isBootingShipmentQuery) {
    return (
      <Card className="warehouse-delivery-slip-print-scope" title="送货单预览（出货查询）">
        {/** tip 仅支持嵌套或全屏，需有子节点 */}
        <Spin tip="加载中…" size="large">
          <div style={{ minHeight: 200 }} />
        </Spin>
      </Card>
    );
  }

  if (!draft && !loading && bootstrapDone) {
    return (
      <Card className="warehouse-delivery-slip-print-scope" title="送货单打印">
        <Typography.Paragraph>
          {viewShipment && orderIdFromQuery
            ? "无法根据出货记录打开送货单预览。若订单有分批出货，请确认已保存分批记录。"
            : "没有待打印的出货草稿，请从仓库出货流程进入。"}
        </Typography.Paragraph>
        <Link href={viewShipment && orderIdFromQuery ? "/dashboard/warehouse?tab=query" : "/dashboard/warehouse"}>
          {viewShipment && orderIdFromQuery ? "返回出货查询" : "返回仓库出货"}
        </Link>
      </Card>
    );
  }

  return (
    <Card
      className="warehouse-delivery-slip-print-scope"
      title={
        shipmentQueryPreview
          ? "送货单预览（出货查询，只读）"
          : draft?.noOrderShipOut
            ? "无单出货 · 送货单打印（A5 横向）"
            : "送货单打印（A5 横向）"
      }
      styles={{ body: { overflow: "visible" } }}
      extra={
        shipmentQueryPreview ? null : (
          <Space>
            <Button onClick={openAddSpare}>备品数量</Button>
            <Button onClick={openAddUserRemark}>备注信息</Button>
          </Space>
        )
      }
    >
      <div className="warehouse-delivery-no-print" style={{ marginBottom: 16 }}>
        {shipmentQueryPreview && shipmentBatchAts.length > 0 ? (
          <div style={{ marginBottom: 10 }}>
            <Space wrap align="center">
              {shipmentBatchAts.length > 1 ? (
                <>
                  <Button
                    type="text"
                    disabled={batchIndex <= 0}
                    onClick={() => goShipmentBatch(batchIndex - 1)}
                  >
                    上一批
                  </Button>
                  <Typography.Text>
                    第 {batchIndex + 1} / {shipmentBatchAts.length} 批
                  </Typography.Text>
                  <Button
                    type="text"
                    disabled={batchIndex >= shipmentBatchAts.length - 1}
                    onClick={() => goShipmentBatch(batchIndex + 1)}
                  >
                    下一批
                  </Button>
                  <Select
                    value={batchIndex}
                    onChange={(v) => goShipmentBatch(Number(v))}
                    options={shipmentBatchAts.map((at, i) => ({
                      value: i,
                      label: `第${i + 1} 批（${dayjs(at).format("YYYY-MM-DD HH:mm")}）`,
                    }))}
                    style={{ minWidth: 220 }}
                    popupMatchSelectWidth={false}
                  />
                </>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  本单仅一批出货
                </Typography.Text>
              )}
            </Space>
          </div>
        ) : null}
        {shipmentQueryPreview ? (
          <div style={{ marginBottom: 10 }}>
            <Typography.Text>
              送货单号（与完成出货时一致）：
              {shipmentQueryDocumentNo?.trim() ? (
                <strong style={{ marginLeft: 8 }}>{shipmentQueryDocumentNo.trim()}</strong>
              ) : (
                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                  无存档（历史数据或未带单号完成出货）
                </Typography.Text>
              )}
            </Typography.Text>
          </div>
        ) : draft?.noOrderShipOut ? (
          <div style={{ marginBottom: 10 }}>
            <Typography.Text>
              送货单号：
              {slipDocumentNo && !slipDocumentNo.startsWith("（") && slipDocumentNo !== "分配中…" ? (
                <strong style={{ marginLeft: 8 }}>{slipDocumentNo}</strong>
              ) : (
                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                  {allocatingNo ? "分配中…" : "待分配"}
                </Typography.Text>
              )}
            </Typography.Text>
          </div>
        ) : null}
        <Space wrap>
          {shipmentQueryPreview ? null : (
            <Button
              type="primary"
              onClick={() => void handleComplete()}
              loading={completing}
              disabled={
                draft?.noOrderShipOut
                  ? !(docNo.trim() || draft.documentNo?.trim()) || allocatingNo
                  : false
              }
            >
              {draft?.noOrderShipOut ? "确定" : "完成"}
            </Button>
          )}
          <Button onClick={handleBackStep}>
            {shipmentQueryPreview ? "返回出货查询" : "返回上一步"}
          </Button>
          <Button onClick={handlePrint}>打印</Button>
          <Button
            onClick={() => void handlePdf()}
            loading={pdfLoading}
            disabled={!liveSlip}
          >
            导出 PDF
          </Button>
          {shipmentQueryPreview && !draft?.noOrderShipOut ? (
            <Button
              danger
              onClick={voidCurrentBatch}
              disabled={!currentBatchAt}
              loading={voidingBatch}
            >
              作废本批
            </Button>
          ) : null}
          <Button onClick={handleCancel}>
            {shipmentQueryPreview ? "关闭" : "取消"}
          </Button>
          {shipmentQueryPreview ? null : !docNo && !allocatingNo && !loading && order && draft ? (
            <Button type="link" onClick={() => setDocNoTick((n) => n + 1)}>
              重试分配单号
            </Button>
          ) : null}
          {allocatingNo ? <Typography.Text type="secondary">单号分配中…</Typography.Text> : null}
          {shipmentQueryPreview ? (
            <Typography.Text type="secondary">
              {draft?.noOrderShipOut
                ? "无单出货送货单只读预览；送货单号与打印完成时一致。可打印、导出 PDF。"
                : "送货单号按本批出货写入记录显示，与当时点击「完成」时一致；无存档时见灰字说明。按每批出货时间还原行数量与日期；多批可用「上一批/下一批」或下拉。当批备品/附加备注未存档时本页不显示。可打印、导出 PDF。"}
            </Typography.Text>
          ) : draft?.noOrderShipOut ? (
            <Typography.Text type="secondary">
              可设置备品/备注后打印或导出 PDF；点「确定」后扣减库存并登记出库。点「取消」不扣库存。
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">
              出货物量在仓库「确认出货」中已填；在左侧点选一行后可设置「备品数量」「备注信息」（可反复修改）。点「完成」后登记出库存。点「取消」不记档。
            </Typography.Text>
          )}
        </Space>
      </div>
      <Modal
        title="备品数量"
        open={spareOpen}
        onOk={applySpare}
        onCancel={() => setSpareOpen(false)}
        destroyOnHidden
        okText="确定"
      >
        <Typography.Paragraph type="secondary">
          备品会额外扣减库存，并写在备注中「备品 N」；但不计入订单已出货、待出货与对帐数量。填{" "}
          <strong>0</strong> 表示本行不记备品。可与其它备注换行同列显示。
        </Typography.Paragraph>
        <div style={{ marginTop: 8 }}>
          数量{" "}
          <InputNumber
            min={0}
            value={spareInput}
            onChange={(v) => setSpareInput(typeof v === "number" && !Number.isNaN(v) ? v : 0)}
            style={{ minWidth: 120 }}
          />
        </div>
      </Modal>
      <Modal
        title="备注信息"
        open={remarkOpen}
        onOk={applyUserRemark}
        onCancel={() => setRemarkOpen(false)}
        destroyOnHidden
        okText="确定"
        width={480}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          显示在送货单本行「备注」列，排在订单原备注、超量/备品说明之后；可多次修改。
        </Typography.Paragraph>
        <Input.TextArea
          rows={4}
          value={userRemarkInput}
          onChange={(e) => setUserRemarkInput(e.target.value)}
          placeholder="多行可换行；留空则仅显示系统自动生成的内容"
        />
      </Modal>
      {loading || !cfgForPrint || !order ? (
        <Spin tip="加载中…">
          <div style={{ minHeight: 240 }} />
        </Spin>
      ) : !liveSlip ? (
        <Typography.Text type="danger">
          无法生成送货单：本批无有效行（出货数为 0）或数据异常。请「返回上一步」检查。
        </Typography.Text>
      ) : (
        <div id="delivery-note-print-area" className="delivery-note-print-area-wrap">
          <DeliveryNoteTemplatePreview
            cfg={cfgForPrint}
            liveSlip={liveSlip}
            rootClassName="delivery-note-a5-landscape"
            liveSlipActiveRow={shipmentQueryPreview ? undefined : activeRow}
            onLiveSlipRowClick={shipmentQueryPreview ? undefined : setActiveRow}
          />
        </div>
      )}
    </Card>
  );
}
