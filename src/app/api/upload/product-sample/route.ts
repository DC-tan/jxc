import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { requirePermission } from "@/lib/api-auth";

const ALLOWED = new Set(["image/jpeg", "image/bmp"]);
const MAX = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const canCreate = await requirePermission("product.create");
  const canEdit = await requirePermission("product.edit");
  if (!canCreate.ok && !canEdit.ok) {
    return NextResponse.json(
      { error: canEdit.message },
      { status: canEdit.status },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择文件" }, { status: 400 });
  }

  if (file.size > MAX) {
    return NextResponse.json({ error: "文件不能超过 5MB" }, { status: 400 });
  }

  const type = file.type || "";
  if (!ALLOWED.has(type)) {
    return NextResponse.json(
      { error: "商品图仅支持 JPEG、BMP" },
      { status: 400 },
    );
  }

  const ext = type === "image/jpeg" ? "jpg" : "bmp";
  const buf = Buffer.from(await file.arrayBuffer());
  const dir = path.join(process.cwd(), "public", "uploads", "product-samples");
  await mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const fsPath = path.join(dir, name);
  await writeFile(fsPath, buf);

  const url = `/uploads/product-samples/${name}`;
  return NextResponse.json({ url });
}
