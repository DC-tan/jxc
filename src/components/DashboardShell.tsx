"use client";

import {
  Avatar,
  Dropdown,
  Layout,
  Menu,
  Spin,
  Typography,
  type MenuProps,
} from "antd";
import {
  BarChartOutlined,
  HomeOutlined,
  LogoutOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  TruckOutlined,
  UserOutlined,
  ContainerOutlined,
  ExportOutlined,
  AppstoreOutlined,
  InboxOutlined,
  ExperimentOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { GlobalSearch } from "@/components/GlobalSearch";
import {
  readLastEmployeeLogin,
  writeLastEmployeeLogin,
} from "@/lib/last-employee-login";

const { Header, Sider, Content } = Layout;
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "v0.0.0";
const SIDER_WIDTH = 220;
const HEADER_HEIGHT = 64;

function formatSystemTime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

type Me = {
  name: string;
  loginName: string;
  employeeNo: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  permissions: string[];
};

function buildMenu(perms: Set<string>, isAdmin: boolean): MenuProps["items"] {
  const allow = (code: string) => isAdmin || perms.has(code);

  const items: MenuProps["items"] = [];

  items.push({
    key: "/dashboard",
    icon: <HomeOutlined />,
    label: <Link href="/dashboard">首页</Link>,
  });

  if (allow("employee.view")) {
    items.push({
      key: "/dashboard/employees",
      icon: <TeamOutlined />,
      label: <Link href="/dashboard/employees">员工管理</Link>,
    });
  }
  if (allow("customer.view")) {
    items.push({
      key: "/dashboard/customers",
      icon: <UserOutlined />,
      label: <Link href="/dashboard/customers">客户信息</Link>,
    });
  }
  if (allow("supplier.view")) {
    items.push({
      key: "/dashboard/suppliers",
      icon: <ShopOutlined />,
      label: <Link href="/dashboard/suppliers">供应商信息</Link>,
    });
  }
  if (allow("product.view")) {
    items.push({
      key: "/dashboard/products",
      icon: <AppstoreOutlined />,
      label: <Link href="/dashboard/products">商品信息</Link>,
    });
  }
  if (allow("material.view")) {
    items.push({
      key: "/dashboard/materials",
      icon: <InboxOutlined />,
      label: <Link href="/dashboard/materials">物料信息</Link>,
    });
  }
  if (allow("sales.view")) {
    items.push({
      key: "/dashboard/sales",
      icon: <ShoppingCartOutlined />,
      label: <Link href="/dashboard/sales">销售订单</Link>,
    });
  }
  if (allow("purchase.view")) {
    items.push({
      key: "/dashboard/purchase",
      icon: <ContainerOutlined />,
      label: <Link href="/dashboard/purchase">采购订单</Link>,
    });
  }
  if (allow("outsource.view")) {
    items.push({
      key: "/dashboard/outsource",
      icon: <ExportOutlined />,
      label: <Link href="/dashboard/outsource">物料外发</Link>,
    });
  }
  if (allow("sample.view")) {
    items.push({
      key: "/dashboard/samples",
      icon: <ExperimentOutlined />,
      label: <Link href="/dashboard/samples">样品详情</Link>,
    });
  }
  if (allow("warehouse.view")) {
    items.push({
      key: "/dashboard/warehouse",
      icon: <TruckOutlined />,
      label: <Link href="/dashboard/warehouse">仓库出货</Link>,
    });
  }
  if (allow("stats.view")) {
    items.push({
      key: "/dashboard/stats",
      icon: <BarChartOutlined />,
      label: <Link href="/dashboard/stats">统计与对帐</Link>,
    });
  }

  return items;
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me", { credentials: "include" });
        if (!res.ok) {
          router.replace("/login");
          return;
        }
        const data = (await res.json()) as Me;
        if (!cancelled) {
          setMe(data);
          if (!data.isAdmin) {
            const prev = readLastEmployeeLogin();
            let account = data.loginName;
            if (
              prev &&
              (prev.account === data.loginName ||
                prev.account === data.employeeNo)
            ) {
              account = prev.account;
            }
            writeLastEmployeeLogin({
              account,
              name: data.name,
              avatarUrl: data.avatarUrl,
            });
          }
        }
      } catch {
        router.replace("/login");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const menuItems = useMemo(() => {
    if (!me) return [];
    const perms = new Set(me.permissions);
    return buildMenu(perms, me.isAdmin) ?? [];
  }, [me]);

  const selectedKey = pathname;

  const onLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.replace("/login");
  };

  if (loading || !me) {
    return (
      <div style={{ padding: 120, textAlign: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        breakpoint="lg"
        collapsedWidth={0}
        width={SIDER_WIDTH}
        style={{
          display: "flex",
          flexDirection: "column",
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          height: "100vh",
          zIndex: 900,
        }}
      >
        <div
          style={{
            minHeight: 56,
            margin: 12,
            borderRadius: 8,
            background: "rgba(255,255,255,0.08)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "10px 8px",
            color: "#fff",
            gap: 2,
          }}
        >
          <Typography.Text
            strong
            style={{
              color: "#fff",
              fontSize: 15,
              textAlign: "center",
              lineHeight: 1.3,
              marginBottom: 0,
            }}
          >
            Gekun键坤科技
          </Typography.Text>
          <Typography.Text
            style={{
              color: "rgba(255,255,255,0.85)",
              fontSize: 12,
              fontWeight: 400,
              textAlign: "center",
              lineHeight: 1.2,
              marginBottom: 0,
            }}
          >
            进销存管理系统
          </Typography.Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: 92 }}
        />
        <div
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: 8,
            paddingTop: 10,
            borderTop: "1px solid rgba(255,255,255,0.12)",
            background: "#001529",
            color: "rgba(255,255,255,0.72)",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <div>版本：{APP_VERSION}</div>
          <div>开发者：深圳键坤科技</div>
          <div>系统时间：{formatSystemTime(now)}</div>
        </div>
      </Sider>
      <Layout style={{ marginLeft: SIDER_WIDTH, minHeight: "100vh" }}>
        <Header
          style={{
            background: "#fff",
            padding: "0 16px 0 24px",
            display: "grid",
            gridTemplateColumns: "1fr minmax(200px, 480px) 1fr",
            alignItems: "center",
            gap: 12,
            borderBottom: "1px solid #f0f0f0",
            position: "fixed",
            top: 0,
            left: SIDER_WIDTH,
            right: 0,
            height: HEADER_HEIGHT,
            lineHeight: `${HEADER_HEIGHT}px`,
            zIndex: 900,
          }}
        >
          <div />
          <div
            style={{
              justifySelf: "center",
              width: "100%",
              minWidth: 0,
            }}
          >
            <GlobalSearch />
          </div>
          <div style={{ justifySelf: "end" }}>
            <Dropdown
              menu={{
                items: [
                  {
                    key: "logout",
                    icon: <LogoutOutlined />,
                    label: "退出登录",
                    onClick: onLogout,
                  },
                ],
              }}
            >
              <span style={{ cursor: "pointer" }}>
                <Avatar
                  size={36}
                  src={me.avatarUrl ?? undefined}
                  icon={!me.avatarUrl ? <UserOutlined /> : undefined}
                  style={{ marginRight: 8 }}
                />
                <Typography.Text>
                  {me.name}
                  {me.isAdmin ? "（管理员）" : ""}
                </Typography.Text>
              </span>
            </Dropdown>
          </div>
        </Header>
        <Content style={{ margin: `${HEADER_HEIGHT + 24}px 24px 24px`, minHeight: 360 }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
