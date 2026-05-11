import type { Prisma } from "@prisma/client";

export type AllocateCodeResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

/**
 * 按编号规则分配下一个物料号（事务内调用）。
 * 格式：{种类前缀}-{名称前缀}-{4位序号}
 */
export async function allocateMaterialCode(
  tx: Prisma.TransactionClient,
  kindId: string,
  presetNameId: string,
): Promise<AllocateCodeResult> {
  const rule = await tx.materialCodeRule.findUnique({
    where: {
      presetKindId_presetNameId: {
        presetKindId: kindId,
        presetNameId,
      },
    },
    include: { presetKind: true, presetName: true },
  });

  if (!rule) {
    return {
      ok: false,
      error:
        "请先在「物料设置」中为该「物料种类 + 物料名称」配置编号规则（含种类前缀、名称前缀与起始号）",
    };
  }

  const kp = rule.presetKind.prefix.trim();
  const np = rule.namePrefix.trim();
  if (!kp || !np) {
    return {
      ok: false,
      error: "种类前缀与名称前缀不能为空，请在「物料设置」中补全种类前缀与编号规则中的名称前缀",
    };
  }

  const seq = rule.nextNumber;
  const padded = String(seq).padStart(4, "0");
  const code = `${kp}-${np}-${padded}`;

  const dup = await tx.material.findUnique({ where: { code } });
  if (dup) {
    return {
      ok: false,
      error: `物料编号「${code}」已存在，请调整编号规则的下一序号或排查重复数据`,
    };
  }

  await tx.materialCodeRule.update({
    where: { id: rule.id },
    data: { nextNumber: seq + 1 },
  });

  return { ok: true, code };
}
