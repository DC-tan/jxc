import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import {
  MATERIAL_IMPORT_HEADERS,
  mapHeaderRow,
  matchPresetKindId,
  normalizeHeaderKey,
  parseUnitPrice,
  resolveSupplierId,
} from "@/lib/materialExcel";

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
  const auth = await requirePermission("material.create");
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

  const supplierList = await prisma.supplier.findMany({
    select: { id: true, code: true, name: true, shortName: true },
  });

  const kindList = await prisma.materialPresetKind.findMany({
    select: { id: true, name: true },
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
  for (const h of MATERIAL_IMPORT_HEADERS) {
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
    name: string;
    kindId: string;
    partDescription: string | null;
    brand: string | null;
    unit: string;
    unitPrice: string;
    inspectionNotes: string | null;
    supplierId: string;
  }[] = [];

  const validationErrors: RowErr[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    if (isRowEmpty(row)) continue;

    const excelRow = i + 1;
    const name = String(cell(row, colMap, "物料名称") ?? "").trim();
    const kindRaw = cell(row, colMap, "物料种类");
    const partDescription = String(
      cell(row, colMap, "部件描述") ?? "",
    ).trim();
    const brand = String(cell(row, colMap, "品牌") ?? "").trim();
    const supplierRaw = String(cell(row, colMap, "供应商") ?? "").trim();
    const unit = String(cell(row, colMap, "单位") ?? "").trim();
    const priceRaw = cell(row, colMap, "单价");
    const inspectionNotes = String(cell(row, colMap, "备注") ?? "").trim();

    if (!name) {
      validationErrors.push({ row: excelRow, message: "物料名称不能为空" });
      continue;
    }

    const kindId = matchPresetKindId(kindRaw, kindList);
    if (!kindId) {
      validationErrors.push({
        row: excelRow,
        message:
          "物料种类无效，请填写「物料设置」中已存在的种类名称，或原中文/英文种类名",
      });
      continue;
    }

    if (!supplierRaw) {
      validationErrors.push({ row: excelRow, message: "供应商不能为空" });
      continue;
    }

    const supplierId = resolveSupplierId(supplierRaw, supplierList);
    if (!supplierId) {
      validationErrors.push({
        row: excelRow,
        message: `未找到供应商「${supplierRaw}」，请填写系统中已存在的供应商编号或名称`,
      });
      continue;
    }

    if (!unit) {
      validationErrors.push({ row: excelRow, message: "单位不能为空" });
      continue;
    }

    const up = parseUnitPrice(priceRaw);
    if (up === null) {
      validationErrors.push({ row: excelRow, message: "单价须为非负数字" });
      continue;
    }

    parsed.push({
      excelRow,
      name,
      kindId,
      partDescription: partDescription || null,
      brand: brand || null,
      unit,
      unitPrice: String(up),
      inspectionNotes: inspectionNotes || null,
      supplierId,
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
    const code = `IMP-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    try {
      await prisma.material.create({
        data: {
          code,
          name: p.name,
          kindId: p.kindId,
          kind: null,
          partDescription: p.partDescription,
          brand: p.brand,
          unit: p.unit,
          unitPrice: p.unitPrice,
          supplierId: p.supplierId,
          inspectionNotes: p.inspectionNotes,
          sampleImageUrls: [],
        },
      });
      created++;
    } catch (e) {
      const msg =
        e instanceof Error && e.message.includes("Unique constraint")
          ? "物料编号冲突，请重试"
          : e instanceof Error
            ? e.message
            : "创建失败";
      createErrors.push({ row: p.excelRow, message: msg });
    }
  }

  return NextResponse.json({
    created,
    validationErrors,
    failed: createErrors,
    message:
      createErrors.length === 0 && validationErrors.length === 0
        ? `成功导入 ${created} 条物料`
        : `已导入 ${created} 条；校验跳过 ${validationErrors.length} 行，写入失败 ${createErrors.length} 行`,
  });
}
