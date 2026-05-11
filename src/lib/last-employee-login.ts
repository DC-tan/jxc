export const LAST_EMPLOYEE_LOGIN_KEY = "jxc_employee_last_login";

export type LastEmployeeLogin = {
  account: string;
  name: string;
  avatarUrl: string | null;
};

export function readLastEmployeeLogin(): LastEmployeeLogin | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_EMPLOYEE_LOGIN_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LastEmployeeLogin>;
    if (typeof p.account !== "string" || !p.account) return null;
    return {
      account: p.account,
      name: typeof p.name === "string" ? p.name : "",
      avatarUrl:
        p.avatarUrl === undefined || p.avatarUrl === null
          ? null
          : typeof p.avatarUrl === "string"
            ? p.avatarUrl
            : null,
    };
  } catch {
    return null;
  }
}

export function writeLastEmployeeLogin(data: LastEmployeeLogin): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAST_EMPLOYEE_LOGIN_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota */
  }
}
