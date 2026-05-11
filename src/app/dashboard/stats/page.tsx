import { Spin } from "antd";
import { Suspense } from "react";
import { StatsPage } from "./StatsPage";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 80, textAlign: "center" }}>
          <Spin size="large" />
        </div>
      }
    >
      <StatsPage />
    </Suspense>
  );
}
