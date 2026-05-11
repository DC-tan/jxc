"use client";

import { Tabs } from "antd";
import { OutsourceMaterialSlipTemplateEditor } from "./OutsourceMaterialSlipTemplateEditor";

/** 外发单设置：二级 TAB 可扩展其它模版或选项 */
export function OutsourceSettingsTab() {
  return (
    <Tabs
      destroyOnHidden
      items={[
        {
          key: "material-slip",
          label: "外发物料单模版设置",
          children: <OutsourceMaterialSlipTemplateEditor />,
        },
      ]}
    />
  );
}
