"use client";

import type { CSSProperties, ReactNode } from "react";
import dayjs from "dayjs";
import {
  VISUAL_BLOCK_IDS,
  interpolateIntroLine,
  type VisualBlockId,
  type VisualColumn,
  type VisualEditorState,
} from "@/lib/purchase-template-visual";
import {
  amountToChineseCapital,
  type ContractPreviewLine,
  type ContractPreviewSupplier,
} from "./PurchaseContractPreview";
import type { PurchaseExtraFeeRow } from "@/lib/purchase-extra-fees";
import { PartyAFooterSealOverlay } from "./PartyAFooterSealOverlay";

const cell: CSSProperties = {
  border: "1px solid #333",
  padding: "6px 8px",
  verticalAlign: "top",
  fontSize: 13,
};

function PlaceholderOrValue({
  value,
  placeholder,
}: {
  value: string | null | undefined;
  placeholder: string;
}) {
  const t = value?.trim();
  if (t) return <span>{t}</span>;
  return <span style={{ color: "#cf1322" }}>{placeholder}</span>;
}

function isAutoContractNoTemplate(template: string): boolean {
  const t = template?.trim();
  return !t || t === "自动生成" || t.includes("自动");
}

function resolveAutoSignDate(template: string): string {
  const t = template?.trim();
  if (!t || t === "自动生成" || t.includes("自动")) {
    return dayjs().format("YYYY年MM月DD日");
  }
  return template;
}

function LogoBlock({ visual }: { visual: VisualEditorState }) {
  const lg = visual.logo;
  if (lg.mode === "image" && lg.imageUrl?.trim()) {
    return (
      <img
        src={lg.imageUrl.trim()}
        alt=""
        style={{ maxHeight: 48, maxWidth: 160, objectFit: "contain" }}
      />
    );
  }
  const text = lg.text || "";
  return (
    <div
      style={{
        fontSize: 20,
        fontWeight: 800,
        color: "#1677ff",
        whiteSpace: "nowrap",
      }}
    >
      {text.endsWith("®") ? (
        <>
          {text.slice(0, -1)}
          <sup style={{ fontSize: 10 }}>®</sup>
        </>
      ) : (
        text
      )}
    </div>
  );
}

function columnAlign(id: string): "left" | "center" | "right" {
  if (id === "c1" || id === "c4") return "center";
  if (id === "c5" || id === "c6" || id === "c7") return "right";
  return "left";
}

function cellForColumn(
  col: VisualColumn,
  line: ContractPreviewLine,
  rowIndex: number,
): ReactNode {
  const amt = line.quantity * line.unitPriceNum;
  switch (col.id) {
    case "c1":
      return rowIndex + 1;
    case "c2":
      return line.model || "—";
    case "c3":
      return line.spec || "—";
    case "c4":
      return line.unit;
    case "c5":
      return line.quantity;
    case "c6":
      return line.unitPriceNum.toFixed(4);
    case "c7":
      return amt.toFixed(4);
    case "c8":
      return line.remark?.trim() || "—";
    default:
      return "—";
  }
}

function cellForExtraFeeColumn(
  col: VisualColumn,
  fee: PurchaseExtraFeeRow,
  feeIndex: number,
): ReactNode {
  const amount = Number(fee.amount);
  const amountText = Number.isFinite(amount) ? amount.toFixed(4) : "0.0000";
  const purpose = fee.purpose?.trim() || "附加费用";
  switch (col.id) {
    case "c1":
      return `附${feeIndex + 1}`;
    case "c2":
      return "附加费用";
    case "c3":
      return purpose;
    case "c4":
      return "—";
    case "c5":
      return "—";
    case "c6":
      return "—";
    case "c7":
      return amountText;
    case "c8":
      return purpose;
    default:
      return "—";
  }
}

function isVisualBlockId(id: string): id is VisualBlockId {
  return (VISUAL_BLOCK_IDS as readonly string[]).includes(id);
}

export function PurchaseVisualContractPreview({
  visual,
  supplier,
  lines,
  deliveryDueAtIso,
  customerLine,
  contractNoOverride,
  extraFees = [],
}: {
  visual: VisualEditorState;
  supplier: ContractPreviewSupplier;
  lines: ContractPreviewLine[];
  customerLine: string;
  deliveryDueAtIso: string | null;
  /** 已保存采购单号或与规则一致的预览号；模板为自动生成时展示 */
  contractNoOverride?: string | null;
  extraFees?: PurchaseExtraFeeRow[];
}) {
  const t = visual.texts;
  const productTotal = lines.reduce((s, l) => s + l.quantity * l.unitPriceNum, 0);
  const extraFeeTotal = extraFees.reduce((s, f) => {
    const n = Number(f.amount);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);
  const total = productTotal + extraFeeTotal;
  const deliveryDisplay = deliveryDueAtIso
    ? dayjs(deliveryDueAtIso).format("YYYY年MM月DD日")
    : "";
  const intro = interpolateIntroLine(t.introLine ?? "", {
    customerLine,
    deliveryDisplay,
  });
  const contractTpl = t.contractNoValue ?? "";
  const contractNo = isAutoContractNoTemplate(contractTpl)
    ? (contractNoOverride?.trim() ||
        `（预览单号获取中…）`)
    : contractTpl.trim();
  const signDate = resolveAutoSignDate(t.signDateValue ?? "");
  const cols = visual.columns.length ? visual.columns : [];
  const amountIdx = cols.findIndex((c) => c.id === "c7");

  const renderBlock = (bid: string) => {
    if (!isVisualBlockId(bid)) return null;
    switch (bid) {
      case "logoTitle":
        return (
          <div key={bid} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <LogoBlock visual={visual} />
              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 4 }}>
                  {t.documentTitle}
                </div>
              </div>
            </div>
          </div>
        );
      case "meta":
        return (
          <table key={bid} style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
            <tbody>
              <tr>
                <td style={{ ...cell, width: "18%" }}>{t.contractNoLabel}</td>
                <td style={cell}>{contractNo}</td>
                <td style={{ ...cell, width: "18%" }}>{t.signDateLabel}</td>
                <td style={cell}>{signDate}</td>
              </tr>
            </tbody>
          </table>
        );
      case "parties":
        return (
          <table key={bid} style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
            <tbody>
              <tr>
                <td style={{ ...cell, width: "50%", fontWeight: 600 }}>{t.partyALabel}</td>
                <td style={{ ...cell, width: "50%", fontWeight: 600 }}>{t.partyBLabel}</td>
              </tr>
              <tr>
                <td style={cell}>
                  <div>{t.partyARow}</div>
                  <div style={{ marginTop: 4 }}>{t.partyAContactLine}</div>
                </td>
                <td style={cell}>
                  <div>
                    <strong>
                      <PlaceholderOrValue value={supplier.name} placeholder={t.partyBNamePlaceholder} />
                    </strong>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    电话：
                    <PlaceholderOrValue value={supplier.phone} placeholder={t.partyBPhonePlaceholder} />
                  </div>
                  <div style={{ marginTop: 4 }}>
                    联系人：
                    <PlaceholderOrValue
                      value={supplier.contactPerson}
                      placeholder={t.partyBContactPlaceholder}
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        );
      case "intro":
        return (
          <div
            key={bid}
            style={{
              fontSize: 15,
              fontWeight: 700,
              lineHeight: 1.55,
              padding: "6px 0",
              marginBottom: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {intro}
          </div>
        );
      case "products": {
        const rawAmountIdx = amountIdx >= 0 ? amountIdx : Math.max(0, cols.length - 2);
        const n = cols.length || 8;
        const totalRow =
          rawAmountIdx <= 0 ? (
            <tr>
              <td style={{ ...cell, textAlign: "right", fontWeight: 600 }} colSpan={n}>
                合计金额（小写）　{total.toFixed(2)}
              </td>
            </tr>
          ) : (
            <tr>
              <td
                style={{ ...cell, textAlign: "right", fontWeight: 600 }}
                colSpan={rawAmountIdx}
              >
                合计金额（小写）
              </td>
              <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{total.toFixed(2)}</td>
              {n - rawAmountIdx - 1 > 0 ? (
                <td style={cell} colSpan={n - rawAmountIdx - 1} />
              ) : null}
            </tr>
          );
        return (
          <div key={bid} style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 400,
                lineHeight: 1.55,
                marginBottom: 6,
              }}
            >
              {t.sectionOneTitle}
            </div>
            {supplier.priceIncludesTax ? (
              <div
                style={{
                  textAlign: "right",
                  fontSize: 13,
                  marginBottom: 4,
                }}
              >
                含税：13%
              </div>
            ) : null}
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  {cols.map((c) => (
                    <th key={c.id} style={{ ...cell, textAlign: "center", fontWeight: 600 }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={`${line.code}-${i}`}>
                    {cols.map((c) => (
                      <td key={c.id} style={{ ...cell, textAlign: columnAlign(c.id) }}>
                        {cellForColumn(c, line, i)}
                      </td>
                    ))}
                  </tr>
                ))}
                {extraFees.map((fee, i) => (
                  <tr key={fee.id ?? `extra-fee-${i}`}>
                    {cols.map((c) => (
                      <td key={c.id} style={{ ...cell, textAlign: columnAlign(c.id) }}>
                        {cellForExtraFeeColumn(c, fee, i)}
                      </td>
                    ))}
                  </tr>
                ))}
                {totalRow}
                <tr>
                  <td style={{ ...cell, fontWeight: 600 }} colSpan={n}>
                    合计人民币金额（大写）：{amountToChineseCapital(total)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }
      case "terms": {
        const keys = [
          "term2",
          "term3",
          "term4",
          "term5",
          "term6",
          "term7",
          "term8",
          "term9",
          "term10",
        ] as const;
        return (
          <div key={bid} style={{ fontSize: 12, lineHeight: 1.55, marginBottom: 12 }}>
            {keys.map((k) => (
              <p key={k} style={{ margin: "4px 0" }}>
                {t[k]}
              </p>
            ))}
          </div>
        );
      }
      case "footer":
        return (
          <table key={bid} style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              <tr>
                <td style={{ ...cell, width: "50%", fontWeight: 600 }}>{t.footerPartyATitle}</td>
                <td style={{ ...cell, width: "50%", fontWeight: 600 }}>{t.footerPartyBTitle}</td>
              </tr>
              <tr>
                <td style={{ ...cell, verticalAlign: "top", overflow: "visible" }}>
                  <PartyAFooterSealOverlay seal={visual.partyASeal}>
                    <div style={{ whiteSpace: "pre-wrap" }}>{t.footerPartyABody ?? ""}</div>
                  </PartyAFooterSealOverlay>
                </td>
                <td style={cell}>
                  <div>
                    名称：
                    <PlaceholderOrValue value={supplier.name} placeholder="对应供应商名称" />
                  </div>
                  <div>
                    纳税人识别号：
                    <PlaceholderOrValue
                      value={supplier.taxRegistrationNo}
                      placeholder="供应商「税务登记号」"
                    />
                  </div>
                  <div>
                    地址、电话：
                    <PlaceholderOrValue
                      value={
                        [supplier.address?.trim(), supplier.phone?.trim()].filter(Boolean).join(" ") ||
                        null
                      }
                      placeholder="供应商「单位地址」及「电话」"
                    />
                  </div>
                  <div>
                    开户行及帐号：
                    <PlaceholderOrValue
                      value={
                        [supplier.bankName?.trim(), supplier.bankAccount?.trim()]
                          .filter(Boolean)
                          .join(" ") || null
                      }
                      placeholder="供应商「开户银行」及「账号」"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        );
      default:
        return null;
    }
  };

  const order = visual.blockOrder.filter(isVisualBlockId);

  return (
    <div
      className="purchase-visual-print-root"
      style={{
        color: "#111",
        lineHeight: 1.55,
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      {order.map((bid) => renderBlock(bid))}
    </div>
  );
}
