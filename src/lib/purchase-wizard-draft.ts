import type { PurchaseExtraFeeRow } from "@/lib/purchase-extra-fees";

export type WizardLineDraft = {
  materialId: string;
  quantity: number;
  unitPriceNum: number;
  remark: string;
};

export type WizardSupplierDraft = {
  confirmed: boolean;
  confirmedAt?: string;
  lines: WizardLineDraft[];
  extraFees?: PurchaseExtraFeeRow[];
};

export type PurchaseWizardDraft = {
  salesOrderId: string;
  actualDemandByProductId: Record<string, number>;
  suppliers: Record<string, WizardSupplierDraft>;
  updatedAt: string;
};

const LS_PREFIX = "purchase.wizard.draft.v1";

function storageKey(salesOrderId: string): string {
  return `${LS_PREFIX}:${salesOrderId}`;
}

export function loadPurchaseWizardDraft(
  salesOrderId: string,
): PurchaseWizardDraft | null {
  if (typeof window === "undefined" || !salesOrderId) return null;
  try {
    const raw = localStorage.getItem(storageKey(salesOrderId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PurchaseWizardDraft;
    if (parsed.salesOrderId !== salesOrderId) return null;
    if (!parsed.suppliers || typeof parsed.suppliers !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePurchaseWizardDraft(draft: PurchaseWizardDraft): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      storageKey(draft.salesOrderId),
      JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }),
    );
  } catch {
    /* ignore quota */
  }
}

export function upsertWizardSupplierDraft(
  salesOrderId: string,
  supplierId: string,
  patch: WizardSupplierDraft,
  actualDemandByProductId: Record<string, number>,
): void {
  const base =
    loadPurchaseWizardDraft(salesOrderId) ?? {
      salesOrderId,
      actualDemandByProductId: {},
      suppliers: {},
      updatedAt: new Date().toISOString(),
    };
  savePurchaseWizardDraft({
    ...base,
    actualDemandByProductId,
    suppliers: {
      ...base.suppliers,
      [supplierId]: {
        ...patch,
        confirmedAt: patch.confirmed
          ? patch.confirmedAt ?? new Date().toISOString()
          : undefined,
      },
    },
  });
}

export function clearWizardSupplierDraft(
  salesOrderId: string,
  supplierId: string,
): void {
  const base = loadPurchaseWizardDraft(salesOrderId);
  if (!base) return;
  const { [supplierId]: _removed, ...rest } = base.suppliers;
  savePurchaseWizardDraft({
    ...base,
    suppliers: rest,
    updatedAt: new Date().toISOString(),
  });
}

/** 返回上一步时清除「实际需求商品数」草稿，避免与重新计算的采购数量不一致 */
export function clearWizardActualDemandDraft(salesOrderId: string): void {
  const base = loadPurchaseWizardDraft(salesOrderId);
  if (!base) return;
  savePurchaseWizardDraft({
    ...base,
    actualDemandByProductId: {},
    updatedAt: new Date().toISOString(),
  });
}
