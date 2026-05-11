"use client";

import { SearchOutlined } from "@ant-design/icons";
import { AutoComplete, Input, Spin, Typography } from "antd";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DefaultOptionType } from "antd/es/select";
import type { GlobalSearchItem } from "@/lib/global-search";

const KIND_LABEL: Record<string, string> = {
  customer: "客户",
  supplier: "供应商",
  material: "物料",
  product: "商品",
  salesOrder: "销售",
  purchaseOrder: "采购",
  outsourceOrder: "外发",
  employee: "员工",
};

type Opt = DefaultOptionType & { href?: string };

function buildOptions(items: GlobalSearchItem[]): Opt[] {
  return items.map((r) => {
    const value = `${r.kind}::${r.id}`;
    return {
      value,
      href: r.href,
      label: (
        <div style={{ padding: "2px 0" }}>
          <div>
            <Typography.Text strong style={{ fontSize: 14 }}>
              {r.title}
            </Typography.Text>
            <Typography.Text
              type="secondary"
              style={{ marginLeft: 8, fontSize: 12 }}
            >
              {KIND_LABEL[r.kind] ?? r.kind}
            </Typography.Text>
          </div>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, display: "block", lineHeight: 1.4 }}
            ellipsis
          >
            {r.subtitle}
          </Typography.Text>
        </div>
      ),
    };
  });
}

export function GlobalSearch() {
  const router = useRouter();
  const [inputValue, setInputValue] = useState("");
  const [options, setOptions] = useState<Opt[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFetch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setOptions([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        setOptions([]);
        return;
      }
      const data = (await res.json()) as { results: GlobalSearchItem[] };
      setOptions(buildOptions(data.results ?? []));
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const onInputChange = useCallback(
    (text: string) => {
      setInputValue(text);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void doFetch(text), 300);
    },
    [doFetch],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <AutoComplete
      className="global-search"
      style={{ width: "100%", maxWidth: 440 }}
      value={inputValue}
      options={options}
      onChange={onInputChange}
      onSelect={(_value, option) => {
        const href = (option as Opt).href;
        if (typeof href === "string" && href) {
          setInputValue("");
          router.push(href);
        }
      }}
      notFoundContent={
        loading ? <Spin size="small" style={{ display: "block", padding: 8 }} /> : "无匹配结果"
      }
    >
      <Input
        allowClear
        size="middle"
        placeholder="全局搜索：客户、供应商、物料、商品、销售/采购单、外发单、员工…"
        prefix={<SearchOutlined style={{ color: "rgba(0,0,0,0.45)" }} />}
        aria-label="全局搜索"
      />
    </AutoComplete>
  );
}
