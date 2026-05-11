import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { requirePermission } from "@/lib/api-auth";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX = 2 * 1024 * 1024;

export async function POST(req: Request) {
  const auth = await requirePermission("purchase.edit");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择文件" }, { status: 400 });
  }

  if (file.size > MAX) {
    return NextResponse.json({ error: "文件不能超过 2MB" }, { status: 400 });
  }

  const type = file.type || "";
  if (!ALLOWED.has(type)) {
    return NextResponse.json(
      { error: "仅支持 JPEG、PNG、WebP" },
      { status: 400 },
    );
  }

  const ext =
    type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
  const buf = Buffer.from(await file.arrayBuffer());
  const dir = path.join(process.cwd(), "public", "uploads", "purchase-print");
  await mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const fsPath = path.join(dir, name);
  await writeFile(fsPath, buf);

  const url = `/uploads/purchase-print/${name}`;
  return NextResponse.json({ url });
}
