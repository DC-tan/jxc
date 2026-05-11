"use client";

import { Space, Typography } from "antd";
import { DeliveryNoteTemplateEditor } from "./DeliveryNoteTemplateEditor";

/** 出货设置：送货单打印模版 */
export function WarehouseSettingsTab() {
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ maxWidth: 720, marginBottom: 0 }}>
        当前版本出货以销售订单为源，确认出货后写入订单的
        <strong> 实际交货时间 </strong>
        ，与销售模块「销售订单查询」数据一致。送货单打印版式在下方设置。
      </Typography.Paragraph>
      <DeliveryNoteTemplateEditor />
    </Space>
  );
}
