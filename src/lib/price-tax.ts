/** 供应商含税价折算未税：÷ (1 + 10%) */
export const SUPPLIER_TAX_INCLUSIVE_DIVISOR = 1.1;

/** 客户含税价折算未税：÷ (1 + 13%) */
export const CUSTOMER_TAX_INCLUSIVE_DIVISOR = 1.13;

/** 将录入单价折成未税口径（统计利润用）；未勾选含税则原样返回 */
export function unitPriceToExclusive(
  unitPrice: number,
  priceIncludesTax: boolean,
  party: "supplier" | "customer",
): number {
  if (!priceIncludesTax || !Number.isFinite(unitPrice)) return unitPrice;
  const divisor =
    party === "supplier"
      ? SUPPLIER_TAX_INCLUSIVE_DIVISOR
      : CUSTOMER_TAX_INCLUSIVE_DIVISOR;
  return unitPrice / divisor;
}

export function moneyColumnLabels(priceIncludesTax: boolean) {
  return {
    unitPrice: priceIncludesTax ? "单价（含税）" : "单价",
    amount: priceIncludesTax ? "金额（含税）" : "金额",
  };
}

/** 统计利润等已折未税口径的列名/标题 */
export function exclusiveStatLabel(label: string): string {
  return label.endsWith("（未税）") ? label : `${label}（未税）`;
}

/** 将录入单价折成含税展示价；已含税则原样，未税则 ×1.1 / ×1.13 */
export function unitPriceToInclusive(
  unitPrice: number,
  priceIncludesTax: boolean,
  party: "supplier" | "customer",
): number {
  if (priceIncludesTax || !Number.isFinite(unitPrice)) return unitPrice;
  const multiplier =
    party === "supplier"
      ? SUPPLIER_TAX_INCLUSIVE_DIVISOR
      : CUSTOMER_TAX_INCLUSIVE_DIVISOR;
  return unitPrice * multiplier;
}

/**
 * 销售下单选商品时：按「下单客户」标价选用商品档案未税价 / 含税价。
 * 缺对应价时回退另一价，都没有则 0。
 */
export function productUnitPriceForOrderCustomer(
  product: {
    price: string | number | null | undefined;
    priceTaxInclusive?: string | number | null;
  },
  orderCustomerPriceIncludesTax: boolean,
): number {
  const exclusive = Number(product.price ?? 0);
  const inclusiveRaw = product.priceTaxInclusive;
  const inclusive =
    inclusiveRaw === null || inclusiveRaw === undefined || inclusiveRaw === ""
      ? NaN
      : Number(inclusiveRaw);
  if (orderCustomerPriceIncludesTax) {
    if (Number.isFinite(inclusive)) return inclusive;
    return Number.isFinite(exclusive) ? exclusive : 0;
  }
  if (Number.isFinite(exclusive)) return exclusive;
  return Number.isFinite(inclusive) ? inclusive : 0;
}
