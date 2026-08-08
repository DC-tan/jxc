import { NextResponse } from "next/server";
import { deleteArchiveChangeRecord } from "@/lib/archive-change-records";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; recordId: string }> },
) {
  try {
    const { id, recordId } = await ctx.params;
    return deleteArchiveChangeRecord({
      targetType: "PRODUCT",
      targetId: id,
      recordId,
      editPermission: "product.edit",
    });
  } catch (e) {
    console.error("[DELETE /api/products/[id]/change-records/[recordId]]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "删除失败" },
      { status: 500 },
    );
  }
}
