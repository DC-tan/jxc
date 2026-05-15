import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermissionSome } from "@/lib/api-auth";

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "缺少提醒记录"),
  channel: z.enum(["sales", "purchase"]),
});

export async function POST(req: Request) {
  const auth = await requirePermissionSome([
    "sales.create",
    "purchase.create",
    "purchase.edit",
  ]);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const fe = parsed.error.flatten();
    return NextResponse.json(
      { error: fe.fieldErrors, formErrors: fe.formErrors },
      { status: 400 },
    );
  }
  const ids = [...new Set(parsed.data.ids)];
  const channel = parsed.data.channel;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.customerChangeReminder.findMany({
        where: {
          id: { in: ids },
          status: "ACTIVE",
        },
        orderBy: [{ proposedAt: "asc" }, { createdAt: "asc" }],
      });
      let advancedCount = 0;
      let doneCount = 0;
      for (const row of rows) {
        let salesCount = row.salesConfirmCount;
        let purchaseCount = row.purchaseConfirmCount;
        if (channel === "sales") {
          if (salesCount >= 2) continue;
          salesCount += 1;
        } else {
          if (purchaseCount >= 2) continue;
          purchaseCount += 1;
        }
        const nextStatus =
          salesCount >= 2 && purchaseCount >= 2 ? "DONE" : "ACTIVE";
        await tx.customerChangeReminder.update({
          where: { id: row.id },
          data: {
            status: nextStatus,
            salesConfirmCount: salesCount,
            purchaseConfirmCount: purchaseCount,
            ...(channel === "sales"
              ? {
                  salesLastConfirmedAt: new Date(),
                  salesLastConfirmedById: auth.user.id,
                }
              : {
                  purchaseLastConfirmedAt: new Date(),
                  purchaseLastConfirmedById: auth.user.id,
                }),
          },
        });
        advancedCount++;
        if (nextStatus === "DONE") doneCount++;
      }
      return { matched: rows.length, advancedCount, doneCount };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[POST /api/customer-change-reminders/ack]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "确认提醒失败" },
      { status: 500 },
    );
  }
}
