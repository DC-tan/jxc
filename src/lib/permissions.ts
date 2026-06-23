/** 与 Prisma `StaffRole` 枚举值保持一致，供前后端共用且避免客户端依赖 Prisma 运行时 */
export const STAFF_ROLE_KEYS = [
  "ADMIN",
  "SALES",
  "PURCHASE",
  "MATERIAL",
  "OUTSOURCE",
  "WAREHOUSE",
] as const;
export type StaffRole = (typeof STAFF_ROLE_KEYS)[number];

/**
 * 权限管理矩阵中的列顺序：管理员、采购、物料员、外发管理员、业务员、仓管
 * 与 Prisma 枚举/通用列表顺序可能不同
 */
export const MATRIX_ROLE_ORDER: StaffRole[] = [
  "ADMIN",
  "PURCHASE",
  "MATERIAL",
  "OUTSOURCE",
  "SALES",
  "WAREHOUSE",
];

/**
 * 功能模块 + TAB 行，对应「权限管理」表每一行。code 以 tab. 为前缀。
 * 名称 name 为 TAB 列；无子 Tab 时用 "—"（员工/客户/供应商等整模块一行）。
 * expandTo 为在鉴权/菜单/搜索等处展开的「旧版细项权限码」；空数组表示不展开，仅作独立授权（如首页瓷块、工作台设置）。
 */
export const PERMISSION_DEFINITIONS: {
  code: string;
  name: string;
  module: string;
  sortOrder: number;
  expandTo: string[];
}[] = [
  { module: "员工管理", name: "—", code: "tab.employee", sortOrder: 10, expandTo: [
    "employee.view",
    "employee.create",
    "employee.edit",
    "employee.delete",
    "permission.manage",
  ] },
  { module: "客户信息", name: "—", code: "tab.customer", sortOrder: 20, expandTo: [
    "customer.view",
    "customer.create",
    "customer.edit",
    "customer.delete",
  ] },
  { module: "供应商信息", name: "—", code: "tab.supplier", sortOrder: 30, expandTo: [
    "supplier.view",
    "supplier.create",
    "supplier.edit",
    "supplier.delete",
  ] },
  { module: "物料信息", name: "新增物料", code: "tab.mat.add", sortOrder: 40, expandTo: [
    "material.view",
    "material.create",
    "material.edit",
  ] },
  { module: "物料信息", name: "物料库存", code: "tab.mat.inv", sortOrder: 41, expandTo: [
    "material.view",
  ] },
  { module: "物料信息", name: "客供料入口", code: "tab.mat.customerSupply", sortOrder: 42, expandTo: [
    "material.view",
    "material.create",
  ] },
  { module: "物料信息", name: "手动调整", code: "tab.mat.adjust", sortOrder: 43, expandTo: [
    "material.view",
    "material.edit",
  ] },
  { module: "物料信息", name: "弃用旧料查询", code: "tab.mat.deprecated", sortOrder: 44, expandTo: [
    "material.view",
  ] },
  { module: "物料信息", name: "物料设置", code: "tab.mat.settings", sortOrder: 45, expandTo: [
    "material.edit",
  ] },
  { module: "商品信息", name: "新增商品", code: "tab.prod.add", sortOrder: 50, expandTo: [
    "product.view",
    "product.create",
    "product.edit",
  ] },
  { module: "商品信息", name: "商品库存", code: "tab.prod.inv", sortOrder: 51, expandTo: [
    "product.view",
  ] },
  { module: "商品信息", name: "商品入库", code: "tab.prod.stockIn", sortOrder: 52, expandTo: [
    "warehouse.view",
    "warehouse.edit",
  ] },
  { module: "商品信息", name: "手动调整", code: "tab.prod.adjust", sortOrder: 53, expandTo: [
    "product.view",
    "product.edit",
  ] },
  { module: "商品信息", name: "弃用商品查询", code: "tab.prod.deprecated", sortOrder: 54, expandTo: [
    "product.view",
  ] },
  { module: "销售订单", name: "新增销售订单", code: "tab.sales.add", sortOrder: 60, expandTo: [
    "sales.view",
    "sales.create",
    "sales.edit",
  ] },
  { module: "销售订单", name: "销售未交付单", code: "tab.sales.undelivered", sortOrder: 61, expandTo: [
    "sales.view",
    "sales.edit",
  ] },
  { module: "销售订单", name: "销售订单查询", code: "tab.sales.query", sortOrder: 62, expandTo: [
    "sales.view",
  ] },
  { module: "销售订单", name: "客户变更待提醒", code: "tab.sales.changeReminder", sortOrder: 63, expandTo: [
    "sales.view",
    "sales.create",
    "sales.edit",
  ] },
  { module: "采购订单", name: "新增采购订单", code: "tab.pur.add", sortOrder: 70, expandTo: [
    "purchase.view",
    "purchase.create",
  ] },
  { module: "采购订单", name: "PCB采购", code: "tab.pur.pcb", sortOrder: 71, expandTo: [
    "purchase.view",
    "purchase.create",
  ] },
  { module: "采购订单", name: "未交采购订单", code: "tab.pur.open", sortOrder: 72, expandTo: [
    "purchase.view",
  ] },
  { module: "采购订单", name: "修改采购单", code: "tab.pur.edit", sortOrder: 73, expandTo: [
    "purchase.edit",
  ] },
  { module: "采购订单", name: "确定收料", code: "tab.pur.receive", sortOrder: 74, expandTo: [
    "purchase.receive",
  ] },
  { module: "采购订单", name: "删除采购单", code: "tab.pur.delete", sortOrder: 75, expandTo: [
    "purchase.delete",
  ] },
  { module: "采购订单", name: "采购订单查询", code: "tab.pur.query", sortOrder: 76, expandTo: [
    "purchase.view",
  ] },
  { module: "采购订单", name: "采购订单设置", code: "tab.pur.settings", sortOrder: 77, expandTo: [
    "purchase.view",
  ] },
  { module: "物料外发", name: "新增外发订单", code: "tab.os.add", sortOrder: 80, expandTo: [
    "outsource.view",
    "outsource.create",
    "outsource.edit",
  ] },
  { module: "物料外发", name: "未回收外加工单", code: "tab.os.open", sortOrder: 81, expandTo: [
    "outsource.view",
    "outsource.edit",
    "outsource.delete",
  ] },
  { module: "物料外发", name: "确认回收", code: "tab.os.receive", sortOrder: 82, expandTo: [
    "outsource.receive",
  ] },
  { module: "物料外发", name: "外发加工单查询", code: "tab.os.query", sortOrder: 83, expandTo: [
    "outsource.view",
  ] },
  { module: "物料外发", name: "外发物料库存", code: "tab.os.stock", sortOrder: 84, expandTo: [
    "outsource.view",
    "outsource.edit",
  ] },
  { module: "物料外发", name: "外发回收库", code: "tab.os.recovery", sortOrder: 85, expandTo: [
    "outsource.view",
  ] },
  { module: "物料外发", name: "回收库手动调整", code: "tab.os.recoveryAdjust", sortOrder: 86, expandTo: [
    "outsource.recovery.adjust",
  ] },
  { module: "物料外发", name: "外发单设置", code: "tab.os.settings", sortOrder: 87, expandTo: [
    "outsource.view",
    "outsource.edit",
  ] },
  { module: "仓库出货", name: "出货", code: "tab.wh.ship", sortOrder: 90, expandTo: [
    "warehouse.view",
    "warehouse.edit",
  ] },
  { module: "仓库出货", name: "出货查询", code: "tab.wh.query", sortOrder: 91, expandTo: [
    "warehouse.view",
  ] },
  { module: "仓库出货", name: "出货设置", code: "tab.wh.settings", sortOrder: 92, expandTo: [
    "warehouse.view",
    "warehouse.edit",
  ] },
  { module: "样品详情", name: "新增样品", code: "tab.sample.add", sortOrder: 95, expandTo: [
    "sample.view",
    "sample.create",
    "sample.edit",
  ] },
  { module: "样品详情", name: "未交样品", code: "tab.sample.open", sortOrder: 96, expandTo: [
    "sample.view",
    "sample.edit",
  ] },
  { module: "样品详情", name: "样品查询", code: "tab.sample.query", sortOrder: 97, expandTo: [
    "sample.view",
  ] },
  { module: "统计与对账", name: "统计", code: "tab.stats.overview", sortOrder: 100, expandTo: [
    "stats.view",
  ] },
  { module: "统计与对账", name: "对账", code: "tab.stats.reconcile", sortOrder: 101, expandTo: [
    "stats.view",
  ] },
  { module: "首页", name: "销售提醒．交付", code: "tab.home.sales", sortOrder: 110, expandTo: [] },
  { module: "首页", name: "采购提醒", code: "tab.home.purchase", sortOrder: 111, expandTo: [] },
  { module: "首页", name: "收料提醒", code: "tab.home.receiving", sortOrder: 112, expandTo: [] },
  { module: "首页", name: "外发提醒", code: "tab.home.outsource", sortOrder: 113, expandTo: [] },
  { module: "首页", name: "回收外发提醒", code: "tab.home.outsourceNeed", sortOrder: 114, expandTo: [] },
  { module: "首页", name: "样品提醒", code: "tab.home.samples", sortOrder: 115, expandTo: [] },
  { module: "首页", name: "商品库存预警", code: "tab.home.prodStockAlert", sortOrder: 116, expandTo: [] },
  { module: "首页", name: "物料库存预警", code: "tab.home.matStockAlert", sortOrder: 117, expandTo: [] },
  { module: "首页", name: "客户对帐提醒", code: "tab.home.reconcileCustomer", sortOrder: 118, expandTo: [] },
  { module: "首页", name: "供应商对帐提醒", code: "tab.home.reconcileSupplier", sortOrder: 119, expandTo: [] },
  { module: "首页", name: "待办事项", code: "tab.home.todo", sortOrder: 120, expandTo: [
    "todo.view",
    "todo.create",
    "todo.edit",
    "todo.delete",
    "todo.complete",
  ] },
  { module: "首页", name: "设置", code: "tab.workbench", sortOrder: 121, expandTo: [] },
];

const EXPAND_MAP: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const d of PERMISSION_DEFINITIONS) {
    m.set(d.code, d.expandTo);
  }
  return m;
})();

/**
 * 将数据库中存的用户权限码展开为与接口 requirePermission(legacy) 等兼容的有效集合
 */
export function expandAssignedPermissionCodes(codes: Iterable<string>): Set<string> {
  const s = new Set(codes);
  for (const c of codes) {
    const to = EXPAND_MAP.get(c);
    if (to) for (const e of to) s.add(e);
  }
  return s;
}

/** 仅用于矩阵、员工勾选的行（不含历史遗留的纯细项码） */
export function isMatrixPermissionCode(code: string): boolean {
  return code.startsWith("tab.");
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  ADMIN: "管理员",
  SALES: "业务员",
  PURCHASE: "采购",
  MATERIAL: "物料员",
  OUTSOURCE: "外发管理员",
  WAREHOUSE: "仓管",
};

/** 各角色在「权限管理」矩阵中的默认勾选 */
export function defaultMatrixForRole(role: StaffRole): Set<string> {
  const all = new Set(PERMISSION_DEFINITIONS.map((p) => p.code));
  if (role === "ADMIN") return all;

  const sales = new Set([
    "tab.customer",
    "tab.prod.add",
    "tab.prod.inv",
    "tab.prod.adjust",
    "tab.prod.deprecated",
    "tab.sales.add",
    "tab.sales.undelivered",
    "tab.sales.query",
    "tab.sales.changeReminder",
    "tab.sample.add",
    "tab.sample.open",
    "tab.sample.query",
    "tab.stats.overview",
    "tab.stats.reconcile",
    "tab.home.sales",
    "tab.home.purchase",
    "tab.home.receiving",
    "tab.home.outsource",
    "tab.home.outsourceNeed",
    "tab.home.samples",
    "tab.home.prodStockAlert",
    "tab.home.todo",
    "tab.home.reconcileCustomer",
    "tab.home.reconcileSupplier",
  ]);
  const purchase = new Set([
    "tab.supplier",
    "tab.pur.add",
    "tab.pur.pcb",
    "tab.pur.open",
    "tab.pur.edit",
    "tab.pur.receive",
    "tab.pur.delete",
    "tab.pur.query",
    "tab.pur.settings",
    "tab.mat.inv",
    "tab.stats.overview",
    "tab.stats.reconcile",
    "tab.home.purchase",
    "tab.home.receiving",
    "tab.home.matStockAlert",
    "tab.home.todo",
    "tab.home.reconcileSupplier",
  ]);
  const material = new Set([
    "tab.mat.add",
    "tab.mat.inv",
    "tab.mat.customerSupply",
    "tab.mat.adjust",
    "tab.mat.deprecated",
    "tab.prod.add",
    "tab.prod.inv",
    "tab.prod.stockIn",
    "tab.prod.adjust",
    "tab.prod.deprecated",
    "tab.supplier",
    "tab.stats.overview",
    "tab.stats.reconcile",
    "tab.home.prodStockAlert",
    "tab.home.matStockAlert",
    "tab.home.todo",
  ]);
  const outsource = new Set([
    "tab.os.add",
    "tab.os.open",
    "tab.os.receive",
    "tab.os.query",
    "tab.os.stock",
    "tab.os.recovery",
    "tab.os.recoveryAdjust",
    "tab.os.settings",
    "tab.mat.inv",
    "tab.prod.inv",
    "tab.stats.overview",
    "tab.stats.reconcile",
    "tab.home.outsource",
    "tab.home.outsourceNeed",
    "tab.home.prodStockAlert",
    "tab.home.matStockAlert",
    "tab.home.todo",
  ]);
  const warehouse = new Set([
    "tab.wh.ship",
    "tab.wh.query",
    "tab.prod.stockIn",
    "tab.wh.settings",
    "tab.mat.inv",
    "tab.prod.inv",
    "tab.stats.overview",
    "tab.stats.reconcile",
    "tab.home.prodStockAlert",
    "tab.home.matStockAlert",
    "tab.home.todo",
    "tab.home.reconcileCustomer",
  ]);

  switch (role) {
    case "SALES":
      return sales;
    case "PURCHASE":
      return purchase;
    case "MATERIAL":
      return material;
    case "OUTSOURCE":
      return outsource;
    case "WAREHOUSE":
      return warehouse;
    default:
      return new Set();
  }
}
