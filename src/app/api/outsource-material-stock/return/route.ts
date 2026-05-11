import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const lineSchema = z.object({
  supplierId: z.string().optional().nullable(),
  materialId: z.string().min(1),
  returnQty: z.number().int().min(1),
  scrapQty: z.number().int().min(0).optional(),
});

const bodySchema = z.object({
  lines: z.array(lineSchema).min(1),
});

export async function POST(req: Request) {
  const auth = await requirePermission("outsource.edit");
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
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const lines = parsed.data.lines.map((x) => ({
    supplierId: x.supplierId?.trim() ? x.supplierId.trim() : null,
    materialId: x.materialId,
    returnQty: Math.max(1, Math.trunc(Number(x.returnQty) || 0)),
    scrapQty: Math.max(0, Math.trunc(Number(x.scrapQty) || 0)),
  }));

  const dedup = new Set<string>();
  for (const ln of lines) {
    const key = `${ln.supplierId ?? "NONE"}::${ln.materialId}`;
    if (dedup.has(key)) {
      return NextResponse.json(
        { error: "存在重复退料行（相同加工方+物料）" },
        { status: 400 },
      );
    }
    dedup.add(key);
  }

  try {
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      let totalReturned = 0;
      let totalScrapped = 0;
      let affectedLineCount = 0;

      for (const item of lines) {
        const sourceLines = await tx.outsourceOrderLine.findMany({
          where: {
            materialId: item.materialId,
            quantity: { gt: 0 },
            outsourceOrder: {
              status: "CLOSED",
              supplierId: item.supplierId,
            },
          },
          orderBy: [
            { outsourceOrder: { createdAt: "asc" } },
            { sortOrder: "asc" },
          ],
          include: {
            outsourceOrder: {
              select: {
                id: true,
                orderNo: true,
                product: { select: { model: true, customerMaterialCode: true } },
              },
            },
            material: { select: { code: true, name: true } },
          },
        });

        const canReturn = sourceLines.reduce((s, r) => s + r.quantity, 0);
        if (item.returnQty + item.scrapQty > canReturn) {
          const matLabel = sourceLines[0]?.material
            ? `${sourceLines[0].material.code}（${sourceLines[0].material.name}）`
            : item.materialId;
          return {
            ok: false as const,
            error: `${matLabel} 可处理数量不足（退料+报废），当前可用 ${canReturn}`,
          };
        }

        let remainingReturn = item.returnQty;
        let remainingScrap = item.scrapQty;
        for (const row of sourceLines) {
          if (remainingReturn <= 0 && remainingScrap <= 0) break;
          const canTake = row.quantity;
          if (canTake <= 0) continue;
          const takeReturn = Math.min(remainingReturn, canTake);
          const takeScrap = Math.min(remainingScrap, canTake - takeReturn);
          const consumed = takeReturn + takeScrap;
          if (consumed <= 0) continue;

          await tx.outsourceOrderLine.update({
            where: { id: row.id },
            data: { quantity: row.quantity - consumed },
          });

          if (takeReturn > 0) {
            const productLabel =
              row.outsourceOrder.product.model?.trim() ||
              row.outsourceOrder.product.customerMaterialCode?.trim() ||
              "—";
            await tx.materialInbound.create({
              data: {
                materialId: item.materialId,
                quantity: takeReturn,
                receivedAt: now,
                // 按需求：外发库存退料不绑定外发单号
                purchaseOrderNo: null,
                partDescription: `外发库存退料（${productLabel}）`,
                operatorUserId: auth.user.id,
              },
            });
          }

          remainingReturn -= takeReturn;
          remainingScrap -= takeScrap;
          totalReturned += takeReturn;
          totalScrapped += takeScrap;
          affectedLineCount += 1;
        }
      }

      return {
        ok: true as const,
        totalReturned,
        totalScrapped,
        affectedLineCount,
      };
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      totalReturned: result.totalReturned,
      totalScrapped: result.totalScrapped,
      affectedLineCount: result.affectedLineCount,
    });
  } catch (e) {
    console.error("[POST /api/outsource-material-stock/return]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "退料失败" },
      { status: 500 },
    );
  }
}

