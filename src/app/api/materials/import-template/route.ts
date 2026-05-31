import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requirePermission } from "@/lib/api-auth";
import {
  MATERIAL_IMPORT_HEADERS,
  MATERIAL_IMPORT_OPTIONAL_HEADER,
} from "@/lib/materialExcel";

export async function GET() {
  const auth = await requirePermission("material.create");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const ws = XLSX.utils.aoa_to_sheet([
    [...MATERIAL_IMPORT_HEADERS, MATERIAL_IMPORT_OPTIONAL_HEADER],
    [
      "示例电阻",
      "电子料",
      "0402 封装",
      "村田",
      "填写供应商编号或名称",
      "PCS",
      0.05,
      "进口",
      "",
    ],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "物料");
  const buf = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  const filename = encodeURIComponent("物料导入模板.xlsx");
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="material-import-template.xlsx"; filename*=UTF-8''${filename}`,
    },
  });
}
