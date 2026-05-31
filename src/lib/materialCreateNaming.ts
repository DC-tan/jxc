import type { MaterialKindNamingMode } from "@prisma/client";

export type PresetNameLookup = {
  id: string;
  name: string;
  namePrefix: string;
};

export type KindNamingLookup = {
  namingMode: MaterialKindNamingMode;
};

export type ResolveMaterialNamingInput = {
  /** Excel 或表单中的物料名称 */
  materialName: string;
  /** 自定义种类时填写的名称前缀（Excel「名称前缀」列） */
  customNamePrefix?: string;
};

export type ResolveMaterialNamingResult =
  | {
      ok: true;
      materialName: string;
      allocNamePrefix: string;
      sequencePadLength: number;
    }
  | { ok: false; error: string };

/**
 * 与 POST /api/materials 建档一致：标准件匹配名称预设，自定义种类需名称前缀。
 */
export function resolveMaterialNaming(
  kind: KindNamingLookup,
  input: ResolveMaterialNamingInput,
  presetNames: PresetNameLookup[],
): ResolveMaterialNamingResult {
  const customName = input.materialName.trim();
  const customNamePrefix = (input.customNamePrefix ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();

  if (kind.namingMode === "CUSTOM") {
    if (!customName) {
      return { ok: false, error: "物料名称不能为空" };
    }
    if (!customNamePrefix) {
      return {
        ok: false,
        error: "该物料种类为自定义名称，请在 Excel 中填写「名称前缀」列",
      };
    }
    return {
      ok: true,
      materialName: customName,
      allocNamePrefix: customNamePrefix,
      sequencePadLength: 2,
    };
  }

  if (!customName) {
    return { ok: false, error: "物料名称不能为空" };
  }
  const preset =
    presetNames.find((n) => n.name === customName) ??
    presetNames.find(
      (n) => n.name.toLowerCase() === customName.toLowerCase(),
    );
  if (!preset) {
    return {
      ok: false,
      error: `物料名称「${customName}」未在「物料设置」的名称预设中找到，请使用预设名称`,
    };
  }
  const allocNamePrefix = preset.namePrefix.trim();
  if (!allocNamePrefix) {
    return {
      ok: false,
      error: `物料名称「${preset.name}」的名称前缀未配置，请在「物料设置」中补全`,
    };
  }
  return {
    ok: true,
    materialName: preset.name,
    allocNamePrefix,
    sequencePadLength: 3,
  };
}
