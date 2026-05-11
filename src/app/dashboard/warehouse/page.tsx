import { Spin } from "antd";
import { Suspense } from "react";
import { WarehousePage } from "./WarehousePage";

export default function Page() {
  return (
    <Suspense
      fallback={<Spin size="large" style={{ display: "block", margin: "40px 0" }} />}
    >
      <WarehousePage />
    </Suspense>
  );
}
