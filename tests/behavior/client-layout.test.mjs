import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { createClientUI } from "../../lib/client-ui.js";

// 使用生产领域入口和真实 React，只注入界面已有的网络端口。
async function mount(t, ports) {
  const dom = new JSDOM('<div id="app"></div>');
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("app"));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  });
  const ui = createClientUI(React, { icon: "fixture.svg", ...ports });
  await act(async () => root.render(React.createElement(ui.Main)));
  return { document: dom.window.document, click: async label => act(async () => {
    const button = [...dom.window.document.querySelectorAll("button")].find(item => item.getAttribute("aria-label") === label || item.textContent === label);
    assert.ok(button, label); button.click();
  }) };
}
const kernel = () => ({ id: "local", name: "本机思源", apiUrl: "auto", enabled: true, kernelPid: 100,
  credential: { configured: true, writable: true } });
const candidates = [{ pid: 200, apiUrl: "http://127.0.0.1:6806", version: "fixture-a" },
  { pid: 300, apiUrl: "http://127.0.0.1:6807", version: "fixture-b" }];

test("首次加载列出实例，旧PID失效仍可选择并刷新绑定", async t => {
  const state = { revision: 1, kernels: [kernel()], defaultKernelId: "local" }; const calls = [];
  const view = await mount(t, { get: async () => structuredClone(state), post: async input => {
    calls.push(input);
    if (input.action === "instances") return { instances: candidates };
    if (input.action === "selectInstance") { state.kernels[0].kernelPid = input.pid; return { selectedPid: input.pid }; }
    assert.equal(input.action, "test");
    if (state.kernels[0].kernelPid === 100) throw new Error("旧 PID 已退出，请选择本机实例");
    return { version: "fixture-b", apiUrl: candidates[1].apiUrl };
  } });
  assert.deepEqual(calls.map(item => item.action), ["instances", "test"]);
  assert.equal(view.document.querySelectorAll(".sy-instance").length, 2);
  assert.match(view.document.body.textContent, /旧 PID 已退出/);
  await view.click("连接 PID 300");
  assert.deepEqual(calls.find(item => item.action === "selectInstance"), { action: "selectInstance", kernelId: "local", pid: 300 });
  assert.match(view.document.querySelector('.sy-instance[data-selected="true"]').textContent, /PID 300/);
  assert.equal(view.document.querySelector('[aria-label="连接 PID 300"]').disabled, true);
  assert.match(view.document.body.textContent, /已连接/);
});

test("暂停本机核心不自动发现，人工刷新只列实例而不重复检查", async t => {
  const state = { kernels: [{ ...kernel(), reminderPause: { message: "HTTP 429，提醒已暂停" } }] }; const calls = [];
  const view = await mount(t, { get: async () => structuredClone(state), post: async input => {
    calls.push(input.action); assert.equal(input.action, "instances"); return { instances: candidates };
  } });
  assert.deepEqual(calls, []); await view.click("刷新"); assert.deepEqual(calls, []);
  await view.click("刷新实例列表"); assert.deepEqual(calls, ["instances"]);
  assert.equal(view.document.querySelectorAll(".sy-instance").length, 2);
  assert.match(view.document.body.textContent, /提醒已暂停/);
});

test("表单高级项和工具箱默认折叠，活动结果有独立状态与错误区域", () => {
  const ui = createClientUI(React, { icon: "fixture.svg" });
  const markup = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(ui.KernelForm, { kernel: kernel() }),
    React.createElement(ui.GatewayPanel, { gateway: { available: true, registered: 0, http: 663, mcp: 0 } }),
    React.createElement(ui.ActivityView, { sessionId: "s", offset: 0, query: "", result: { sessionId: "s", pageOffset: 0, total: 2,
      items: ["succeeded", "failed"].map((status, i) => ({ id: String(i), time: "2026-10-16T00:00:00+08:00", tool: "siyuan_query",
        kernelId: "local", status, endpoints: [], resources: [], error: i ? "连接超时" : undefined })) } })));
  const dom = new JSDOM(markup); const doc = dom.window.document;
  try {
    assert.equal(doc.querySelector(".sy-form details").open, false);
    assert.equal(doc.querySelector(".sy-form details input[type=number]") !== null, true);
    assert.equal(doc.querySelector(".sy-gateway").open, false);
    assert.equal(doc.querySelector(".sy-policy-note").open, false);
    assert.equal(doc.querySelectorAll(".sy-record").length, 2);
    assert.equal(doc.querySelectorAll('.sy-record .sy-badge[data-tone="success"]').length, 1);
    assert.equal(doc.querySelectorAll('.sy-record .sy-badge[data-tone="error"]').length, 1);
    assert.equal(doc.querySelector('.sy-record [role="alert"]').textContent, "连接超时");
  } finally { dom.window.close(); }
});
