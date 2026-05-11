"use client";

import {
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Upload,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { ROLE_LABELS, type StaffRole } from "@/lib/permissions";
import { useMeTabPermissions } from "@/lib/use-me-tab-permissions";

type EmployeeRow = {
  id: string;
  employeeNo: string;
  loginName: string;
  name: string;
  phone: string | null;
  role: StaffRole;
  active: boolean;
  avatarUrl: string | null;
  permissions: { id: string; code: string; name: string }[];
};

type PermOpt = { id: string; code: string; name: string; module: string };

export function EmployeesPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState("staff");

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<EmployeeRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/employees", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "加载失败");
      setRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    if (activeTab === "staff") void load();
  }, [activeTab, load]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [form] = Form.useForm();
  const [permOptions, setPermOptions] = useState<PermOpt[]>([]);
  const [fileList, setFileList] = useState<unknown[]>([]);

  const role = Form.useWatch("role", form) as StaffRole | undefined;

  useEffect(() => {
    if (!open || !role) {
      setPermOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/permissions-for-role?role=${encodeURIComponent(role)}`,
        { credentials: "include" },
      );
      const data = await res.json();
      if (!res.ok) {
        message.error(data.error ?? "加载权限失败");
        return;
      }
      if (!cancelled) setPermOptions(data.permissions ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, role, message]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      role: "SALES",
      permissionIds: [],
      active: true,
    });
    setFileList([]);
    setOpen(true);
  };

  const openEdit = async (r: EmployeeRow) => {
    setEditing(r);
    setFileList([]);
    const res = await fetch(`/api/employees/${r.id}`, { credentials: "include" });
    const data = await res.json();
    if (!res.ok) {
      message.error(data.error ?? "加载失败");
      return;
    }
    form.setFieldsValue({
      employeeNo: data.employeeNo,
      loginName: data.loginName,
      name: data.name,
      phone: data.phone,
      role: data.role,
      permissionIds: data.permissionIds ?? [],
      active: data.active,
      password: undefined,
    });
    setOpen(true);
  };

  const openEmployeeIdQ = searchParams.get("openEmployeeId");
  const employeeLinkDone = useRef(false);
  useEffect(() => {
    if (!openEmployeeIdQ) {
      employeeLinkDone.current = false;
      return;
    }
    if (loading) return;
    if (employeeLinkDone.current) return;
    employeeLinkDone.current = true;
    setActiveTab("staff");
    const id = openEmployeeIdQ;
    const r = rows.find((x) => x.id === id);
    void (async () => {
      try {
        if (r) await openEdit(r);
        else await openEdit({ id } as EmployeeRow);
      } finally {
        router.replace(pathname, { scroll: false });
      }
    })();
  }, [openEmployeeIdQ, loading, rows, pathname, router]);

  const submit = async () => {
    const v = await form.validateFields();
    const permissionIds: string[] = v.permissionIds ?? [];

    try {
      if (!editing) {
        const res = await fetch("/api/employees", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeNo: v.employeeNo,
            loginName: v.loginName,
            name: v.name,
            phone: v.phone,
            password: v.password,
            role: v.role,
            permissionIds,
            avatarUrl: null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "创建失败");

        const newId = data.id as string;
        const file = fileList[0] as { originFileObj?: File } | undefined;
        if (file?.originFileObj) {
          const fd = new FormData();
          fd.append("file", file.originFileObj);
          const up = await fetch("/api/upload/avatar", {
            method: "POST",
            body: fd,
            credentials: "include",
          });
          const upData = await up.json();
          if (!up.ok) throw new Error(upData.error ?? "头像上传失败");
          const patch = await fetch(`/api/employees/${newId}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ avatarUrl: upData.url }),
          });
          const pData = await patch.json();
          if (!patch.ok) throw new Error(pData.error ?? "保存头像失败");
        }

        message.success("员工已创建");
      } else {
        const patchBody: Record<string, unknown> = {
          employeeNo: v.employeeNo,
          loginName: v.loginName,
          name: v.name,
          phone: v.phone,
          role: v.role,
          permissionIds,
          active: v.active,
        };
        if (v.password) patchBody.password = v.password;

        const res = await fetch(`/api/employees/${editing.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "保存失败");

        const file = fileList[0] as { originFileObj?: File } | undefined;
        if (file?.originFileObj) {
          const fd = new FormData();
          fd.append("file", file.originFileObj);
          const up = await fetch("/api/upload/avatar", {
            method: "POST",
            body: fd,
            credentials: "include",
          });
          const upData = await up.json();
          if (!up.ok) throw new Error(upData.error ?? "头像上传失败");
          const patch = await fetch(`/api/employees/${editing.id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ avatarUrl: upData.url }),
          });
          const pData = await patch.json();
          if (!patch.ok) throw new Error(pData.error ?? "保存头像失败");
        }

        message.success("已保存");
      }

      setOpen(false);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const onDelete = (r: EmployeeRow) => {
    Modal.confirm({
      title: "确认删除该员工？",
      content: "删除后不可恢复。",
      okType: "danger",
      onOk: async () => {
        const res = await fetch(`/api/employees/${r.id}`, {
          method: "DELETE",
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) {
          message.error(data.error ?? "删除失败");
          return;
        }
        message.success("已删除");
        await load();
      },
    });
  };

  const columns: ColumnsType<EmployeeRow> = [
    { title: "员工编号", dataIndex: "employeeNo", width: 120 },
    { title: "登录名", dataIndex: "loginName", width: 120 },
    { title: "姓名", dataIndex: "name", width: 120 },
    { title: "电话", dataIndex: "phone", width: 140 },
    {
      title: "角色",
      dataIndex: "role",
      width: 120,
      render: (v: StaffRole) => ROLE_LABELS[v],
    },
    {
      title: "状态",
      dataIndex: "active",
      width: 90,
      render: (v: boolean) => (v ? "在职" : "停用"),
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (_, r) => (
        <Space>
          <Button type="link" onClick={() => void openEdit(r)}>
            编辑
          </Button>
          <Button type="link" danger onClick={() => onDelete(r)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const { loading: tabPermLoading, allowed } = useMeTabPermissions();

  const visibleEmployeeTabKeys = useMemo(() => {
    const keys: string[] = [];
    if (allowed(["tab.employee", "employee.view"])) keys.push("staff");
    if (allowed(["permission.manage"])) keys.push("perm");
    return keys;
  }, [allowed]);

  useEffect(() => {
    if (tabPermLoading) return;
    if (visibleEmployeeTabKeys.length === 0) return;
    if (!visibleEmployeeTabKeys.includes(activeTab)) {
      setActiveTab(visibleEmployeeTabKeys[0]!);
    }
  }, [tabPermLoading, visibleEmployeeTabKeys, activeTab]);

  return (
    <Card title="员工管理">
      {tabPermLoading ? (
        <div style={{ padding: 56, textAlign: "center" }}>
          <Spin size="large" />
        </div>
      ) : visibleEmployeeTabKeys.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          当前账号无可用的员工管理 TAB，请联系管理员在「权限管理」中勾选。
        </Typography.Paragraph>
      ) : (
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "staff",
            label: "员工管理",
            children: (
              <>
                <Space style={{ marginBottom: 16 }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                    新增员工
                  </Button>
                  <Typography.Text type="secondary">
                    员工使用「员工编号」或「登录名」在登录页进入系统
                  </Typography.Text>
                </Space>
                <Table<EmployeeRow>
                  rowKey="id"
                  loading={loading}
                  columns={columns}
                  dataSource={rows}
                  pagination={{ pageSize: 10 }}
                />
              </>
            ),
          },
          {
            key: "perm",
            label: "权限管理",
            children: <PermissionManagementTab />,
          },
        ].filter((item) => {
          if (item.key === "staff") return allowed(["tab.employee", "employee.view"]);
          if (item.key === "perm") return allowed(["permission.manage"]);
          return false;
        })}
      />
      )}

      <Modal
        title={editing ? "编辑员工" : "新增员工"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        width={720}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="employeeNo"
                label="员工编号"
                rules={[{ required: true, message: "请填写员工编号" }]}
              >
                <Input placeholder="唯一编号" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="loginName"
                label="登录名"
                rules={[{ required: true, message: "请填写登录名" }]}
              >
                <Input placeholder="可与编号不同，用于登录" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="name"
                label="姓名"
                rules={[{ required: true, message: "请填写姓名" }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="phone" label="电话">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="password"
                label={editing ? "新密码（留空则不修改）" : "初始密码"}
                rules={
                  editing
                    ? []
                    : [{ required: true, message: "请设置初始密码（至少6位）" }]
                }
              >
                <Input.Password
                  placeholder={editing ? "不修改请留空" : "至少6位"}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="role"
                label="角色"
                rules={[{ required: true, message: "请选择角色" }]}
              >
                <Select
                  options={(Object.keys(ROLE_LABELS) as StaffRole[]).map(
                    (k) => ({
                      value: k,
                      label: ROLE_LABELS[k],
                    }),
                  )}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="权限（按角色矩阵可选）">
            <Space direction="vertical" style={{ width: "100%" }} size="small">
              <Space size={12} wrap>
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: "auto" }}
                  onClick={() =>
                    form.setFieldsValue({
                      permissionIds: permOptions.map((p) => p.id),
                    })
                  }
                  disabled={permOptions.length === 0}
                >
                  全部勾选
                </Button>
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: "auto" }}
                  onClick={() => form.setFieldsValue({ permissionIds: [] })}
                  disabled={permOptions.length === 0}
                >
                  全部取消
                </Button>
              </Space>
              <Form.Item name="permissionIds" noStyle>
                <Checkbox.Group style={{ width: "100%" }}>
                  <Row gutter={[8, 4]}>
                    {permOptions.map((p) => {
                      const tabPart = p.name && p.name !== "—" ? ` · ${p.name}` : "";
                      return (
                        <Col xs={24} sm={12} key={p.id}>
                          <Checkbox value={p.id}>
                            <Typography.Text>
                              {p.module}
                              {tabPart}
                            </Typography.Text>
                          </Checkbox>
                        </Col>
                      );
                    })}
                  </Row>
                </Checkbox.Group>
              </Form.Item>
            </Space>
          </Form.Item>
          {editing ? (
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item name="active" label="在职" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="照片（JPEG / BMP / WEBP，可选，保存为 200×200）">
                  <Upload
                    beforeUpload={() => false}
                    maxCount={1}
                    fileList={fileList as never}
                    onChange={({ fileList: fl }) => setFileList(fl as never)}
                    accept="image/jpeg,image/bmp,image/webp"
                  >
                    <Button icon={<UploadOutlined />}>选择文件</Button>
                  </Upload>
                </Form.Item>
              </Col>
            </Row>
          ) : (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              添加员工无需上传照片；如需头像，保存后可通过「编辑」上传（JPEG / BMP / WEBP，上传后自动裁切为 200×200 像素）。
            </Typography.Paragraph>
          )}
        </Form>
      </Modal>
    </Card>
  );
}

function AdminPasswordSection() {
  const { message } = App.useApp();
  const [form] = Form.useForm<{
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }>();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: v.currentPassword,
          newPassword: v.newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        message.error(typeof data.error === "string" ? data.error : "保存失败");
        return;
      }
      message.success("管理员密码已更新；「管理员登录页」请使用新密码。");
      form.resetFields();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        padding: "16px 20px",
        background: "#fafafa",
        border: "1px solid #f0f0f0",
        borderRadius: 8,
        maxWidth: 440,
      }}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16, fontSize: 13 }}>
        独立入口「管理员登录」使用登录名 <Typography.Text code>admin</Typography.Text>
        与本页设置的密码。修改后请妥善保管；初始密码见部署说明或种子脚本默认值。
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={() => void submit()} style={{ marginBottom: 0 }}>
        <Form.Item
          name="currentPassword"
          label="当前管理员密码"
          rules={[{ required: true, message: "请输入当前密码" }]}
        >
          <Input.Password autoComplete="current-password" placeholder="验证身份" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[{ required: true, message: "请输入新密码" }, { min: 6, message: "至少6位" }]}
        >
          <Input.Password autoComplete="new-password" placeholder="至少6位" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          dependencies={["newPassword"]}
          rules={[
            { required: true, message: "请再次输入新密码" },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("newPassword") === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error("两次输入的新密码不一致"));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={submitting}>
            保存管理员密码
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}

function PermissionManagementTab() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<{
    permissions: {
      id: string;
      code: string;
      name: string;
      module: string;
      sortOrder: number;
    }[];
    roles: { key: string; label: string }[];
    matrix: { id: string; role: string; permissionId: string; enabled: boolean }[];
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/role-matrix", { credentials: "include" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "加载失败");
      setData(j);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const matrixMap = useMemo(() => {
    const m = new Map<string, { id: string; enabled: boolean }>();
    if (!data) return m;
    for (const row of data.matrix) {
      m.set(`${row.role}__${row.permissionId}`, {
        id: row.id,
        enabled: row.enabled,
      });
    }
    return m;
  }, [data]);

  const tableRows = useMemo(() => {
    if (!data?.permissions.length) return [];
    const perms = [...data.permissions].sort(
      (a, b) =>
        a.module.localeCompare(b.module, "zh") ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name, "zh"),
    );
    const out: {
      perm: (typeof perms)[number];
      rowSpan: number;
      showModule: boolean;
    }[] = [];
    let i = 0;
    while (i < perms.length) {
      const mod = perms[i].module;
      let j = i + 1;
      while (j < perms.length && perms[j].module === mod) j += 1;
      const span = j - i;
      for (let k = 0; k < span; k += 1) {
        out.push({
          perm: perms[i + k],
          rowSpan: k === 0 ? span : 0,
          showModule: k === 0,
        });
      }
      i = j;
    }
    return out;
  }, [data]);

  const toggle = (matrixId: string, enabled: boolean) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        matrix: prev.matrix.map((x) =>
          x.id === matrixId ? { ...x, enabled } : x,
        ),
      };
    });
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch("/api/role-matrix", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: data.matrix.map((x) => ({ id: x.id, enabled: x.enabled })),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "保存失败");
      message.success("权限矩阵已保存");
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return loading ? (
      <div style={{ padding: 48, textAlign: "center" }}>
        <Spin size="large" />
      </div>
    ) : null;
  }

  const thStyle: CSSProperties = {
    padding: "8px 10px",
    background: "#e6f4ff",
    border: "1px solid #b8d4f0",
    textAlign: "center",
  };
  const tdStyle: CSSProperties = {
    padding: "6px 10px",
    border: "1px solid #d9d9d9",
    verticalAlign: "middle",
  };

  const matrixTabContent = (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        按功能与 TAB
        行设定各角色在员工档案中可勾选的权限；保存后，在「员工管理」中按员工角色为每人勾选。列顺序为：管理员、采购、物料员、外发管理员、业务员、仓管。
      </Typography.Paragraph>
      <Button type="primary" onClick={() => void save()} loading={saving}>
        保存矩阵
      </Button>

      <div style={{ overflow: "auto" }}>
        <table
          style={{
            width: "100%",
            minWidth: 900,
            borderCollapse: "collapse",
            background: "#fff",
          }}
        >
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: "left", minWidth: 120 }}>功能</th>
              <th style={{ ...thStyle, textAlign: "left", minWidth: 140 }}>TAB</th>
              {data.roles.map((r) => (
                <th key={r.key} style={{ ...thStyle, minWidth: 80 }}>
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map(({ perm, rowSpan, showModule }) => (
              <tr key={perm.id}>
                {showModule && rowSpan > 0 ? (
                  <td style={tdStyle} rowSpan={rowSpan}>
                    {perm.module}
                  </td>
                ) : null}
                <td style={tdStyle}>{perm.name === "—" ? "—" : perm.name}</td>
                {data.roles.map((r) => {
                  const cell = matrixMap.get(`${r.key}__${perm.id}`);
                  if (!cell) return <td key={r.key} style={tdStyle} />;
                  return (
                    <td key={r.key} style={{ ...tdStyle, textAlign: "center" }}>
                      <Checkbox
                        checked={cell.enabled}
                        onChange={(e) => toggle(cell.id, e.target.checked)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Space>
  );

  return (
    <Tabs
      defaultActiveKey="admin-password"
      items={[
        {
          key: "admin-password",
          label: "管理员密码",
          children: <AdminPasswordSection />,
        },
        {
          key: "matrix",
          label: "权限矩阵",
          children: matrixTabContent,
        },
      ]}
    />
  );
}
