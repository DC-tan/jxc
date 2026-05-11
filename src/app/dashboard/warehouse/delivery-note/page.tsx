import { Spin } from "antd";
import { Suspense } from "react";
import { DeliveryNotePrintPage } from "./DeliveryNotePrintPage";

export default function Page() {
  return (
    <Suspense
      fallback={<Spin size="large" style={{ display: "block", margin: "40px 0" }} />}
    >
      <DeliveryNotePrintPage />
    </Suspense>
  );
}
