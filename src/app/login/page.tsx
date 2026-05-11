"use client";

import { UserOutlined } from "@ant-design/icons";
import { App, Avatar, Button, Card, Form, Input, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  readLastEmployeeLogin,
  writeLastEmployeeLogin,
} from "@/lib/last-employee-login";

export default function EmployeeLoginPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm();
  const [lastInfo, setLastInfo] = useState<{
    name: string;
    avatarUrl: string | null;
  } | null>(null);

  useEffect(() => {
    const p = readLastEmployeeLogin();
    if (p) {
      form.setFieldsValue({ account: p.account });
      setLastInfo({ name: p.name, avatarUrl: p.avatarUrl });
    }
  }, [form]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg,#f0f5ff 0%,#ffffff 50%,#f6ffed 100%)",
        padding: 24,
      }}
    >
      <Card style={{ width: 420, maxWidth: "100%" }} title="员工登录">
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          请输入管理员为您开通的<strong>员工编号</strong>或<strong>登录名</strong>，以及登录密码。
        </Typography.Paragraph>
        {lastInfo && (lastInfo.name || lastInfo.avatarUrl) ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 16,
              paddingBottom: 16,
              borderBottom: "1px solid #f0f0f0",
            }}
          >
            <Avatar
              size={48}
              src={lastInfo.avatarUrl ?? undefined}
              icon={!lastInfo.avatarUrl ? <UserOutlined /> : undefined}
            />
            {lastInfo.name ? (
              <Typography.Text strong style={{ fontSize: 16 }}>
                {lastInfo.name}
              </Typography.Text>
            ) : null}
          </div>
        ) : null}
        <Form
          form={form}
          layout="vertical"
          onFinish={async (v) => {
            const res = await fetch("/api/auth/employee-login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                account: v.account,
                password: v.password,
              }),
            });
            const data = await res.json();
            if (!res.ok) {
              message.error(data.error ?? "登录失败");
              return;
            }
            const account = String(v.account ?? "").trim();
            writeLastEmployeeLogin({
              account,
              name: data.user?.name ?? "",
              avatarUrl: data.user?.avatarUrl ?? null,
            });
            message.success("登录成功");
            router.replace("/dashboard");
          }}
        >
          <Form.Item
            name="account"
            label="员工编号或登录名"
            rules={[{ required: true, message: "请输入员工编号或登录名" }]}
          >
            <Input size="large" autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password size="large" autoComplete="current-password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block size="large">
              登录
            </Button>
          </Form.Item>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          管理员请前往{" "}
          <Link href="/admin/login">后台管理入口</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
