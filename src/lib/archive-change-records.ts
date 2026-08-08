import { NextResponse } from "next/server";
import { z } from "zod";
import type { ArchiveChangeKind, ArchiveChangeTarget } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";

const kindSchema = z.enum(["VERSION", "PRICE"]);

const createSchema = z.object({
  kind: kindSchema,
  changedAt: z.string().min(1, "请填写变更日期"),
  beforeText: z.string().min(1, "请填写变更前"),
  afterText: z.string().min(1, "请填写变更后"),
  reason: z.string().optional().nullable(),
});

function parseDayStart(isoOrDate: string): Date | null {
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export async function listArchiveChangeRecords(opts: {
  targetType: ArchiveChangeTarget;
  targetId: string;
  kind: ArchiveChangeKind;
  viewPermission: string;
}) {
  const auth = await requirePermission(opts.viewPermission);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const list = await prisma.archiveChangeRecord.findMany({
    where: {
      targetType: opts.targetType,
      targetId: opts.targetId,
      kind: opts.kind,
    },
    orderBy: [{ changedAt: "desc" }, { createdAt: "desc" }],
    include: {
      createdBy: {
        select: { id: true, name: true, loginName: true },
      },
    },
  });

  return NextResponse.json({
    list: list.map((r) => ({
      id: r.id,
      kind: r.kind,
      changedAt: r.changedAt.toISOString(),
      beforeText: r.beforeText,
      afterText: r.afterText,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy
        ? {
            id: r.createdBy.id,
            name: r.createdBy.name,
            loginName: r.createdBy.loginName,
          }
        : null,
    })),
  });
}

export async function createArchiveChangeRecord(opts: {
  targetType: ArchiveChangeTarget;
  targetId: string;
  exists: boolean;
  editPermission: string;
  body: unknown;
}) {
  const auth = await requirePermission(opts.editPermission);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  if (!opts.exists) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  }

  const parsed = createSchema.safeParse(opts.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const changedAt = parseDayStart(parsed.data.changedAt);
  if (!changedAt) {
    return NextResponse.json({ error: "变更日期无效" }, { status: 400 });
  }

  const row = await prisma.archiveChangeRecord.create({
    data: {
      targetType: opts.targetType,
      targetId: opts.targetId,
      kind: parsed.data.kind,
      changedAt,
      beforeText: parsed.data.beforeText.trim(),
      afterText: parsed.data.afterText.trim(),
      reason: parsed.data.reason?.trim() || null,
      createdById: auth.user.id,
    },
    include: {
      createdBy: {
        select: { id: true, name: true, loginName: true },
      },
    },
  });

  return NextResponse.json({
    id: row.id,
    kind: row.kind,
    changedAt: row.changedAt.toISOString(),
    beforeText: row.beforeText,
    afterText: row.afterText,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy
      ? {
          id: row.createdBy.id,
          name: row.createdBy.name,
          loginName: row.createdBy.loginName,
        }
      : null,
  });
}

export async function deleteArchiveChangeRecord(opts: {
  targetType: ArchiveChangeTarget;
  targetId: string;
  recordId: string;
  editPermission: string;
}) {
  const auth = await requirePermission(opts.editPermission);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const existing = await prisma.archiveChangeRecord.findFirst({
    where: {
      id: opts.recordId,
      targetType: opts.targetType,
      targetId: opts.targetId,
    },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "变更记录不存在" }, { status: 404 });
  }

  await prisma.archiveChangeRecord.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}

export { kindSchema };
