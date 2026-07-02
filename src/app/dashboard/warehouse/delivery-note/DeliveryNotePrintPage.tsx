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
  deliveryDraftOrderIds,
  isMergedDeliveryDraft,
} from "@/lib/warehouse-delivery-draft";
import {
  pickInhouseMapsForOrder,
} from "@/lib/warehouse-merged-deliver";
import {
  liveSlipToVoucherSnapshot,
  type DeliveryNoteLiveSlip,
} from "@/lib/delivery-note-voucher";
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
    if (!Array.isArray(j.lines)) return null;
    if (!j.orderId && !(j.orderIds?.length ?? 0)) return null;
    const { documentNo: _previewNo, ...rest } = j;
    return rest;
  } catch {
    return null;
  }
}

function saveDraftToSession(next: WarehouseDeliveryDraft) {
  try {
    const { documentNo: _previewNo, ...payload } = next;
    sessionStorage.setItem(WAREHOUSE_DELIVERY_DRAFT_KEY, JSON.stringify(payload));
  } catch {
    /* */
  }
}

/** 预览阶段占位（加载失败时） */
const PENDING_SLIP_DOCUMENT_NO = "（单号加载中…）";

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
  const [mergedOrdersById, setMergedOrdersById] = useState<
    Map<string, DetailPayload>
  >(() => new Map());
  const [issuerName, setIssuerName] = useState("");
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [voidingBatch, setVoidingBatch] = useState(false);
  const [docNo, setDocNo] = useState("");
  /** 预览单号（不占用流水；点「完成」时 allocate 才正式生效） */
  const [previewDocNo, setPreviewDocNo] = useState("");
  const [previewDocLoading, setPreviewDocLoading] = useState(false);
  /** 从「出货查询」进入，只读预览（含分批） */
  const [shipmentQueryPreview, setShipmentQueryPreview] = useState(false);
  /** 出货查询拉取的整单，用于多批切换 */
  const [shipmentPreviewOrder, setShipmentPreviewOrder] = useState<DetailPayload | null>(null);
  const [effShippedBeforeByLine, setEffShippedBeforeByLine] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [bootstrapDone, setBootstrapDone] = useState(false);
  /** 已确认存档的送货单凭证（只读，与打印时一致） */
  const [voucherLiveSlip, setVoucherLiveSlip] = useState<DeliveryNoteLiveSlip | null>(
    null,
  );
  const [voucherVoidedAt, setVoucherVoidedAt] = useState<string | null>(null);
  /** 凭证来源：存档 / 历史出货还原 */
  const [voucherSource, setVoucherSource] = useState<
    "voucher" | "ship_logs" | "no_order" | null
  >(null);
  const [voucherLoadFailed, setVoucherLoadFailed] = useState(false);
  /** 凭证对应出货批次时间与关联订单（作废本批用） */
  const [voucherDeliveredAt, setVoucherDeliveredAt] = useState<string | null>(null);
  const [voucherOrderIds, setVoucherOrderIds] = useState<string[]>([]);

  const orderIdFromQuery = searchParams.get("orderId");
  const documentNoFromQuery = searchParams.get("documentNo");
  const viewShipment = searchParams.get("view") === "shipment";
  const viewVoucher = searchParams.get("view") === "voucher";
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

  /** 出货查询 / 凭证预览：只拉单或凭证 */
  useEffect(() => {
    let cancelled = false;
    const sessionDraft = readDraft();

    if (viewVoucher && documentNoFromQuery?.trim()) {
      setDraft(null);
      setLineState({});
      setVoucherLoadFailed(false);
      setVoucherSource(null);
      setVoucherLiveSlip(null);
      setVoucherVoidedAt(null);
      setVoucherDeliveredAt(null);
      setVoucherOrderIds([]);
      setShipmentQueryPreview(false);
      (async () => {
        try {
          setLoading(true);
          const tpl = await fetchJson<{ config: unknown }>(
            "/api/delivery-note-print-template",
            { credentials: "include" },
          );
          if (cancelled) return;
          setCfg(mergeDeliveryNotePrintConfig(tpl.config));

          const voucher = await fetchJson<{
            liveSlip: DeliveryNoteLiveSlip;
            voidedAt: string | null;
            documentNo: string;
            deliveredAt: string;
            orderIds?: string[];
            source?: "voucher" | "ship_logs" | "no_order";
          }>(
            `/api/warehouse/delivery-notes/voucher?documentNo=${encodeURIComponent(documentNoFromQuery.trim())}`,
            { credentials: "include" },
          );
          if (cancelled) return;
          setVoucherLiveSlip(voucher.liveSlip);
          setVoucherVoidedAt(voucher.voidedAt);
          setVoucherDeliveredAt(voucher.deliveredAt);
          setVoucherOrderIds(voucher.orderIds ?? []);
          setDocNo(voucher.documentNo);
          setVoucherSource(voucher.source ?? "voucher");
          setDraft(null);
          setShipmentPreviewOrder(null);
          setShipmentQueryPreview(true);
          setEffShippedBeforeByLine(new Map());
        } catch (e) {
          if (!cancelled) {
            message.error(e instanceof Error ? e.message : "加载送货单凭证失败");
            setVoucherLiveSlip(null);
            setVoucherLoadFailed(true);
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
            setBootstrapDone(true);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (
      !viewShipment &&
      sessionDraft?.noOrderShipOut &&
      sessionDraft.customerId
    ) {
      setDraft(sessionDraft);
      setLineState(initLineStateFromDraft(sessionDraft));
      setDocNo("");
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
      setDocNo("");
    } else {
      setDraft(null);
    }
    setShipmentQueryPreview(false);
    setEffShippedBeforeByLine(new Map());
    setBootstrapDone(true);
  }, [viewShipment, viewVoucher, documentNoFromQuery, orderIdFromQuery, message]);

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
    if (viewVoucher) return;
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
        } else if (isMergedDeliveryDraft(draft)) {
          const orderIds = deliveryDraftOrderIds(draft);
          const [tpl, ...orders] = await Promise.all([
            fetchJson<{ config: unknown }>("/api/delivery-note-print-template", {
              credentials: "include",
            }),
            ...orderIds.map((id) =>
              fetchJson<DetailPayload>(`/api/warehouse/sales-orders/${id}`, {
                credentials: "include",
              }),
            ),
            fetchJson<{ name: string; loginName: string }>("/api/me", {
              credentials: "include",
            }),
          ]);
          const me = orders.pop() as { name: string; loginName: string };
          const orderPayloads = orders as DetailPayload[];
          if (cancelled) return;
          const byId = new Map(orderPayloads.map((o) => [o.id, o]));
          setMergedOrdersById(byId);
          const primary = orderPayloads[0] ?? null;
          setCfg(mergeDeliveryNotePrintConfig(tpl.config));
          setOrder(primary);
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
          setMergedOrdersById(new Map([[ord.id, ord]]));
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
  }, [draft, message, shipmentQueryPreview, shipmentPreviewOrder, viewVoucher]);

  const persistDeliveryVoucher = useCallback(
    async (slip: DeliveryNoteLiveSlip, input: {
      customerId: string;
      deliveredAt: string;
      mergedShip?: boolean;
      orderIds?: string[];
    }) => {
      const documentNo = slip.documentNo.trim();
      if (!documentNo || documentNo === "—") {
        throw new Error("送货单号无效，无法存档");
      }
      await fetchJson("/api/warehouse/delivery-notes/voucher", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentNo,
          customerId: input.customerId,
          deliveredAt: input.deliveredAt,
          mergedShip: input.mergedShip ?? false,
          snapshot: liveSlipToVoucherSnapshot(slip, input.orderIds),
        }),
      });
    },
    [],
  );

  const allocateDeliveryDocumentNo = useCallback(
    async (d: WarehouseDeliveryDraft, ord: DetailPayload | null): Promise<string> => {
      const res = await fetchJson<{ documentNo: string }>(
        "/api/delivery-note-sequence/allocate",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            d.noOrderShipOut && d.customerId
              ? {
                  customerId: d.customerId,
                  atIso: d.actualDeliveredAt,
                }
              : isMergedDeliveryDraft(d)
                ? {
                    customerId: ord?.customer.id,
                    atIso: d.actualDeliveredAt,
                  }
                : {
                    orderId: d.orderId,
                    atIso: d.actualDeliveredAt,
                  },
          ),
        },
      );
      return res.documentNo.trim();
    },
    [],
  );

  const deliveryNoRequestBody = useCallback(
    (d: WarehouseDeliveryDraft, ord: DetailPayload | null) =>
      d.noOrderShipOut && d.customerId
        ? {
            customerId: d.customerId,
            atIso: d.actualDeliveredAt,
          }
        : isMergedDeliveryDraft(d)
          ? {
              customerId: ord?.customer.id,
              atIso: d.actualDeliveredAt,
            }
          : {
              orderId: d.orderId,
              atIso: d.actualDeliveredAt,
            },
    [],
  );

  /** 预览下一送货单号（不写库） */
  useEffect(() => {
    if (!draft || shipmentQueryPreview || viewVoucher) {
      setPreviewDocNo("");
      setPreviewDocLoading(false);
      return;
    }
    const ready = draft.noOrderShipOut
      ? Boolean(draft.customerId && draft.actualDeliveredAt)
      : Boolean(order);
    if (!ready) {
      setPreviewDocNo("");
      return;
    }

    let cancelled = false;
    (async () => {
      setPreviewDocLoading(true);
      try {
        const res = await fetchJson<{ documentNo: string }>(
          "/api/delivery-note-sequence/preview",
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(deliveryNoRequestBody(draft, order)),
          },
        );
        if (!cancelled) setPreviewDocNo(res.documentNo.trim());
      } catch (e) {
        if (!cancelled) {
          setPreviewDocNo("");
          message.error(e instanceof Error ? e.message : "预览单号失败");
        }
      } finally {
        if (!cancelled) setPreviewDocLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    draft,
    order,
    shipmentQueryPreview,
    viewVoucher,
    deliveryNoRequestBody,
    message,
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
    if (isMergedDeliveryDraft(draft ?? { orderId: "", actualDeliveredAt: "", lines: [] })) {
      for (const o of mergedOrdersById.values()) {
        for (const l of o.lines) m.set(l.id, l);
      }
      return m;
    }
    for (const l of order?.lines ?? []) m.set(l.id, l);
    return m;
  }, [order, mergedOrdersById, draft]);

  const orderNoForLine = useCallback(
    (lineId: string): string => {
      const map = draft?.lineOrderIdByLineId ?? {};
      const oid = map[lineId] ?? draft?.orderId ?? order?.id;
      if (!oid) return order?.customerOrderNo?.trim() || "—";
      return mergedOrdersById.get(oid)?.customerOrderNo?.trim() || "—";
    },
    [draft, order, mergedOrdersById],
  );

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
      previewDocNo.trim() ||
      shipmentQueryDocumentNo?.trim() ||
      "";
    if (saved) return saved;
    if (shipmentQueryPreview) return "—";
    if (previewDocLoading) return "单号加载中…";
    return PENDING_SLIP_DOCUMENT_NO;
  }, [
    shipmentQueryPreview,
    shipmentQueryDocumentNo,
    docNo,
    previewDocNo,
    previewDocLoading,
  ]);

  const buildCurrentLiveSlip = useCallback(
    (documentNoOverride?: string): DeliveryNoteLiveSlip | null => {
    if (!draft || !order) return null;
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
          orderNo: orderNoForLine(row.lineId),
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
      documentNo: documentNoOverride?.trim() || slipDocumentNo,
      issuerName,
      lines: slipLines,
    };
  }, [
    draft,
    order,
    lineState,
    byLine,
    orderNoForLine,
    shipmentQueryPreview,
    effShippedBeforeByLine,
    slipDocumentNo,
    issuerName,
  ]);

  const liveSlip: DeliveryNoteLiveSlip | null = useMemo(
    () => buildCurrentLiveSlip(),
    [buildCurrentLiveSlip],
  );

  const effectiveLiveSlip = voucherLiveSlip ?? liveSlip;

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
    if (!draft.customerId && draft.noOrderShipOut) {
      message.error("缺少客户信息，请从无单出货重新进入");
      return;
    }
    if (!draft.noOrderShipOut && !order) {
      message.error("订单数据尚未加载完成");
      return;
    }

    setCompleting(true);
    const merged = mergeLineIntoDraft(draft, lineState);
    try {
      const doc = await allocateDeliveryDocumentNo(draft, order);

      if (draft.noOrderShipOut) {
        if (!draft.customerId) {
          message.error("缺少客户信息，请从无单出货重新进入");
          return;
        }
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
        const slipToSave = buildCurrentLiveSlip(doc);
        if (slipToSave && draft.customerId) {
          await persistDeliveryVoucher(slipToSave, {
            customerId: draft.customerId,
            deliveredAt: merged.actualDeliveredAt,
          });
        }
        message.success("无单出货已完成，库存已扣减");
        router.push("/dashboard/warehouse?tab=query");
        return;
      }

      if (isMergedDeliveryDraft(draft)) {
        const orderIds = deliveryDraftOrderIds(draft);
        for (const orderId of orderIds) {
          const lineMap = merged.lineOrderIdByLineId ?? {};
          const orderLines = merged.lines
            .filter((l) => (lineMap[l.lineId] ?? merged.orderId) === orderId)
            .map((l) => ({
              lineId: l.lineId,
              shipQty: slipQuantityDisplay(l),
              spareQty: Math.max(0, Math.trunc(l.spareQty ?? 0)),
            }))
            .filter((x) => x.shipQty > 0 || x.spareQty > 0);
          if (orderLines.length === 0) continue;
          const inhMaps = pickInhouseMapsForOrder(merged, orderId);
          await fetchJson<DeliverOkResponse>(
            `/api/warehouse/sales-orders/${orderId}/deliver`,
            {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                actualDeliveredAt: merged.actualDeliveredAt,
                documentNo: doc,
                lines: orderLines,
                ...inhMaps,
              }),
            },
          );
        }
        const slipToSave = buildCurrentLiveSlip(doc);
        if (slipToSave && order?.customer.id) {
          await persistDeliveryVoucher(slipToSave, {
            customerId: order.customer.id,
            deliveredAt: merged.actualDeliveredAt,
            mergedShip: true,
            orderIds: deliveryDraftOrderIds(draft),
          });
        }
        sessionStorage.removeItem(WAREHOUSE_DELIVERY_DRAFT_KEY);
        message.success("合并出货已完成，库存已扣减");
        router.push("/dashboard/warehouse");
        return;
      }

      const res = await fetchJson<DeliverOkResponse>(
        `/api/warehouse/sales-orders/${draft.orderId}/deliver`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actualDeliveredAt: draft.actualDeliveredAt,
            documentNo: doc,
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
      const slipToSave = buildCurrentLiveSlip(doc);
      if (slipToSave && order?.customer.id) {
        await persistDeliveryVoucher(slipToSave, {
          customerId: order.customer.id,
          deliveredAt: merged.actualDeliveredAt,
          mergedShip: false,
          orderIds: [draft.orderId],
        });
      }
      sessionStorage.removeItem(WAREHOUSE_DELIVERY_DRAFT_KEY);

      if (res.fullyDelivered) {
        message.success("出货已完成，库存已扣减");
      } else {
        message.success("本批出货已确认，库存已扣减");
      }
      router.push("/dashboard/warehouse");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setCompleting(false);
    }
  }, [
    draft,
    lineState,
    message,
    router,
    shipmentQueryPreview,
    order,
    buildCurrentLiveSlip,
    persistDeliveryVoucher,
    allocateDeliveryDocumentNo,
  ]);

  const handleCancel = useCallback(() => {
    if (shipmentQueryPreview || viewVoucher) {
      router.push("/dashboard/warehouse?tab=query");
      return;
    }
    sessionStorage.removeItem(WAREHOUSE_DELIVERY_DRAFT_KEY);
    router.push("/dashboard/warehouse");
  }, [router, shipmentQueryPreview, viewVoucher]);

  const handleBackStep = useCallback(() => {
    if (shipmentQueryPreview || viewVoucher) {
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
  }, [draft, lineState, router, shipmentQueryPreview, viewVoucher]);

  const isNoOrderVoidContext = useMemo(() => {
    if (viewVoucher && voucherSource === "no_order") return true;
    return Boolean(draft?.noOrderShipOut && shipmentQueryPreview);
  }, [viewVoucher, voucherSource, draft?.noOrderShipOut, shipmentQueryPreview]);

  const canVoidCurrentBatch = useMemo(() => {
    if (voucherVoidedAt) return false;
    if (isNoOrderVoidContext) {
      const doc = (
        documentNoFromQuery ||
        docNo ||
        draft?.documentNo
      )?.trim();
      return Boolean(doc);
    }
    if (viewVoucher) {
      const doc = (documentNoFromQuery || docNo)?.trim();
      return Boolean(doc && voucherDeliveredAt && voucherOrderIds.length > 0);
    }
    return Boolean(
      shipmentQueryPreview && shipmentPreviewOrder && currentBatchAt,
    );
  }, [
    voucherVoidedAt,
    isNoOrderVoidContext,
    viewVoucher,
    documentNoFromQuery,
    docNo,
    draft?.documentNo,
    voucherDeliveredAt,
    voucherOrderIds.length,
    shipmentQueryPreview,
    shipmentPreviewOrder,
    currentBatchAt,
  ]);

  const voidCurrentBatch = useCallback(() => {
    const noteNo = (
      documentNoFromQuery ||
      docNo ||
      draft?.documentNo ||
      shipmentQueryDocumentNo
    )?.trim() || null;
    const batchAt = viewVoucher ? voucherDeliveredAt : currentBatchAt;
    const orderIds = viewVoucher
      ? voucherOrderIds
      : isMergedDeliveryDraft(draft ?? { orderId: "", actualDeliveredAt: "", lines: [] })
        ? (draft?.orderIds ?? [])
        : shipmentPreviewOrder
          ? [shipmentPreviewOrder.id]
          : [];
    const mergedOrderCount = orderIds.length;

    const salesVoidConfirmContent =
      mergedOrderCount > 1
        ? `此送货单包含 ${mergedOrderCount} 张销售订单，确认作废？作废后回退本送货单出货数量并恢复库存；若有存档凭证将标记为已作废，送货单内容不可再改。`
        : viewVoucher
          ? "作废后回退本送货单对应出货数量并恢复库存；存档凭证将标记为已作废，送货单内容不可再改。"
          : "作废后仅回退当前批次出货数量，其他批次不受影响；对应订单会按剩余出货情况自动回到可出货状态。";

    const applyVoidedVoucherState = () => {
      setVoucherVoidedAt(new Date().toISOString());
    };

    const reloadVoucherAfterVoid = async () => {
      if (!viewVoucher || !documentNoFromQuery?.trim()) return;
      try {
        const voucher = await fetchJson<{
          voidedAt: string | null;
          deliveredAt: string;
          orderIds?: string[];
        }>(
          `/api/warehouse/delivery-notes/voucher?documentNo=${encodeURIComponent(documentNoFromQuery.trim())}`,
          { credentials: "include" },
        );
        setVoucherVoidedAt(voucher.voidedAt);
        setVoucherDeliveredAt(voucher.deliveredAt);
        setVoucherOrderIds(voucher.orderIds ?? []);
      } catch {
        // 作废已成功，出货记录可能已删；保留当前预览并标记已作废
        applyVoidedVoucherState();
      }
    };

    if (isNoOrderVoidContext) {
      if (!noteNo) {
        message.warning("缺少送货单号，无法作废");
        return;
      }
      modal.confirm({
        title: "作废此无单出货送货单？",
        content:
          "作废后回退本批出库数量并恢复库存；若有存档凭证将标记为已作废，送货单内容不可再改。",
        okType: "danger",
        okText: "确认作废",
        cancelText: "取消",
        onOk: async () => {
          setVoidingBatch(true);
          try {
            const res = await fetchJson<{ revertedQty?: number }>(
              "/api/warehouse/product-ship-out/void-batch",
              {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deliveryNoteNo: noteNo }),
              },
            );
            message.success(
              `已作废本批，回退数量 ${Math.max(0, Number(res.revertedQty ?? 0))}`,
            );
            if (viewVoucher && documentNoFromQuery?.trim()) {
              setVoucherVoidedAt(new Date().toISOString());
            } else {
              router.push("/dashboard/warehouse?tab=query");
            }
          } catch (e) {
            message.error(e instanceof Error ? e.message : "作废失败");
          } finally {
            setVoidingBatch(false);
          }
        },
      });
      return;
    }

    if (!batchAt || orderIds.length === 0) {
      message.warning("当前批次信息缺失，无法作废");
      return;
    }
    modal.confirm({
      title:
        mergedOrderCount > 1 ? "确认作废合并出货送货单？" : "作废当前送货单批次？",
      content: salesVoidConfirmContent,
      okType: "danger",
      okText: "确认作废",
      cancelText: "取消",
      onOk: async () => {
        setVoidingBatch(true);
        try {
          let totalReverted = 0;
          for (const orderId of orderIds) {
            const res = await fetchJson<{ revertedQty?: number }>(
              `/api/warehouse/sales-orders/${orderId}/void-batch`,
              {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  batchDeliveredAt: batchAt,
                  deliveryNoteNo: noteNo,
                }),
              },
            );
            totalReverted += Math.max(0, Number(res.revertedQty ?? 0));
          }
          message.success(`已作废本批，回退数量 ${totalReverted}`);

          if (viewVoucher && documentNoFromQuery?.trim()) {
            await reloadVoucherAfterVoid();
            return;
          }

          if (!shipmentPreviewOrder) return;
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
        } finally {
          setVoidingBatch(false);
        }
      },
    });
  }, [
    isNoOrderVoidContext,
    viewVoucher,
    voucherDeliveredAt,
    voucherOrderIds,
    currentBatchAt,
    documentNoFromQuery,
    docNo,
    draft,
    shipmentQueryDocumentNo,
    shipmentPreviewOrder,
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
  const isBootingVoucher = viewVoucher && documentNoFromQuery?.trim() && !bootstrapDone;
  if (isBootingShipmentQuery || isBootingVoucher) {
    return (
      <Card
        className="warehouse-delivery-slip-print-scope"
        title={isBootingVoucher ? "送货单预览（存档凭证）" : "送货单预览（出货查询）"}
      >
        {/** tip 仅支持嵌套或全屏，需有子节点 */}
        <Spin tip="加载中…" size="large">
          <div style={{ minHeight: 200 }} />
        </Spin>
      </Card>
    );
  }

  if (
    !draft &&
    !loading &&
    bootstrapDone &&
    !(viewVoucher && (voucherLiveSlip || voucherLoadFailed))
  ) {
    return (
      <Card className="warehouse-delivery-slip-print-scope" title="送货单打印">
        <Typography.Paragraph>
          {viewShipment && orderIdFromQuery
            ? "无法根据出货记录打开送货单预览。若订单有分批出货，请确认已保存分批记录。"
            : viewVoucher && documentNoFromQuery?.trim()
              ? `无法加载送货单「${documentNoFromQuery.trim()}」，未找到存档或出货记录。`
              : "没有待打印的出货草稿，请从仓库出货流程进入。"}
        </Typography.Paragraph>
        <Link
          href={
            viewShipment && orderIdFromQuery
              ? "/dashboard/warehouse?tab=query"
              : viewVoucher
                ? "/dashboard/warehouse?tab=query"
                : "/dashboard/warehouse"
          }
        >
          {viewShipment && orderIdFromQuery
            ? "返回出货查询"
            : viewVoucher
              ? "返回出货查询"
              : "返回仓库出货"}
        </Link>
      </Card>
    );
  }

  return (
    <Card
      className="warehouse-delivery-slip-print-scope"
      title={
        shipmentQueryPreview
          ? viewVoucher
            ? "送货单预览（存档凭证，只读）"
            : "送货单预览（出货查询，只读）"
          : draft?.noOrderShipOut
            ? "无单出货 · 送货单打印（A5 横向）"
            : "送货单打印（A5 横向）"
      }
      styles={{ body: { overflow: "visible" } }}
      extra={
        shipmentQueryPreview || viewVoucher ? null : (
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
        {viewVoucher && voucherVoidedAt ? (
          <Typography.Text type="danger" style={{ display: "block", marginBottom: 10 }}>
            此送货单已于 {dayjs(voucherVoidedAt).format("YYYY-MM-DD HH:mm")} 作废；以下为确认时存档内容，不可修改。
          </Typography.Text>
        ) : null}
        {viewVoucher || shipmentQueryPreview ? (
          <div style={{ marginBottom: 10 }}>
            <Typography.Text>
              送货单号（存档凭证）：
              {(documentNoFromQuery || docNo || draft?.documentNo)?.trim() ? (
                <strong style={{ marginLeft: 8 }}>
                  {(documentNoFromQuery || docNo || draft?.documentNo)?.trim()}
                </strong>
              ) : (
                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                  无存档
                </Typography.Text>
              )}
            </Typography.Text>
          </div>
        ) : (
          <div style={{ marginBottom: 10 }}>
            <Typography.Text>
              送货单号（预览）：
              {previewDocNo ? (
                <strong style={{ marginLeft: 8 }}>{previewDocNo}</strong>
              ) : (
                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                  {previewDocLoading ? "加载中…" : "—"}
                </Typography.Text>
              )}
              <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                尚未占用流水，点「{draft?.noOrderShipOut ? "确定" : "完成"}」后正式生效
              </Typography.Text>
            </Typography.Text>
          </div>
        )}
        <Space wrap>
          {shipmentQueryPreview || viewVoucher ? null : (
            <Button
              type="primary"
              onClick={() => void handleComplete()}
              loading={completing}
            >
              {draft?.noOrderShipOut ? "确定" : "完成"}
            </Button>
          )}
          <Button onClick={handleBackStep}>
            {shipmentQueryPreview ? "返回出货查询" : "返回上一步"}
          </Button>
          {shipmentQueryPreview || viewVoucher ? (
            <>
              <Button onClick={handlePrint}>打印</Button>
              <Button
                onClick={() => void handlePdf()}
                loading={pdfLoading}
                disabled={!effectiveLiveSlip}
              >
                导出 PDF
              </Button>
            </>
          ) : null}
          {canVoidCurrentBatch ? (
            <Button
              danger
              onClick={voidCurrentBatch}
              loading={voidingBatch}
            >
              作废本批
            </Button>
          ) : null}
          <Button onClick={handleCancel}>
            {shipmentQueryPreview ? "关闭" : "取消"}
          </Button>
          {viewVoucher || shipmentQueryPreview ? (
            <Typography.Text type="secondary">
              {viewVoucher
                ? voucherSource === "voucher"
                  ? "以下为确认出货时存档的送货单凭证，内容与当时打印一致，不可修改；可打印、导出 PDF，也可作废本批（作废后凭证标记为已作废）。"
                  : voucherSource === "ship_logs"
                    ? "该出货未写入存档凭证，以下按出货记录还原预览，可能与当时打印略有差异；可打印、导出 PDF、作废本批（与出货查询一致）。"
                    : voucherSource === "no_order"
                      ? "无单出货送货单只读预览；可打印、导出 PDF、作废本批（作废后回退库存）。"
                      : "以下为送货单只读预览。可打印、导出 PDF。"
                : draft?.noOrderShipOut
                  ? "无单出货送货单只读预览；送货单号与打印完成时一致。可打印、导出 PDF。"
                  : "历史出货未存档时按订单还原预览；新出货请从出货查询点送货单号查看存档凭证。可打印、导出 PDF。"}
            </Typography.Text>
          ) : draft?.noOrderShipOut ? (
            <Typography.Text type="secondary">
              可设置备品/备注；预览单号点「确定」后正式占用并扣减库存。点「取消」不占用单号、不扣库存。
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">
              出货物量在仓库「确认出货」中已填；可设置备品/备注。预览单号点「完成」后正式占用并登记出库；点「取消」不占用单号、不记档。
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
      {loading || !cfgForPrint || (!viewVoucher && !order) ? (
        <Spin tip="加载中…">
          <div style={{ minHeight: 240 }} />
        </Spin>
      ) : viewVoucher && voucherLoadFailed ? (
        <Typography.Text type="danger">
          无法加载送货单「{documentNoFromQuery?.trim() || "—"}」：未找到存档凭证或出货记录。若刚完成出货，请确认已点「完成」；也可在出货查询中通过「打开预览」查看。
        </Typography.Text>
      ) : !effectiveLiveSlip ? (
        <Typography.Text type="danger">
          无法生成送货单：本批无有效行（出货数为 0）或数据异常。请「返回上一步」检查。
        </Typography.Text>
      ) : (
        <div id="delivery-note-print-area" className="delivery-note-print-area-wrap">
          <DeliveryNoteTemplatePreview
            cfg={cfgForPrint}
            liveSlip={effectiveLiveSlip}
            rootClassName="delivery-note-a5-landscape"
            liveSlipActiveRow={shipmentQueryPreview || viewVoucher ? undefined : activeRow}
            onLiveSlipRowClick={shipmentQueryPreview || viewVoucher ? undefined : setActiveRow}
          />
        </div>
      )}
    </Card>
  );
}
