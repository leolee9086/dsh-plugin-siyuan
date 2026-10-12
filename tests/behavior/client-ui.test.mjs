import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClientUI } from "../../lib/client-ui.js";

// 通过领域入口取得组件，使用真实 React；无 ModuleLoader、插槽、ctx 或 Hook 替换。
const ui = createClientUI(React, { icon: "data:image/svg+xml;base64,PHN2Zy8+" });
const render = (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, props));
const config = { revision: 1, defaultKernelId: "local", kernels: [{ id: "local", name: "本机思源", apiUrl: "auto", enabled: true,
  credential: { configured: true, writable: true } }] };

test("主面板和无会话活动显示各自初始状态", () => {
  assert.match(render(ui.Main), /正在读取思源配置/);
  assert.match(render(ui.Activity), /请打开一个会话/);
});

test("工具卡片区分准备、执行和失败，不把协议错误标为成功", () => {
  const props = { callId: "call-1", toolName: "siyuan_query" };
  assert.match(render(ui.ToolCall, { ...props, phase: "preparing", block: {} }), /准备参数/);
  assert.match(render(ui.ToolCall, { ...props, phase: "start", block: { argsRaw: "{}" } }), /执行中/);
  assert.match(render(ui.ToolCall, { ...props, phase: "result", block: { isError: true, content: [], call: null } }), /调用失败/);
  assert.match(render(ui.ToolCall, { ...props, phase: "result", block: { isError: false, content: [], call: null } }), /已返回/);
});

test("核心表单从明确 props 显示编辑值，密码框从不回填", () => {
  const markup = render(ui.KernelForm, { kernel: config.kernels[0], busy: false });
  assert.match(markup, /value="本机思源"/); assert.match(markup, /已配置；留空保留/);
  assert.match(markup, /type="password"/); assert.doesNotMatch(markup, /type="password"[^>]*value=/);
});

test("端点面板用 props 展示搜索过滤、分页和授权确认目标", () => {
  const item = { key: "http-example", protocol: "http", method: "POST", path: "/api/notebook/lsNotebooks", detail: "", description: "笔记本", decision: "deny" };
  const markup = render(ui.EndpointPanel, { state: config, kernelId: "local", busy: false,
    filter: { query: "notebook", protocol: "http", method: "POST", decision: "deny", offset: 0 },
    catalog: { total: 698, offset: 0, limit: 40, items: [item] }, pending: { kernelId: "local", item, decision: "ask" } });
  for (const text of ["搜索端点", "过滤协议", "过滤方法", "过滤授权状态", "下一页", "698", "/api/notebook/lsNotebooks", "每次询问，完全权限下拒绝（默认）", "每次询问，完全权限下授权", "本机思源"]) assert.ok(markup.includes(text), text);
});

test("活动展示明确的会话与页码，旧会话或旧页数据不进入视图", () => {
  const result = { sessionId: "session-1", pageOffset: 0, total: 1, sessionKernelId: null, selectedKernelId: "local", items: [{
    id: "operation-1", sessionId: "session-1", callId: "call-1", time: "2026-10-11T15:10:00Z", tool: "siyuan_query", kernelId: "local",
    kernelName: "本机思源", status: "succeeded", target: "http://127.0.0.1:9999", resources: ["20261011180001-abcdefg"],
    authorization: [{ endpointKey: "endpoint", decision: "allow", outcome: "endpoint-allowed" }],
    endpoints: [{ key: "endpoint", protocol: "http", method: "POST", path: "/api/block/getBlockKramdown", detail: "" }],
  }] };
  const props = { sessionId: "session-1", result, state: config, query: "", offset: 0,
    permission: "danger-full-access", openManagement() {}, revealCall() {} };
  const markup = render(ui.ActivityView, props);
  assert.match(markup, /call-1/); assert.match(markup, /operation-1/); assert.match(markup, /成功/); assert.match(markup, /siyuan:\/\/blocks\//);
  for (const text of ["完全文件权限", "端点允许 · 自动通过", "思源连接管理界面", "定位工具调用"]) assert.ok(markup.includes(text), text);
  const rejected = structuredClone(result);
  rejected.items[0].authorization[0].outcome = "policy-never";
  assert.match(render(ui.ActivityView, { ...props, result: rejected }), /宿主 never 策略 · 自动拒绝/);
  for (const [decision, outcome, text] of [["ask", "full-access-denied", "完全权限 · 按端点配置自动拒绝"], ["ask-full-access", "full-access-allowed", "完全权限 · 按端点配置自动通过"]]) {
    rejected.items[0].authorization[0] = { endpointKey: "endpoint", decision, outcome };
    assert.ok(render(ui.ActivityView, { ...props, result: rejected }).includes(text));
  }
  for (const change of [{ sessionId: "session-2" }, { offset: 50 }, { query: "no-match" }]) {
    assert.doesNotMatch(render(ui.ActivityView, { ...props, ...change }), /call-1|operation-1/);
  }
});
