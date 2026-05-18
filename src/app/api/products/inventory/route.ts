import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { parseProductImageUrls } from "@/lib/productImageUrls";

export async function GET(req: Request) {
  try {
    const auth = await requirePermission("product.view");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const { searchParams } = new URL(req.url);
    const productModel = searchParams.get("productModel")?.trim() || undefined;
    const productDescription =
      searchParams.get("productDescription")?.trim() || undefined;
    const customerId = searchParams.get("customerId")?.trim() || undefined;
    const code = searchParams.get("materialCode")?.trim() || undefined;
    const receivedFrom = searchParams.get("receivedFrom");
    const receivedTo = searchParams.get("receivedTo");
    const stockMin = searchParams.get("stockMin");
    const stockMax = searchParams.get("stockMax");
    const deprecatedRaw = (searchParams.get("deprecated") ?? "0").trim();

    const fromDate = receivedFrom ? new Date(receivedFrom) : undefined;
    const toDate = receivedTo ? new Date(receivedTo) : undefined;
    if (fromDate && Number.isNaN(fromDate.getTime())) {
      return NextResponse.json({ error: "入库开始时间无效" }, { status: 400 });
    }
    if (toDate && Number.isNaN(toDate.getTime())) {
      return NextResponse.json({ error: "入库结束时间无效" }, { status: 400 });
    }

    const inboundConditions: Prisma.ProductInboundWhereInput[] = [];
    if (fromDate || toDate) {
      inboundConditions.push({
        receivedAt: {
          ...(fromDate ? { gte: fromDate } : {}),
          ...(toDate ? { lte: toDate } : {}),
        },
      });
    }

    const textOrParts: Prisma.ProductWhereInput[] = [];
    if (productModel) {
      textOrParts.push({
        model: { contains: productModel, mode: "insensitive" },
      });
    }
    if (productDescription) {
      textOrParts.push({
        spec: { contains: productDescription, mode: "insensitive" },
      });
    }
    if (code) {
      textOrParts.push({
        customerMaterialCode: { contains: code, mode: "insensitive" },
      });
    }

    const where: Prisma.ProductWhereInput = {
      ...(deprecatedRaw === "1"
        ? { isDeprecated: true }
        : deprecatedRaw === "all"
          ? {}
          : { isDeprecated: false }),
      ...(customerId ? { customerId } : {}),
      ...(textOrParts.length === 1
        ? textOrParts[0]
        : textOrParts.length > 1
          ? { AND: textOrParts }
          : {}),
      ...(inboundConditions.length
        ? {
            inbounds: {
              some:
                inboundConditions.length === 1
                  ? inboundConditions[0]
                  : { AND: inboundConditions },
            },
          }
        : {}),
    };

    const list = await prisma.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        inbounds: {
          select: { quantity: true, receivedAt: true },
          orderBy: { receivedAt: "desc" },
        },
      },
    });

    const minN = stockMin !== null && stockMin !== "" ? Number(stockMin) : undefined;
    const maxN = stockMax !== null && stockMax !== "" ? Number(stockMax) : undefined;

    const rows = list
      .map((p) => {
        const totalQty = p.inbounds.reduce((s, i) => s + Number(i.quantity), 0);
        const lastPositive = p.inbounds.find((i) => Number(i.quantity) > 0);
        const lastReceivedAt = lastPositive?.receivedAt ?? null;
        return {
          id: p.id,
          isDeprecated: p.isDeprecated,
          deprecatedAt: p.deprecatedAt?.toISOString() ?? null,
          deprecatedReason: p.deprecatedReason,
          customer: p.customer,
          customerMaterialCode: p.customerMaterialCode,
          processingMode: p.processingMode,
          machineModel: p.machineModel,
          model: p.model,
          spec: p.spec,
          unit: p.unit,
          price: p.price.toString(),
          processingCost: p.processingCost.toString(),
          safetyStock: p.safetyStock?.toString() ?? null,
          maxStock: p.maxStock?.toString() ?? null,
          inspectionNotes: p.inspectionNotes,
          productRemark: p.productRemark,
          imageUrls: parseProductImageUrls(p.imageUrls),
          createdAt: p.createdAt.toISOString(),
          totalQty,
          lastReceivedAt: lastReceivedAt?.toISOString() ?? null,
        };
      })
      .filter((r) => {
        if (minN !== undefined && !Number.isNaN(minN) && r.totalQty < minN) {
          return false;
        }
        if (maxN !== undefined && !Number.isNaN(maxN) && r.totalQty > maxN) {
          return false;
        }
        return true;
      });

    return NextResponse.json({ list: rows });
  } catch (e) {
    console.error("[GET /api/products/inventory]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "查询失败" },
      { status: 500 },
    );
  }
}
