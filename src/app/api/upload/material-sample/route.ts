import { NextResponse } from "next/server";
import { writeFile, mkdir, readdir, unlink } from "fs/promises";
import path from "path";
import { requirePermission } from "@/lib/api-auth";

const ALLOWED = new Set(["image/jpeg", "image/bmp"]);
const MAX = 5 * 1024 * 1024;
const MAX_IMAGES_PER_CODE = 3;

function sanitizeCode(code: string) {
  return code
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function parseExistingIndexes(existingUrls: string[], safeCode: string): Set<number> {
  const set = new Set<number>();
  const re = new RegExp(`^${safeCode}_(\\d{2})\\.(jpg|bmp)$`, "i");
  for (const u of existingUrls) {
    const base = String(u).split("/").pop() ?? "";
    const m = base.match(re);
    if (!m) continue;
    const idx = Number(m[1]);
    if (Number.isInteger(idx) && idx >= 1 && idx <= MAX_IMAGES_PER_CODE) set.add(idx);
  }
  return set;
}

export async function POST(req: Request) {
  const canCreate = await requirePermission("material.create");
  const canEdit = await requirePermission("material.edit");
  if (!canCreate.ok && !canEdit.ok) {
    return NextResponse.json(
      { error: canEdit.message },
      { status: canEdit.status },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  const codeRaw = String(form.get("code") ?? "").trim();
  const safeCode = sanitizeCode(codeRaw);
  const existingUrlsRaw = form.get("existingUrls");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择文件" }, { status: 400 });
  }
  if (!safeCode) {
    return NextResponse.json({ error: "请先提供物料编号后再上传图片" }, { status: 400 });
  }

  let existingUrls: string[] = [];
  if (typeof existingUrlsRaw === "string" && existingUrlsRaw.trim()) {
    try {
      const parsed = JSON.parse(existingUrlsRaw) as unknown;
      if (Array.isArray(parsed)) {
        existingUrls = parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      // ignore bad payload
    }
  }

  if (file.size > MAX) {
    return NextResponse.json({ error: "文件不能超过 5MB" }, { status: 400 });
  }

  const type = file.type || "";
  if (!ALLOWED.has(type)) {
    return NextResponse.json(
      { error: "签样图仅支持 JPEG、BMP" },
      { status: 400 },
    );
  }

  const ext = type === "image/jpeg" ? "jpg" : "bmp";
  const buf = Buffer.from(await file.arrayBuffer());
  const dir = path.join(process.cwd(), "public", "uploads", "material-samples");
  await mkdir(dir, { recursive: true });

  const used = parseExistingIndexes(existingUrls, safeCode);
  let slot = 0;
  for (let i = 1; i <= MAX_IMAGES_PER_CODE; i += 1) {
    if (!used.has(i)) {
      slot = i;
      break;
    }
  }
  if (slot === 0) {
    return NextResponse.json(
      { error: "每个物料最多上传 3 张图片（_01/_02/_03）" },
      { status: 400 },
    );
  }
  const slotText = String(slot).padStart(2, "0");
  const name = `${safeCode}_${slotText}.${ext}`;

  const files = await readdir(dir).catch(() => []);
  const sameSlot = new RegExp(`^${safeCode}_${slotText}\\.(jpg|bmp)$`, "i");
  await Promise.all(
    files
      .filter((f) => sameSlot.test(f))
      .map((f) => unlink(path.join(dir, f)).catch(() => undefined)),
  );

  const fsPath = path.join(dir, name);
  await writeFile(fsPath, buf);

  const url = `/uploads/material-samples/${name}`;
  return NextResponse.json({ url });
}
