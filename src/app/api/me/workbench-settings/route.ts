import { NextResponse } from "next/server";
import { type AuthedUser, requireLogin } from "@/lib/api-auth";
import {
  getWorkbenchSettingsForUser,
  saveGlobalWorkbenchFromFormBody,
} from "@/lib/workbench-for-user";

/** 全系统工作台配置仅系统管理员可修改（与 tab.workbench 等业务权限无关） */
function canEditGlobalWorkbench(user: AuthedUser): boolean {
  return user.isAdmin;
}

export async function GET() {
  const auth = await requireLogin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  try {
    const settings = await getWorkbenchSettingsForUser(auth.user.id);
    return NextResponse.json(settings);
  } catch (e) {
    console.error("[GET /api/me/workbench-settings]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取设置失败" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  const auth = await requireLogin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  if (!canEditGlobalWorkbench(auth.user)) {
    return NextResponse.json(
      { error: "没有首页工作台设置权限，无法修改全系统配置" },
      { status: 403 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  const saved = await saveGlobalWorkbenchFromFormBody(body);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 400 });
  }
  try {
    const full = await getWorkbenchSettingsForUser(auth.user.id);
    return NextResponse.json(full);
  } catch (e) {
    console.error("[PUT /api/me/workbench-settings]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 500 },
    );
  }
}
