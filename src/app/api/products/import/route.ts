import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  mapHeaderRow,
  normalizeHeaderKey,
  parseNonNegativeDecimal,
  PRODUCT_IMPORT_HEADERS,
  resolveCustomerId,
} from "@/lib/productExcel";

type RowErr = { row: number; message: string };

function cell(
  row: unknown[],
  colMap: Map<string, number>,
  header: string,
): unknown {
  const idx = colMap.get(normalizeHeaderKey(header));
  if (idx === undefined) return undefined;
  return row[idx];
}

function isRowEmpty(row: unknown[]): boolean {
  return row.every(
    (c) =>
      c === null ||
      c === undefined ||
      (typeof c === "string" && c.trim() === ""),
  );
}

export async function POST(req: Request) {
  const auth = await requirePermission("product.create");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "请上传 Excel 文件" }, { status: 400 });
  }

  const customerList = await prisma.customer.findMany({
    select: { id: true, code: true, name: true },
  });

  const buf = Buffer.from(await file.arrayBuffer());
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer" });
  } catch {
    return NextResponse.json({ error: "无法解析 Excel 文件" }, { status: 400 });
  }

  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return NextResponse.json({ error: "表格为空" }, { status: 400 });
  }

  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];

  if (!rows.length) {
    return NextResponse.json({ error: "表格为空" }, { status: 400 });
  }

  const headerRow = rows[0] ?? [];
  const colMap = mapHeaderRow(headerRow);
  for (const h of PRODUCT_IMPORT_HEADERS) {
    if (!colMap.has(normalizeHeaderKey(h))) {
      return NextResponse.json(
        {
          error: `表头缺少「${h}」，请使用下载的模板或包含完整列名`,
        },
        { status: 400 },
      );
    }
  }

  const parsed: {
    excelRow: number;
    customerId: string;
    customerMaterialCode: string;
    machineModel: string;
    model: string;
    spec: string;
    unit: string;
    price: string;
    processingCost: string;
    safetyStock: string;
    maxStock: string;
    inspectionNotes: string | null;
  }[] = [];

  const validationErrors: RowErr[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    if (isRowEmpty(row)) continue;

    const excelRow = i + 1;
    const customerRaw = String(cell(row, colMap, "客户名称") ?? "").trim();
    const customerMaterialCode = String(
      cell(row, colMap, "物料编号") ?? "",
    ).trim();
    const machineModel = String(cell(row, colMap, "机型号") ?? "").trim();
    const model = String(cell(row, colMap, "商品型号") ?? "").trim();
    const spec = String(cell(row, colMap, "商品规格") ?? "").trim();
    const unit = String(cell(row, colMap, "单位") ?? "").trim();
    const priceRaw = cell(row, colMap, "价格");
    const pcRaw = cell(row, colMap, "加工成本");
    const safeRaw = cell(row, colMap, "安全库存");
    const maxRaw = cell(row, colMap, "最大库存");
    const inspectionNotes = String(cell(row, colMap, "注意事项") ?? "").trim();

    if (!customerRaw) {
      validationErrors.push({ row: excelRow, message: "客户名称不能为空" });
      continue;
    }

    const customerId = resolveCustomerId(customerRaw, customerList);
    if (!customerId) {
      validationErrors.push({
        row: excelRow,
        message: `未找到客户「${customerRaw}」，请填写系统中已存在的客户编号或名称`,
      });
      continue;
    }

    if (!customerMaterialCode) {
      validationErrors.push({
        row: excelRow,
        message: "物料编号不能为空（请填写客户下单物料编号）",
      });
      continue;
    }

    if (!unit) {
      validationErrors.push({ row: excelRow, message: "单位不能为空" });
      continue;
    }

    const price = parseNonNegativeDecimal(priceRaw);
    if (price === null) {
      validationErrors.push({ row: excelRow, message: "价格须为非负数字" });
      continue;
    }

    const processingCost = parseNonNegativeDecimal(pcRaw) ?? "0";
    const safetyStock = parseNonNegativeDecimal(safeRaw) ?? "0";
    const maxStock = parseNonNegativeDecimal(maxRaw) ?? "0";

    parsed.push({
      excelRow,
      customerId,
      customerMaterialCode,
      machineModel,
      model,
      spec,
      unit,
      price,
      processingCost,
      safetyStock,
      maxStock,
      inspectionNotes: inspectionNotes || null,
    });
  }

  if (parsed.length === 0) {
    return NextResponse.json(
      {
        error: "没有可导入的数据行（请检查必填项与表头）",
        validationErrors,
      },
      { status: 400 },
    );
  }

  const createErrors: RowErr[] = [];
  let created = 0;

  for (const p of parsed) {
    try {
      await prisma.product.create({
        data: {
          customerId: p.customerId,
          customerMaterialCode: p.customerMaterialCode,
          machineModel: p.machineModel,
          model: p.model,
          spec: p.spec,
          unit: p.unit,
          price: p.price,
          processingCost: p.processingCost,
          safetyStock: p.safetyStock,
          maxStock: p.maxStock,
          inspectionNotes: p.inspectionNotes,
          imageUrls: [],
        },
      });
      created++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "创建失败";
      createErrors.push({ row: p.excelRow, message: msg });
    }
  }

  return NextResponse.json({
    created,
    validationErrors,
    failed: createErrors,
    message:
      createErrors.length === 0 && validationErrors.length === 0
        ? `成功导入 ${created} 条商品`
        : `已导入 ${created} 条；校验跳过 ${validationErrors.length} 行，写入失败 ${createErrors.length} 行`,
  });
}
