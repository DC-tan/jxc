export type MaterialPurchaseChannel = "STANDARD_PURCHASE" | "PROCESSING_CONTRACT";

/** PCB 类物料默认走加工合同，其余走常规采购。 */
export function resolveMaterialPurchaseChannelByKindName(
  kindName: string | null | undefined,
): MaterialPurchaseChannel {
  if ((kindName ?? "").trim().toUpperCase() === "PCB") {
    return "PROCESSING_CONTRACT";
  }
  return "STANDARD_PURCHASE";
}
