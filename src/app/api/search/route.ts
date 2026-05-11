import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireLogin } from "@/lib/api-auth";
import type { GlobalSearchItem } from "@/lib/global-search";

const MAX_PER_KIND = 5;
const Q_MAX = 64;

function icContains(q: string): { contains: string; mode: Prisma.QueryMode } {
  return { contains: q, mode: "insensitive" };
}

/**
 * 全局搜索：按当前用户可见模块，在常用字段中不区分大小写匹配（Prisma + PostgreSQL）。
 * GET /api/search?q=关键字
 */
export async function GET(req: Request) {
  const auth = await requireLogin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { user } = auth;
  const p = (code: string) => user.isAdmin || user.permissionCodes.has(code);
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("q")?.trim() ?? "";
  if (raw.length < 1) {
    return NextResponse.json({ results: [] as GlobalSearchItem[] });
  }
  const q = raw.length > Q_MAX ? raw.slice(0, Q_MAX) : raw;
  const sub = (s: string) => (s.length > 80 ? `${s.slice(0, 80)}…` : s);

  const results: GlobalSearchItem[] = [];

  const run = async () => {
    const tasks: Promise<void>[] = [];

    if (p("customer.view")) {
      tasks.push(
        (async () => {
          const rows = await prisma.customer.findMany({
            where: {
              OR: [
                { name: icContains(q) },
                { code: icContains(q) },
                { shortName: icContains(q) },
              ],
            },
            take: MAX_PER_KIND,
            orderBy: { updatedAt: "desc" },
            select: { id: true, code: true, name: true, shortName: true },
          });
          for (const r of rows) {
            results.push({
              id: r.id,
              kind: "customer",
              title: r.name,
              subtitle: `客户 ${r.code}${r.shortName ? ` · ${r.shortName}` : ""}`,
              href: `/dashboard/customers?openCustomerId=${encodeURIComponent(r.id)}`,
            });
          }
        })(),
      );
    }

    if (p("supplier.view")) {
      tasks.push(
        (async () => {
          const rows = await prisma.supplier.findMany({
            where: {
              OR: [
                { name: icContains(q) },
                { code: icContains(q) },
                { shortName: icContains(q) },
              ],
            },
            take: MAX_PER_KIND,
            orderBy: { updatedAt: "desc" },
            select: { id: true, code: true, name: true, shortName: true },
          });
          for (const r of rows) {
            results.push({
              id: r.id,
              kind: "supplier",
              title: r.name,
              subtitle: `供应商 ${r.code}${r.shortName ? ` · ${r.shortName}` : ""}`,
              href: `/dashboard/suppliers?openSupplierId=${encodeURIComponent(r.id)}`,
            });
          }
        })(),
      );
    }

    if (p("material.view")) {
      tasks.push(
        (async () => {
          const rows = await prisma.material.findMany({
            where: {
              OR: [
                { name: icContains(q) },
                { code: icContains(q) },
                { partDescription: icContains(q) },
                { brand: icContains(q) },
              ],
            },
            take: MAX_PER_KIND,
            orderBy: { updatedAt: "desc" },
            select: {
              id: true,
              code: true,
              name: true,
              partDescription: true,
            },
          });
          for (const r of rows) {
            results.push({
              id: r.id,
              kind: "material",
              title: r.code,
              subtitle: `物料 · ${r.name}${r.partDescription ? ` · ${sub(r.partDescription)}` : ""}`,
              href: `/dashboard/materials?detailMaterialId=${encodeURIComponent(r.id)}`,
            });
          }
        })(),
      );
    }

    if (p("product.view")) {
      tasks.push(
        (async () => {
          const rows = await prisma.product.findMany({
            where: {
              OR: [
                { model: icContains(q) },
                { customerMaterialCode: icContains(q) },
                { spec: icContains(q) },
                { machineModel: icContains(q) },
              ],
            },
            take: MAX_PER_KIND,
            orderBy: { updatedAt: "desc" },
            include: {
              customer: { select: { name: true, code: true } },
            },
          });
          for (const r of rows) {
            results.push({
              id: r.id,
              kind: "product",
              title: r.model || r.customerMaterialCode || "商品",
              subtitle: `商品 · ${r.customer.name}（${r.customer.code}）${r.customerMaterialCode ? ` · 客户料号 ${r.customerMaterialCode}` : ""}`,
              href: `/dashboard/products?detailProductId=${encodeURIComponent(r.id)}`,
            });
          }
        })(),
      );
    }

    if (p("sales.view")) {
      tasks.push(
        (async () => {
          const rows = await prisma.salesOrder.findMany({
            where: { customerOrderNo: icContains(q) },
            take: MAX_PER_KIND,
            orderBy: { createdAt: "desc" },
            include: {
              customer: { select: { name: true, code: true } },
            },
          });
          for (const r of rows) {
            results.push({
              id: r.id,
              kind: "salesOrder",
              title: r.customerOrderNo,
              subtitle: `销售订单 · ${r.customer.name}`,
              href: `/dashboard/sales?detailSalesOrderId=${encodeURIComponent(r.id)}`,
            });
          }
        })(),
      );
    }

    if (p("purchase.view")) {
      tasks.push(
        (async () => {
          const rows = await prisma.purchaseOrder.findMany({
            where: { orderNo: icContains(q) },
            take: MAX_PER_KIND,
            orderBy: { createdAt: "desc" },
            include: { supplier: { select: { name: true, code: true } } },
          });
          for (const r of rows) {
            results.push({
              id: r.id,
              kind: "purchaseOrder",
              title: r.orderNo,
              subtitle: `采购订单 · ${r.supplier.name}（${r.supplier.code}）`,
              href: `/dashboard/purchase?detailPurchaseOrderId=${encodeURIComponent(r.id)}`,
            });
          }
        })(),
      );
    }

    if (p("outsource.view")) {
      tasks.push(
        (async () => {
          const rows = await prisma.outsourceOrder.findMany({
            where: { orderNo: icContains(q) },
            take: MAX_PER_KIND,
            orderBy: { createdAt: "desc" },
            include: { product: { select: { model: true } } },
          });
          for (const r of rows) {
            results.push({
              id: r.id,
              kind: "outsourceOrder",
              title: r.orderNo,
              subtitle: `外发单 · 商品 ${r.product.model || "—"}`,
              href: `/dashboard/outsource?detailOutsourceOrderId=${encodeURIComponent(r.id)}`,
            });
          }
        })(),
      );
    }

    if (p("employee.view")) {
      tasks.push(
        (async () => {
          const rows = await prisma.user.findMany({
            where: {
              OR: [
                { name: icContains(q) },
                { loginName: icContains(q) },
                { employeeNo: icContains(q) },
              ],
            },
            take: MAX_PER_KIND,
            orderBy: { updatedAt: "desc" },
            select: {
              id: true,
              name: true,
              loginName: true,
              employeeNo: true,
            },
          });
          for (const r of rows) {
            results.push({
              id: r.id,
              kind: "employee",
              title: r.name,
              subtitle: `员工 · 编号 ${r.employeeNo} · 登录名 ${r.loginName}`,
              href: `/dashboard/employees?openEmployeeId=${encodeURIComponent(r.id)}`,
            });
          }
        })(),
      );
    }

    await Promise.all(tasks);
  };

  try {
    await run();
  } catch (e) {
    console.error("[GET /api/search]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "搜索失败" },
      { status: 500 },
    );
  }

  return NextResponse.json({ results });
}
