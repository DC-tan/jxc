"use client";

import {
  App,
  AutoComplete,
  Button,
  Checkbox,
  Col,
  DatePicker,
  Empty,
  Input,
  List,
  Popconfirm,
  Row,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";

type TodoStatus = "TODO" | "DEFERRED" | "DONE";

type TodoRow = {
  id: string;
  serialNo: number;
  content: string;
  status: TodoStatus;
  createdAt: string;
  updatedAt: string;
};

const SPLIT_MIN = 0.2;
const SPLIT_MAX = 0.8;
const DEFAULT_ITEM_ROW_HEIGHT = 52;

function clampSplit(v: number) {
  return Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, v));
}

export function TodoBoard({ splitStorageKey }: { splitStorageKey: string }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<TodoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingPeriod, setDeletingPeriod] = useState(false);
  const [draft, setDraft] = useState("");
  const [activeTab, setActiveTab] = useState<"todo" | "done">("todo");
  const [doneKeyword, setDoneKeyword] = useState("");
  const [doneRange, setDoneRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [selectingTodo, setSelectingTodo] = useState(false);
  const [selectedTodoIds, setSelectedTodoIds] = useState<string[]>([]);
  const [batchTodoActing, setBatchTodoActing] = useState<null | "DEFERRED" | "DONE" | "DELETE">(null);
  const [selectingDeferred, setSelectingDeferred] = useState(false);
  const [selectedDeferredIds, setSelectedDeferredIds] = useState<string[]>([]);
  const [batchDeferredActing, setBatchDeferredActing] = useState<null | "TODO" | "DONE" | "DELETE">(null);

  const [split, setSplit] = useState<number>(() => {
    if (typeof window === "undefined") return 0.56;
    const raw = localStorage.getItem(splitStorageKey);
    if (!raw) return 0.56;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0.56;
    return clampSplit(n);
  });

  const boardRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const todoListAreaRef = useRef<HTMLDivElement>(null);
  const deferredListAreaRef = useRef<HTMLDivElement>(null);
  const [todoListAreaHeight, setTodoListAreaHeight] = useState(0);
  const [deferredListAreaHeight, setDeferredListAreaHeight] = useState(0);
  const [todoRowHeight, setTodoRowHeight] = useState(DEFAULT_ITEM_ROW_HEIGHT);
  const [deferredRowHeight, setDeferredRowHeight] = useState(DEFAULT_ITEM_ROW_HEIGHT);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(splitStorageKey, String(split));
  }, [split, splitStorageKey]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ list: TodoRow[] }>("/api/todos", {
        credentials: "include",
      });
      setRows(data.list ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载待办失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const el = boardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = (ev.clientY - rect.top) / rect.height;
      setSplit(clampSplit(ratio));
    };
    const onMouseUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    const measureTodo = () => {
      const area = todoListAreaRef.current;
      if (!area) return;
      setTodoListAreaHeight(area.clientHeight);
      const first = area.querySelector("[data-todo-item='todo']") as HTMLElement | null;
      if (first?.offsetHeight) setTodoRowHeight(first.offsetHeight);
    };
    const measureDeferred = () => {
      const area = deferredListAreaRef.current;
      if (!area) return;
      setDeferredListAreaHeight(area.clientHeight);
      const first = area.querySelector("[data-todo-item='deferred']") as HTMLElement | null;
      if (first?.offsetHeight) setDeferredRowHeight(first.offsetHeight);
    };
    measureTodo();
    measureDeferred();
    const rt = new ResizeObserver(measureTodo);
    const rd = new ResizeObserver(measureDeferred);
    if (todoListAreaRef.current) rt.observe(todoListAreaRef.current);
    if (deferredListAreaRef.current) rd.observe(deferredListAreaRef.current);
    return () => {
      rt.disconnect();
      rd.disconnect();
    };
  }, [split, rows.length, selectingTodo, selectingDeferred]);

  const createTodo = async () => {
    const content = draft.trim();
    if (!content) {
      message.warning("请先输入待办内容");
      return;
    }
    setSaving(true);
    try {
      const row = await fetchJson<TodoRow>("/api/todos", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setRows((prev) => [row, ...prev]);
      setDraft("");
      message.success("已加入待办");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "新增待办失败");
    } finally {
      setSaving(false);
    }
  };

  const toggleSelectId = (
    id: string,
    checked: boolean,
    setSelected: Dispatch<SetStateAction<string[]>>,
  ) => {
    setSelected((prev) => {
      if (checked) {
        if (prev.includes(id)) return prev;
        return [...prev, id];
      }
      return prev.filter((x) => x !== id);
    });
  };

  const updateStatus = async (id: string, status: TodoStatus) => {
    try {
      const row = await fetchJson<TodoRow>(`/api/todos/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setRows((prev) => prev.map((r) => (r.id === id ? row : r)));
      message.success("状态已更新");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "更新状态失败");
    }
  };

  const removeTodo = async (id: string) => {
    try {
      await fetchJson(`/api/todos/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      setRows((prev) => prev.filter((r) => r.id !== id));
      message.success("已删除");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  const applyBatchStatusForTodo = async (status: "DEFERRED" | "DONE") => {
    if (selectedTodoIds.length === 0) {
      message.warning("请先勾选待办事项");
      return;
    }
    setBatchTodoActing(status);
    try {
      const updates = await Promise.all(
        selectedTodoIds.map((id) =>
          fetchJson<TodoRow>(`/api/todos/${id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          }),
        ),
      );
      const byId = new Map(updates.map((u) => [u.id, u]));
      setRows((prev) => prev.map((r) => byId.get(r.id) ?? r));
      setSelectedTodoIds([]);
      setSelectingTodo(false);
      message.success(status === "DEFERRED" ? "已批量延期" : "已批量完成");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "批量操作失败");
    } finally {
      setBatchTodoActing(null);
    }
  };

  const removeBatchTodo = async () => {
    if (selectedTodoIds.length === 0) {
      message.warning("请先勾选待办事项");
      return;
    }
    setBatchTodoActing("DELETE");
    try {
      await Promise.all(
        selectedTodoIds.map((id) =>
          fetchJson(`/api/todos/${id}`, {
            method: "DELETE",
            credentials: "include",
          }),
        ),
      );
      const selectedSet = new Set(selectedTodoIds);
      setRows((prev) => prev.filter((r) => !selectedSet.has(r.id)));
      setSelectedTodoIds([]);
      setSelectingTodo(false);
      message.success("已批量删除");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "批量删除失败");
    } finally {
      setBatchTodoActing(null);
    }
  };

  const applyBatchStatusForDeferred = async (status: "TODO" | "DONE") => {
    if (selectedDeferredIds.length === 0) {
      message.warning("请先勾选延期事项");
      return;
    }
    setBatchDeferredActing(status);
    try {
      const updates = await Promise.all(
        selectedDeferredIds.map((id) =>
          fetchJson<TodoRow>(`/api/todos/${id}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          }),
        ),
      );
      const byId = new Map(updates.map((u) => [u.id, u]));
      setRows((prev) => prev.map((r) => byId.get(r.id) ?? r));
      setSelectedDeferredIds([]);
      setSelectingDeferred(false);
      message.success(status === "TODO" ? "已批量恢复待办" : "已批量完成");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "批量操作失败");
    } finally {
      setBatchDeferredActing(null);
    }
  };

  const removeBatchDeferred = async () => {
    if (selectedDeferredIds.length === 0) {
      message.warning("请先勾选延期事项");
      return;
    }
    setBatchDeferredActing("DELETE");
    try {
      await Promise.all(
        selectedDeferredIds.map((id) =>
          fetchJson(`/api/todos/${id}`, {
            method: "DELETE",
            credentials: "include",
          }),
        ),
      );
      const selectedSet = new Set(selectedDeferredIds);
      setRows((prev) => prev.filter((r) => !selectedSet.has(r.id)));
      setSelectedDeferredIds([]);
      setSelectingDeferred(false);
      message.success("已批量删除");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "批量删除失败");
    } finally {
      setBatchDeferredActing(null);
    }
  };

  const todoRows = useMemo(
    () =>
      rows
        .filter((r) => r.status === "TODO")
        .sort((a, b) => dayjs(a.updatedAt).valueOf() - dayjs(b.updatedAt).valueOf()),
    [rows],
  );
  const deferredRows = useMemo(
    () =>
      rows
        .filter((r) => r.status === "DEFERRED")
        .sort((a, b) => dayjs(a.updatedAt).valueOf() - dayjs(b.updatedAt).valueOf()),
    [rows],
  );
  const doneRows = useMemo(
    () =>
      rows
        .filter((r) => r.status === "DONE")
        .sort((a, b) => dayjs(a.updatedAt).valueOf() - dayjs(b.updatedAt).valueOf()),
    [rows],
  );
  const doneFilteredRows = useMemo(() => {
    const kw = doneKeyword.trim().toLowerCase();
    if (!kw) return doneRows;
    return doneRows.filter((r) => r.content.toLowerCase().includes(kw));
  }, [doneRows, doneKeyword]);
  const todoRowsPerColumn = useMemo(() => {
    if (todoListAreaHeight <= 0) return 1;
    return Math.max(1, Math.floor(todoListAreaHeight / Math.max(1, todoRowHeight)));
  }, [todoListAreaHeight, todoRowHeight]);
  const deferredRowsPerColumn = useMemo(() => {
    if (deferredListAreaHeight <= 0) return 1;
    return Math.max(
      1,
      Math.floor(deferredListAreaHeight / Math.max(1, deferredRowHeight)),
    );
  }, [deferredListAreaHeight, deferredRowHeight]);
  const todoLeftRows = useMemo(
    () => todoRows.slice(0, todoRowsPerColumn),
    [todoRows, todoRowsPerColumn],
  );
  const todoRightRows = useMemo(
    () => todoRows.slice(todoRowsPerColumn),
    [todoRows, todoRowsPerColumn],
  );
  const deferredLeftRows = useMemo(
    () => deferredRows.slice(0, deferredRowsPerColumn),
    [deferredRows, deferredRowsPerColumn],
  );
  const deferredRightRows = useMemo(
    () => deferredRows.slice(deferredRowsPerColumn),
    [deferredRows, deferredRowsPerColumn],
  );
  const doneLeftRows = useMemo(
    () => doneFilteredRows.slice(0, 8),
    [doneFilteredRows],
  );
  const doneRightRows = useMemo(
    () => doneFilteredRows.slice(8),
    [doneFilteredRows],
  );
  const doneKeywordOptions = useMemo(() => {
    const uniq = Array.from(new Set(doneRows.map((r) => r.content.trim()).filter(Boolean)));
    const kw = doneKeyword.trim().toLowerCase();
    return uniq
      .filter((v) => !kw || v.toLowerCase().includes(kw))
      .slice(0, 20)
      .map((v) => ({ value: v, label: v }));
  }, [doneRows, doneKeyword]);

  const todoSeqById = useMemo(
    () => new Map(todoRows.map((r, i) => [r.id, i + 1])),
    [todoRows],
  );
  const deferredSeqById = useMemo(
    () => new Map(deferredRows.map((r, i) => [r.id, i + 1])),
    [deferredRows],
  );
  const doneSeqById = useMemo(
    () => new Map(doneRows.map((r, i) => [r.id, i + 1])),
    [doneRows],
  );

  const boardHeight = "min(68vh, 720px)";
  const topPaneHeight = `calc(${Math.round(split * 100)}% - 4px)`;
  const bottomPaneHeight = `calc(${Math.round((1 - split) * 100)}% - 4px)`;

  const deleteDoneByPeriod = async () => {
    if (!doneRange) {
      message.warning("请先选择完成时间范围");
      return;
    }
    setDeletingPeriod(true);
    try {
      const from = doneRange[0].startOf("day").toISOString();
      const to = doneRange[1].endOf("day").toISOString();
      const data = await fetchJson<{ ok: true; deletedCount: number }>(
        `/api/todos?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      if (data.deletedCount > 0) {
        setRows((prev) =>
          prev.filter((r) => {
            if (r.status !== "DONE") return true;
            const t = dayjs(r.updatedAt).valueOf();
            return t < doneRange[0].startOf("day").valueOf() || t > doneRange[1].endOf("day").valueOf();
          }),
        );
      }
      message.success(`已删除 ${data.deletedCount} 条已完成事项`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeletingPeriod(false);
    }
  };

  const renderItemTitle = (
    item: TodoRow,
    timeLabel: string,
    timeValue: string,
    seq: number,
    selection?: {
      selecting: boolean;
      selected: boolean;
      onToggle: (checked: boolean) => void;
    },
  ) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        width: "100%",
      }}
    >
      <Space size={8} style={{ flex: 1, minWidth: 0 }}>
        {selection?.selecting ? (
          <Checkbox
            checked={selection.selected}
            onChange={(e) => selection.onToggle(e.target.checked)}
          />
        ) : null}
        <Typography.Text style={{ minWidth: 0 }}>
          {seq}、{item.content}
        </Typography.Text>
      </Space>
      <Typography.Text type="secondary" style={{ whiteSpace: "nowrap" }}>
        {timeLabel} {dayjs(timeValue).format("YYYY-MM-DD HH:mm")}
      </Typography.Text>
    </div>
  );

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 10 }}>
        待办 TAB 中上半区是近期待办、下半区是延期事项（分界线可拖动）；已完成 TAB 可搜索与按完成时间段批量清理。
      </Typography.Paragraph>
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as "todo" | "done")}
        items={[
          {
            key: "todo",
            label: `待办（${todoRows.length + deferredRows.length}）`,
            children: loading ? (
              <div style={{ padding: 80, textAlign: "center" }}>
                <Spin />
              </div>
            ) : (
              <div>
                <Space.Compact style={{ width: "100%", marginBottom: 12 }}>
                  <Input
                    value={draft}
                    maxLength={500}
                    placeholder="输入要做的事项，回车快速添加"
                    onChange={(e) => setDraft(e.target.value)}
                    onPressEnter={() => void createTodo()}
                  />
                  <Button type="primary" loading={saving} onClick={() => void createTodo()}>
                    添加
                  </Button>
                </Space.Compact>
                <div
                  ref={boardRef}
                  style={{
                    height: boardHeight,
                    border: "1px solid #f0f0f0",
                    borderRadius: 8,
                    overflow: "hidden",
                    background: "#fff",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      height: topPaneHeight,
                      minHeight: 120,
                      padding: 12,
                      display: "flex",
                      flexDirection: "column",
                      minWidth: 0,
                    }}
                  >
                    <Space style={{ marginBottom: 8 }}>
                      <Typography.Text strong>待办中</Typography.Text>
                      <Tag color="blue">{todoRows.length}</Tag>
                      <Button
                        size="small"
                        onClick={() => {
                          setSelectingTodo((v) => !v);
                          setSelectedTodoIds([]);
                        }}
                      >
                        {selectingTodo ? "取消选择" : "选择"}
                      </Button>
                      {selectingTodo ? (
                        <>
                          <Button
                            size="small"
                            loading={batchTodoActing === "DEFERRED"}
                            onClick={() => void applyBatchStatusForTodo("DEFERRED")}
                          >
                            延期
                          </Button>
                          <Button
                            size="small"
                            type="primary"
                            loading={batchTodoActing === "DONE"}
                            onClick={() => void applyBatchStatusForTodo("DONE")}
                          >
                            完成
                          </Button>
                          <Popconfirm
                            title="确认删除已勾选事项？"
                            onConfirm={() => void removeBatchTodo()}
                          >
                            <Button
                              size="small"
                              danger
                              loading={batchTodoActing === "DELETE"}
                            >
                              删除
                            </Button>
                          </Popconfirm>
                        </>
                      ) : null}
                    </Space>
                    {todoRows.length === 0 ? (
                      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Empty description="暂无待办事项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      </div>
                    ) : (
                      <div ref={todoListAreaRef} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                      <Row gutter={20}>
                        <Col span={12}>
                          <List
                            dataSource={todoLeftRows}
                            renderItem={(item) => (
                              <List.Item data-todo-item="todo">
                                <List.Item.Meta
                                  title={renderItemTitle(
                                    item,
                                    "创建于",
                                    item.createdAt,
                                    todoSeqById.get(item.id) ?? 0,
                                    {
                                      selecting: selectingTodo,
                                      selected: selectedTodoIds.includes(item.id),
                                      onToggle: (checked) =>
                                        toggleSelectId(item.id, checked, setSelectedTodoIds),
                                    },
                                  )}
                                />
                              </List.Item>
                            )}
                          />
                        </Col>
                        <Col span={12} style={{ borderLeft: "1px solid #f0f0f0", paddingLeft: 14 }}>
                          <List
                            dataSource={todoRightRows}
                            renderItem={(item) => (
                              <List.Item data-todo-item="todo">
                                <List.Item.Meta
                                  title={renderItemTitle(
                                    item,
                                    "创建于",
                                    item.createdAt,
                                    todoSeqById.get(item.id) ?? 0,
                                    {
                                      selecting: selectingTodo,
                                      selected: selectedTodoIds.includes(item.id),
                                      onToggle: (checked) =>
                                        toggleSelectId(item.id, checked, setSelectedTodoIds),
                                    },
                                  )}
                                />
                              </List.Item>
                            )}
                          />
                        </Col>
                      </Row>
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      height: 8,
                      cursor: "row-resize",
                      background: "#f5f5f5",
                      borderTop: "1px solid #eee",
                      borderBottom: "1px solid #eee",
                    }}
                    onMouseDown={() => {
                      draggingRef.current = true;
                    }}
                  />

                  <div
                    style={{
                      height: bottomPaneHeight,
                      minHeight: 120,
                      padding: 12,
                      display: "flex",
                      flexDirection: "column",
                      minWidth: 0,
                    }}
                  >
                    <Space style={{ marginBottom: 8 }}>
                      <Typography.Text strong>已延期</Typography.Text>
                      <Tag color="orange">{deferredRows.length}</Tag>
                      <Button
                        size="small"
                        onClick={() => {
                          setSelectingDeferred((v) => !v);
                          setSelectedDeferredIds([]);
                        }}
                      >
                        {selectingDeferred ? "取消选择" : "选择"}
                      </Button>
                      {selectingDeferred ? (
                        <>
                          <Button
                            size="small"
                            loading={batchDeferredActing === "TODO"}
                            onClick={() => void applyBatchStatusForDeferred("TODO")}
                          >
                            恢复
                          </Button>
                          <Button
                            size="small"
                            type="primary"
                            loading={batchDeferredActing === "DONE"}
                            onClick={() => void applyBatchStatusForDeferred("DONE")}
                          >
                            完成
                          </Button>
                          <Popconfirm
                            title="确认删除已勾选延期事项？"
                            onConfirm={() => void removeBatchDeferred()}
                          >
                            <Button
                              size="small"
                              danger
                              loading={batchDeferredActing === "DELETE"}
                            >
                              删除
                            </Button>
                          </Popconfirm>
                        </>
                      ) : null}
                    </Space>
                    {deferredRows.length === 0 ? (
                      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Empty description="暂无延期事项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      </div>
                    ) : (
                      <div ref={deferredListAreaRef} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                      <Row gutter={20}>
                        <Col span={12}>
                          <List
                            dataSource={deferredLeftRows}
                            renderItem={(item) => (
                              <List.Item data-todo-item="deferred">
                                <List.Item.Meta
                                  title={renderItemTitle(
                                    item,
                                    "更新于",
                                    item.updatedAt,
                                    deferredSeqById.get(item.id) ?? 0,
                                    {
                                      selecting: selectingDeferred,
                                      selected: selectedDeferredIds.includes(item.id),
                                      onToggle: (checked) =>
                                        toggleSelectId(item.id, checked, setSelectedDeferredIds),
                                    },
                                  )}
                                />
                              </List.Item>
                            )}
                          />
                        </Col>
                        <Col span={12} style={{ borderLeft: "1px solid #f0f0f0", paddingLeft: 14 }}>
                          <List
                            dataSource={deferredRightRows}
                            renderItem={(item) => (
                              <List.Item data-todo-item="deferred">
                                <List.Item.Meta
                                  title={renderItemTitle(
                                    item,
                                    "更新于",
                                    item.updatedAt,
                                    deferredSeqById.get(item.id) ?? 0,
                                    {
                                      selecting: selectingDeferred,
                                      selected: selectedDeferredIds.includes(item.id),
                                      onToggle: (checked) =>
                                        toggleSelectId(item.id, checked, setSelectedDeferredIds),
                                    },
                                  )}
                                />
                              </List.Item>
                            )}
                          />
                        </Col>
                      </Row>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ),
          },
          {
            key: "done",
            label: `已完成（${doneRows.length}）`,
            children: loading ? (
              <div style={{ padding: 80, textAlign: "center" }}>
                <Spin />
              </div>
            ) : (
              <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 12 }}>
                <Space wrap style={{ marginBottom: 10 }}>
                  <AutoComplete
                    value={doneKeyword}
                    style={{ width: 320 }}
                    options={doneKeywordOptions}
                    onChange={setDoneKeyword}
                  >
                    <Input allowClear placeholder="搜索已完成事项（支持联想）" />
                  </AutoComplete>
                  <DatePicker.RangePicker
                    value={doneRange}
                    onChange={(v) => {
                      if (!v || !v[0] || !v[1]) {
                        setDoneRange(null);
                        return;
                      }
                      setDoneRange([v[0], v[1]]);
                    }}
                    placeholder={["完成开始日期", "完成结束日期"]}
                  />
                  <Popconfirm
                    title="确认删除该时间段内全部“已完成”事项？"
                    onConfirm={() => void deleteDoneByPeriod()}
                    disabled={!doneRange}
                  >
                    <Button danger loading={deletingPeriod} disabled={!doneRange}>
                      一键删除时间段
                    </Button>
                  </Popconfirm>
                </Space>
                {doneFilteredRows.length === 0 ? (
                  <Empty description="暂无已完成事项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <Row gutter={20}>
                    <Col span={12}>
                      <List
                        dataSource={doneLeftRows}
                        renderItem={(item) => (
                          <List.Item
                            actions={[
                              <Button key="resume" type="link" size="small" onClick={() => void updateStatus(item.id, "TODO")}>
                                恢复待办
                              </Button>,
                              <Popconfirm
                                key="del"
                                title="确认删除这条已完成事项？"
                                onConfirm={() => void removeTodo(item.id)}
                              >
                                <Button type="link" danger size="small">
                                  删除
                                </Button>
                              </Popconfirm>,
                            ]}
                          >
                            <List.Item.Meta
                              title={renderItemTitle(
                                item,
                                "完成于",
                                item.updatedAt,
                                doneSeqById.get(item.id) ?? 0,
                              )}
                            />
                          </List.Item>
                        )}
                      />
                    </Col>
                    <Col span={12} style={{ borderLeft: "1px solid #f0f0f0", paddingLeft: 14 }}>
                      <List
                        dataSource={doneRightRows}
                        renderItem={(item) => (
                          <List.Item
                            actions={[
                              <Button key="resume" type="link" size="small" onClick={() => void updateStatus(item.id, "TODO")}>
                                恢复待办
                              </Button>,
                              <Popconfirm
                                key="del"
                                title="确认删除这条已完成事项？"
                                onConfirm={() => void removeTodo(item.id)}
                              >
                                <Button type="link" danger size="small">
                                  删除
                                </Button>
                              </Popconfirm>,
                            ]}
                          >
                            <List.Item.Meta
                              title={renderItemTitle(
                                item,
                                "完成于",
                                item.updatedAt,
                                doneSeqById.get(item.id) ?? 0,
                              )}
                            />
                          </List.Item>
                        )}
                      />
                    </Col>
                  </Row>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
