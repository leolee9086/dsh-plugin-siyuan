import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { createActivityNavigation } from "../../lib/client-navigation.js";
import { createClientUI } from "../../lib/client-ui.js";

const { sourceCall, createRevealer } = createActivityNavigation();
const call = (callId, seq = 10) => ({ event: { type: "tool/call", seq, data: { callId } } });
const child = (subCallId, rootCallId, type = "tool/ptc-dispatch-start") => ({ event: { type, seq: 11, data: { subCallId, rootCallId } } });

test("来源定位保留精确子调用身份，历史加载从根调用序号开始", () => {
  assert.deepEqual(sourceCall([call("direct")], "direct"), { callId: "direct", rootCallId: "direct", seq: 10, rootLoaded: true });
  for (const type of ["tool/ptc-dispatch-start", "tool/ptc-dispatch"]) {
    assert.deepEqual(sourceCall([call("root", 5), child("sub", "root", type)], "sub"),
      { callId: "sub", rootCallId: "root", seq: 5, rootLoaded: true });
  }
  assert.equal(sourceCall([call("other")], "missing"), null);
});

function surface(t, callId = "sub") {
  const dom = new JSDOM('<div data-conversation-session="other" data-conversation-region="chat"></div><div data-conversation-session="session" data-conversation-region="chat"><div hidden="until-found"><div hidden="until-found"><div data-chat-call-id></div></div></div></div>');
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const roots = [...doc.querySelectorAll("[data-conversation-session]")];
  const card = doc.querySelector("[data-chat-call-id]"); card.setAttribute("data-chat-call-id", callId);
  const hidden = [...roots[1].querySelectorAll("[hidden]")]; const expanded = []; const scrolled = [];
  // jsdom 没有布局引擎；只替换几何读数，DOM 查询、事件和属性仍使用真实 DOM。
  for (const root of roots) root.getClientRects = () => [1];
  card.getClientRects = () => card.closest("[hidden]") ? [] : [1];
  card.getBoundingClientRect = () => ({ top: 20, bottom: 60 });
  card.scrollIntoView = () => scrolled.push(card.getAttribute("data-chat-call-id"));
  hidden.forEach((element, index) => element.addEventListener("beforematch", () => {
    expanded.push(index); element.removeAttribute("hidden");
  }));
  return { doc, roots, card, hidden, expanded, scrolled };
}

test("载入旧历史后从外向内展开，精确滚动到 PTC 子调用", async t => {
  const id = 'sub"[quoted]'; const view = surface(t, id); const loads = []; let shown = 0;
  let window = { entries: [], hasMore: true };
  const revealer = createRevealer({ sessionId: "session", getWindow: () => window, isCurrent: () => true,
    showChat: () => shown++, document: view.doc, loadThrough: async seq => {
      loads.push(seq); window = { entries: [call("root", 5), child(id, "root")], hasMore: false };
    } });
  t.after(() => revealer.dispose());
  assert.deepEqual(await revealer.reveal(id), { callId: id });
  assert.deepEqual(loads, [0, 5]); assert.equal(shown, 1);
  assert.deepEqual(view.expanded, [0, 1]); assert.deepEqual(view.scrolled, [id]);
});

test("子调用窗口缺少根调用时继续加载根历史", async t => {
  const view = surface(t); const loads = []; let entries = [child("sub", "root")];
  const revealer = createRevealer({ sessionId: "session", getWindow: () => ({ entries, hasMore: true }),
    isCurrent: () => true, showChat() {}, document: view.doc, loadThrough: async seq => {
      loads.push(seq); if (seq === 0) entries = [call("root", 5), ...entries];
    } });
  t.after(() => revealer.dispose());
  await revealer.reveal("sub"); assert.deepEqual(loads, [11, 0]); assert.deepEqual(view.scrolled, ["sub"]);
});

test("换会话与卸载使未完成历史加载失效，不向旧会话滚动", async t => {
  for (const stop of ["switch", "dispose"]) {
    const view = surface(t); let current = true; let finish;
    const revealer = createRevealer({ sessionId: "session", getWindow: () => ({ entries: [call("sub")], hasMore: false }),
      isCurrent: () => current, showChat() {}, document: view.doc, loadThrough: () => new Promise(resolve => { finish = resolve; }) });
    const pending = assert.rejects(revealer.reveal("sub"), /定位已取消/);
    if (stop === "switch") { current = false; revealer.cancel(); } else revealer.dispose();
    finish(); await pending; assert.deepEqual(view.scrolled, []); revealer.dispose();
  }
});

test("新定位取消旧请求，旧请求完成后不会抢走滚动位置", async t => {
  const view = surface(t); let finish; let loads = 0;
  const revealer = createRevealer({ sessionId: "session", getWindow: () => ({ entries: [call("sub")], hasMore: false }),
    isCurrent: () => true, showChat() {}, document: view.doc, loadThrough: () => ++loads === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve() });
  t.after(() => revealer.dispose());
  const old = assert.rejects(revealer.reveal("sub"), /定位已取消/);
  await revealer.reveal("sub"); finish(); await old;
  assert.deepEqual(view.scrolled, ["sub"]);
});

test("缺失调用和不支持展开的隐藏元素报告明确错误", async t => {
  const view = surface(t); view.hidden[0].setAttribute("hidden", "");
  const revealer = createRevealer({ sessionId: "session", getWindow: () => ({ entries: [call("sub")], hasMore: false }),
    isCurrent: () => true, showChat() {}, document: view.doc, loadThrough: async () => {} });
  t.after(() => revealer.dispose());
  await assert.rejects(revealer.reveal("missing"), /未找到/);
  await assert.rejects(revealer.reveal("sub"), /无法自动展开/);
  assert.deepEqual(view.scrolled, []);
});

test("卡片主按钮打开思源侧栏，参数展开独立，侧栏定位显示等待与完成", async () => {
  const dom = new JSDOM('<div id="app"></div>');
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("app"));
  const ui = createClientUI(React, { icon: "fixture.svg" }); let opened = 0;
  try {
    await act(async () => root.render(React.createElement(ui.ToolCall, { callId: "call", toolName: "siyuan_query", phase: "start",
      block: { argsRaw: '{"action":"notebooks"}' }, openActivity: () => opened++, inspect: () => assert.fail("不应打开轨迹") })));
    const buttons = [...dom.window.document.querySelectorAll("button")];
    await act(async () => buttons[0].click()); assert.equal(opened, 1);
    await act(async () => buttons[1].click()); assert.equal(opened, 1);
    assert.match(dom.window.document.body.textContent, /notebooks/);
    await act(async () => dom.window.document.querySelector("article").click()); assert.equal(opened, 2);
    let finish; const located = [];
    await act(async () => root.render(React.createElement(ui.ActivityView, { sessionId: "session", query: "", offset: 0,
      result: { sessionId: "session", pageOffset: 0, total: 1, items: [{ id: "op", callId: "call", tool: "siyuan_query", kernelName: "本机", time: "2026-10-12T12:00:00Z", status: "succeeded", endpoints: [], resources: [] }] },
      revealCall: callId => { located.push(callId); return new Promise(resolve => { finish = resolve; }); } })));
    const locate = [...dom.window.document.querySelectorAll("button")].find(button => button.textContent === "定位工具调用");
    await act(async () => locate.click()); assert.deepEqual(located, ["call"]); assert.equal(locate.disabled, true);
    assert.match(locate.textContent, /正在定位/);
    await act(async () => finish()); assert.match(dom.window.document.body.textContent, /已定位到对应工具调用/);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});

test("暂停核心跳过自动检查，人工检查只请求一次且保持提醒暂停", async () => {
  const dom = new JSDOM('<div id="app"></div>');
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById('app'));
  const state = { revision: 1, defaultKernelId: 'local', kernels: [{ id: 'local', name: 'fixture core',
    apiUrl: 'http://127.0.0.1:6806', enabled: true, timeoutMs: 1000, credential: { configured: true, writable: true },
    reminderPause: { reason: 'rate-limit', message: 'HTTP 429；Retry-After 30 秒；已暂停' } }] };
  let calls = 0, deny = false;
  const ui = createClientUI(React, { icon: 'fixture.svg',
    get: async () => structuredClone(state),
    post: async input => {
      assert.equal(input.action, 'test'); assert.equal(input.kernelId, 'local'); calls++;
      if (deny) throw new Error('HTTP 429；稍后再检查');
      return { version: 'fixture-version', apiUrl: state.kernels[0].apiUrl, accessAvailable: true, credentialSent: true };
    } });
  const click = async label => act(async () => {
    const button = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === label);
    assert.ok(button, label); button.click();
  });
  try {
    await act(async () => root.render(React.createElement(ui.Main)));
    assert.equal(calls, 0); assert.match(dom.window.document.body.textContent, /提醒已暂停/);
    await click('刷新'); assert.equal(calls, 0);
    await click('重新检查连接'); assert.equal(calls, 1);
    assert.match(dom.window.document.body.textContent, /访问可用.*已发送配置凭据/);
    assert.match(dom.window.document.body.textContent, /提醒已暂停/);
    deny = true; await click('重新检查连接'); assert.equal(calls, 2);
    assert.match(dom.window.document.body.textContent, /HTTP 429；稍后再检查/);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
