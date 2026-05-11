import { z } from "zod";

export const statsRangeQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export function parseStatsRange(
  fromStr: string | undefined,
  toStr: string | undefined,
): { from: Date; to: Date } {
  const now = new Date();
  let toD = toStr ? new Date(toStr) : new Date(now);
  if (Number.isNaN(toD.getTime())) toD = new Date(now);
  toD.setHours(23, 59, 59, 999);

  let fromD: Date;
  if (fromStr) {
    fromD = new Date(fromStr);
    if (Number.isNaN(fromD.getTime())) {
      fromD = new Date(now);
      fromD.setDate(fromD.getDate() - 30);
    }
    fromD.setHours(0, 0, 0, 0);
  } else {
    fromD = new Date(toD);
    fromD.setDate(fromD.getDate() - 30);
    fromD.setHours(0, 0, 0, 0);
  }
  if (fromD.getTime() > toD.getTime()) {
    const tmp = fromD;
    fromD = new Date(toD);
    fromD.setHours(0, 0, 0, 0);
    toD = new Date(tmp);
    toD.setHours(23, 59, 59, 999);
  }
  return { from: fromD, to: toD };
}
