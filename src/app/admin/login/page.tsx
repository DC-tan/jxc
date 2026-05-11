"use client";

import { App, Button, Card, Form, Input, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const { message } = App.useApp();
  const router = useRouter();

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg,#fff7e6 0%,#ffffff 55%,#e6f7ff 100%)",
        padding: 24,
      }}
    >
      <Card style={{ width: 420, maxWidth: "100%" }} title="后台管理登录">
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          默认管理员账号为 <Typography.Text code>admin</Typography.Text>
          ，初始密码由系统预设；首次部署后请尽快在系统中修改员工密码策略（后续版本可加强制改密）。
        </Typography.Paragraph>
        <Form
          layout="vertical"
          onFinish={async (v) => {
            const res = await fetch("/api/auth/admin-login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ password: v.password }),
            });
            const data = await res.json();
            if (!res.ok) {
              message.error(data.error ?? "登录失败");
              return;
            }
            message.success("登录成功");
            router.replace("/dashboard");
          }}
        >
          <Form.Item
            name="password"
            label="管理员密码"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password size="large" autoComplete="current-password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block size="large">
              进入后台
            </Button>
          </Form.Item>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          普通员工请返回{" "}
          <Link href="/login">员工登录</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
