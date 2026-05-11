/**
 * 安全解析 fetch 响应为 JSON，避免响应体为空或非 JSON 时 `res.json()` 抛错。
 */
export async function fetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(input, init);
  const text = await res.text();
  let body: unknown = undefined;
  if (text.trim()) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`接口返回非 JSON（HTTP ${res.status}）`);
    }
  }
  if (!res.ok) {
    let msg = `请求失败（HTTP ${res.status}）`;
    if (body && typeof body === "object" && body !== null && "error" in body) {
      const err = (body as { error: unknown }).error;
      if (typeof err === "string") msg = err;
      else if (err && typeof err === "object") {
        try {
          const s = JSON.stringify(err);
          msg =
            s.length > 200
              ? `${s.slice(0, 200)}…（字段校验失败，请对照表单项）`
              : s;
        } catch {
          msg = "请求被拒绝，请检查填写项是否完整、正确";
        }
      }
    }
    throw new Error(msg);
  }
  return (body !== undefined ? body : {}) as T;
}
