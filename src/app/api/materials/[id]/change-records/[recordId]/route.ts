import { NextResponse } from "next/server";
import { deleteArchiveChangeRecord } from "@/lib/archive-change-records";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; recordId: string }> },
) {
  try {
    const { id, recordId } = await ctx.params;
    return deleteArchiveChangeRecord({
      targetType: "MATERIAL",
      targetId: id,
      recordId,
      editPermission: "material.edit",
    });
  } catch (e) {
    console.error("[DELETE /api/materials/[id]/change-records/[recordId]]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "删除失败" },
      { status: 500 },
    );
  }
}
