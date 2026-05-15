import type { Prisma } from "@prisma/client";

export type AllocateCodeResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 按默认规则分配下一个物料号（事务内调用）。
 * 格式：{种类前缀}-{名称前缀}-{序号}，起始序号为 001。
 */
export async function allocateMaterialCode(
  tx: Prisma.TransactionClient,
  kindId: string,
  presetNameId: string,
): Promise<AllocateCodeResult> {
  const [kind, presetName] = await Promise.all([
    tx.materialPresetKind.findUnique({ where: { id: kindId } }),
    tx.materialPresetName.findUnique({ where: { id: presetNameId } }),
  ]);

  if (!kind || !presetName) {
    return {
      ok: false,
      error: "物料种类或物料名称不存在，请刷新后重试",
    };
  }

  const kp = kind.prefix.trim();
  const np = presetName.namePrefix.trim();
  if (!kp || !np) {
    return {
      ok: false,
      error: "种类前缀与名称前缀不能为空，请在「物料设置」中补全",
    };
  }

  const codePrefix = `${kp}-${np}-`;
  const candidates = await tx.material.findMany({
    where: { code: { startsWith: codePrefix } },
    select: { code: true },
  });
  const suffixReg = new RegExp(`^${escapeRegExp(codePrefix)}(\\d+)$`);
  let maxSeq = 0;
  for (const row of candidates) {
    const match = row.code.match(suffixReg);
    if (!match) continue;
    const seq = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isNaN(seq) && seq > maxSeq) {
      maxSeq = seq;
    }
  }

  const nextSeq = maxSeq + 1;
  const code = `${codePrefix}${String(nextSeq).padStart(3, "0")}`;

  const dup = await tx.material.findUnique({ where: { code } });
  if (dup) {
    return {
      ok: false,
      error: `物料编号「${code}」已存在，请稍后重试`,
    };
  }

  return { ok: true, code };
}
