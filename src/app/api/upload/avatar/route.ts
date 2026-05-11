import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { requirePermission } from "@/lib/api-auth";

const ALLOWED = new Set(["image/jpeg", "image/bmp", "image/webp"]);
const MAX = 5 * 1024 * 1024;
const AVATAR_SIZE = 200;

async function toAvatar200(
  buf: Buffer,
  mime: string,
): Promise<{ data: Buffer; ext: string }> {
  const base = sharp(buf).rotate().resize(AVATAR_SIZE, AVATAR_SIZE, {
    fit: "cover",
    position: "centre",
  });
  if (mime === "image/webp") {
    return {
      data: await base.webp({ quality: 85 }).toBuffer(),
      ext: "webp",
    };
  }
  // JPEG 与 BMP 均输出为 JPEG，体积更小；BMP 另存为 .jpg
  return {
    data: await base.jpeg({ quality: 85 }).toBuffer(),
    ext: "jpg",
  };
}

export async function POST(req: Request) {
  const canCreate = await requirePermission("employee.create");
  const canEdit = await requirePermission("employee.edit");
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
      { error: "仅支持 JPEG、BMP、WEBP 格式" },
      { status: 400 },
    );
  }

  const raw = Buffer.from(await file.arrayBuffer());
  let out: Buffer;
  let ext: string;
  try {
    const processed = await toAvatar200(raw, type);
    out = processed.data;
    ext = processed.ext;
  } catch {
    return NextResponse.json({ error: "图片无法处理，请换一张试试" }, { status: 400 });
  }

  const dir = path.join(process.cwd(), "public", "uploads", "avatars");
  await mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const fsPath = path.join(dir, name);
  await writeFile(fsPath, out);

  const url = `/uploads/avatars/${name}`;
  return NextResponse.json({ url });
}
