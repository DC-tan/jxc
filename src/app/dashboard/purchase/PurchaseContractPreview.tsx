"use client";

import type { CSSProperties } from "react";
import dayjs from "dayjs";
import type { PurchasePrintTemplateConfig } from "@/lib/purchase-print-template";
import { DEFAULT_PURCHASE_PRINT_TEMPLATE } from "@/lib/purchase-print-template";

export type ContractPreviewLine = {
  code: string;
  model: string;
  spec: string;
  unit: string;
  quantity: number;
  unitPriceNum: number;
  remark: string;
};

export type ContractPreviewSupplier = {
  code: string;
  name: string;
  /** 与采购单号规则中间段一致；可空 */
  shortName?: string | null;
  contactPerson: string | null;
  phone: string | null;
  address: string | null;
  bankName: string | null;
  bankAccount: string | null;
  taxRegistrationNo: string | null;
  /** 供应商标价是否含税；为 true 时合同表格上方显示「含税：13%」 */
  priceIncludesTax?: boolean;
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

const CN_DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"] as const;
const CN_UNIT = ["", "拾", "佰", "仟"] as const;

function fourDigitsToChinese(n: number): string {
  if (n <= 0 || n > 9999) return "";
  let s = "";
  let needZero = false;
  for (let i = 0; i < 4; i++) {
    const d = Math.floor(n / 10 ** (3 - i)) % 10;
    if (d === 0) {
      needZero = s.length > 0;
    } else {
      if (needZero) {
        s += CN_DIGITS[0];
        needZero = false;
      }
      s += CN_DIGITS[d] + CN_UNIT[3 - i];
    }
  }
  return s.replace(/零+/g, "零").replace(/零$/, "");
}

function yuanIntegerToChinese(yuanInt: number): string {
  if (yuanInt <= 0) return "零";
  const yi = Math.floor(yuanInt / 1e8);
  const wan = Math.floor((yuanInt % 1e8) / 1e4);
  const ge = yuanInt % 1e4;
  let r = "";
  if (yi) r += fourDigitsToChinese(yi) + "亿";
  if (wan) {
    r += fourDigitsToChinese(wan) + "万";
  } else if (yi && ge) r += CN_DIGITS[0];
  if (ge) r += fourDigitsToChinese(ge);
  return r || "零";
}

export function amountToChineseCapital(amount: number): string {
  const cents = Math.round(amount * 100);
  const yuan = Math.floor(cents / 100);
  const jiao = Math.floor((cents % 100) / 10);
  const fen = cents % 10;
  let s = yuanIntegerToChinese(yuan) + "元";
  if (jiao === 0 && fen === 0) return s + "整";
  if (jiao) s += CN_DIGITS[jiao] + "角";
  if (fen) s += CN_DIGITS[fen] + "分";
  else if (jiao && !fen) s += "整";
  return s;
}

const cell: CSSProperties = {
  border: "1px solid #333",
  padding: "6px 8px",
  verticalAlign: "top",
  fontSize: 13,
};

function ContractLogo({ cfg }: { cfg: PurchasePrintTemplateConfig }) {
  if (cfg.logoMode === "image" && cfg.logoUrl?.trim()) {
    return (
      <img
        src={cfg.logoUrl.trim()}
        alt=""
        style={{
          maxHeight: cfg.logoHeightPx,
          maxWidth: 200,
          objectFit: "contain",
        }}
      />
    );
  }
  return (
    <div
      style={{
        fontSize: Math.min(22, Math.max(14, cfg.logoHeightPx * 0.45)),
        fontWeight: 800,
        letterSpacing: 1,
        color: cfg.logoTextColor,
        whiteSpace: "nowrap",
      }}
    >
      {cfg.logoText.endsWith("®") ? (
        <>
          {cfg.logoText.slice(0, -1)}
          <sup style={{ fontSize: 10 }}>®</sup>
        </>
      ) : (
        cfg.logoText
      )}
    </div>
  );
}

export function PurchaseContractPreview({
  supplier,
  lines,
  deliveryDueAtIso,
  customerOrderNo,
  customerName,
  template,
}: {
  supplier: ContractPreviewSupplier;
  lines: ContractPreviewLine[];
  deliveryDueAtIso: string | null;
  customerOrderNo: string;
  customerName: string;
  template?: PurchasePrintTemplateConfig | null;
}) {
  const cfg = template ?? DEFAULT_PURCHASE_PRINT_TEMPLATE;
  const pa = cfg.partyA;
  const total = lines.reduce(
    (s, l) => s + l.quantity * l.unitPriceNum,
    0,
  );
  const signDate = dayjs().format("YYYY年MM月DD日");
  const contractNoPreview = `${cfg.contractNoPreviewPrefix}-${supplier.code}-${dayjs().format("YYYYMMDD")}`;
  const deliveryText = deliveryDueAtIso
    ? dayjs(deliveryDueAtIso).format("YYYY年MM月DD日")
    : null;
  const headers = cfg.tableColumnHeaders.slice(0, 8);
  while (headers.length < 8) {
    headers.push("—");
  }

  return (
    <>
      {cfg.customCss?.trim() ? (
        <style
          dangerouslySetInnerHTML={{
            __html: `.purchase-print-root { ${cfg.customCss} }`,
          }}
        />
      ) : null}
      <div
        className="purchase-print-root"
        style={{
          color: "#111",
          lineHeight: 1.55,
          maxWidth: cfg.paperMaxWidthPx,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <ContractLogo cfg={cfg} />
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 4 }}>
              {cfg.documentTitle}
            </div>
          </div>
          <div style={{ width: 72 }} />
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
          <tbody>
            <tr>
              <td style={{ ...cell, width: "18%" }}>{cfg.contractNoLabel}</td>
              <td style={{ ...cell }}>{contractNoPreview}</td>
              <td style={{ ...cell, width: "18%" }}>{cfg.signDateLabel}</td>
              <td style={{ ...cell, width: "28%" }}>{signDate}</td>
            </tr>
          </tbody>
        </table>

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
          <tbody>
            <tr>
              <td style={{ ...cell, width: "50%", fontWeight: 600 }}>
                {cfg.partyALabel}
              </td>
              <td style={{ ...cell, width: "50%", fontWeight: 600 }}>
                {cfg.partyBLabel}
              </td>
            </tr>
            <tr>
              <td style={cell}>
                <div>
                  <strong>{pa.name}</strong>
                </div>
                <div>
                  电话：
                  <PlaceholderOrValue
                    value={pa.headerPhone}
                    placeholder="甲方联系电话（在模板中填写）"
                  />
                </div>
                <div>
                  联系人：
                  <PlaceholderOrValue
                    value={pa.headerContact}
                    placeholder="甲方联系人（在模板中填写）"
                  />
                </div>
              </td>
              <td style={cell}>
                <div>
                  <strong>
                    <PlaceholderOrValue
                      value={supplier.name}
                      placeholder="对应供应商名称"
                    />
                  </strong>
                </div>
                <div>
                  电话：
                  <PlaceholderOrValue
                    value={supplier.phone}
                    placeholder="供应商联系电话"
                  />
                </div>
                <div>
                  联系人：
                  <PlaceholderOrValue
                    value={supplier.contactPerson}
                    placeholder="供应商联系人"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            lineHeight: 1.55,
            padding: "6px 0",
            marginBottom: 12,
          }}
        >
          依据双方约定，就甲方向乙方采购下列物料（关联销售订单：{customerName}{" "}
          {customerOrderNo || "—"}）达成如下条款。交货时间：
          <PlaceholderOrValue
            value={deliveryText ?? undefined}
            placeholder="采购订单要求交货时间"
          />
          。
        </div>

        <div
          style={{
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.55,
            marginBottom: 6,
          }}
        >
          {cfg.sectionOneHeading}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              {headers.map((h) => (
                <th
                  key={h}
                  style={{ ...cell, textAlign: "center", fontWeight: 600 }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const amt = l.quantity * l.unitPriceNum;
              return (
                <tr key={`${l.code}-${i}`}>
                  <td style={{ ...cell, textAlign: "center" }}>{i + 1}</td>
                  <td style={cell}>{l.model || "—"}</td>
                  <td style={cell}>{l.spec || "—"}</td>
                  <td style={{ ...cell, textAlign: "center" }}>{l.unit}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{l.quantity}</td>
                  <td style={{ ...cell, textAlign: "right" }}>
                    {l.unitPriceNum.toFixed(4)}
                  </td>
                  <td style={{ ...cell, textAlign: "right" }}>{amt.toFixed(4)}</td>
                  <td style={cell}>{l.remark?.trim() || "—"}</td>
                </tr>
              );
            })}
            <tr>
              <td
                style={{ ...cell, textAlign: "right", fontWeight: 600 }}
                colSpan={6}
              >
                合计金额（小写）
              </td>
              <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>
                {total.toFixed(2)}
              </td>
              <td style={cell} />
            </tr>
            <tr>
              <td style={{ ...cell, fontWeight: 600 }} colSpan={8}>
                合计人民币金额（大写）：{amountToChineseCapital(total)}
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ fontSize: 12, marginBottom: 12 }}>
          {cfg.terms.map((t, i) => (
            <p key={`${t.label}-${i}`} style={{ margin: "4px 0" }}>
              <strong>{t.label}</strong>
              {t.body}
            </p>
          ))}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td style={{ ...cell, width: "50%", fontWeight: 600 }}>
                甲方（开票信息）
              </td>
              <td style={{ ...cell, width: "50%", fontWeight: 600 }}>
                乙方（开票信息）
              </td>
            </tr>
            <tr>
              <td style={cell}>
                <div>名称：{pa.name}</div>
                <div>纳税人识别号：{pa.taxNo}</div>
                <div>地址、电话：{pa.address}</div>
                <div>
                  开户行及帐号：{pa.bankName} {pa.bankAccount}
                </div>
              </td>
              <td style={cell}>
                <div>
                  名称：
                  <PlaceholderOrValue
                    value={supplier.name}
                    placeholder="对应供应商名称"
                  />
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
                      [supplier.address?.trim(), supplier.phone?.trim()]
                        .filter(Boolean)
                        .join(" ") || null
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

        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: "#888" }}>
          {cfg.footerNote}
        </p>
      </div>
    </>
  );
}
