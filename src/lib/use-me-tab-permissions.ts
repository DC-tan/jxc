"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";

export type MeTabPermissionsSnapshot = {
  isAdmin: boolean;
  permissions: string[];
  rawPermissions: string[];
};

/**
 * 用于按权限矩阵中的 tab.*（及少量 legacy 码）控制页面内 Tabs 是否展示。
 */
export function useMeTabPermissions() {
  const [me, setMe] = useState<MeTabPermissionsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await fetchJson<
          MeTabPermissionsSnapshot & { name?: string; loginName?: string }
        >("/api/me", { credentials: "include" });
        if (!cancelled) {
          setMe({
            isAdmin: m.isAdmin,
            permissions: Array.isArray(m.permissions) ? m.permissions : [],
            rawPermissions: Array.isArray(m.rawPermissions)
              ? m.rawPermissions
              : [],
          });
        }
      } catch {
        if (!cancelled) setMe(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allowed = useCallback(
    (codes: string | readonly string[]) => {
      const arr = typeof codes === "string" ? [codes] : [...codes];
      if (!me) return false;
      if (me.isAdmin) return true;
      return arr.some((c) =>
        c.startsWith("tab.")
          ? me.rawPermissions.includes(c)
          : me.permissions.includes(c),
      );
    },
    [me],
  );

  return { loading, me, allowed };
}
