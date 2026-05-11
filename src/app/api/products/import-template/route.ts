import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requirePermission } from "@/lib/api-auth";
import { PRODUCT_IMPORT_HEADERS } from "@/lib/productExcel";

export async function GET() {
  const auth = await requirePermission("product.create");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const ws = XLSX.utils.aoa_to_sheet([
    [...PRODUCT_IMPORT_HEADERS],
    [
      "填写客户编号或名称",
      "客户下单物料编号（非系统档案号）",
      "机型-001",
      "型号-A",
      "规格说明",
      "PCS",
      1.2,
      0.3,
      100,
      1000,
      "检料备注示例",
    ],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "商品");
  const buf = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  const filename = encodeURIComponent("商品导入模板.xlsx");
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="product-import-template.xlsx"; filename*=UTF-8''${filename}`,
    },
  });
}
