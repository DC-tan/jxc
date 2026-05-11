"use client";

import { Typography } from "antd";

/** 与「物料信息-物料设置」共用单位等基础数据，避免重复维护 */
export function ProductSettingsTab() {
  return (
    <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
      商品的<strong>单位</strong>等下拉选项与「物料信息 → 物料设置」中的预设<strong>共用同一套数据</strong>
      （在物料设置中维护单位、品牌等）。若需新增单位或品牌，请到<strong>物料信息</strong>中操作。
      后续可在此扩展商品专用分类等配置。
    </Typography.Paragraph>
  );
}
