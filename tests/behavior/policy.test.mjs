import test from "node:test";
import assert from "node:assert/strict";
import { EndpointPolicy as policy } from "../../lib/policy.js";
import { SiYuanConnection } from "../../lib/connection.js";

const notebook = policy.endpoint("http", "POST", "/api/notebook/lsNotebooks");
const grant = (item, decision = "allow", kernelId = "local") => ({ kernelId, endpointKey: item.key, decision });

test("CRUD 和原始 HTTP 识别为同一授权端点，识别不联网", async () => {
  const connection = new SiYuanConnection({});
  try {
    const crud = await policy.identify("siyuan_query", { action: "notebooks" });
    const http = await policy.identify("siyuan_rpc", { channel: "http", path: notebook.path }, (method, path) => connection.http.describe(method, path));
    assert.equal(crud[0].key, notebook.key); assert.equal(http[0].key, notebook.key);
  } finally { await connection.dispose(); }
});

test("授权默认拒绝且不跨核心，允许只覆盖指定端点", async () => {
  await assert.rejects(policy.authorize([notebook], [], "local"), /未授权/);
  await assert.rejects(policy.authorize([notebook], [grant(notebook)], "other"), /未授权/);
  await policy.authorize([notebook], [grant(notebook)], "local");
  await assert.rejects(policy.authorize([policy.endpoint("http", "POST", "/api/query/sql")], [grant(notebook)], "local"), /未授权/);
});

test("MCP 外层授权不包含子工具，原始包裹与歧义路径拒绝", async () => {
  const items = await policy.identify("siyuan_rpc", { channel: "mcp", method: "tools/call", params: { name: "echo" } });
  assert.equal(items.length, 2); assert.equal(items[1].detail, "echo");
  await assert.rejects(policy.authorize(items, [grant(items[0])], "local"), /未授权/);
  await policy.authorize(items, items.map(item => grant(item)), "local");
  for (const path of ["/mcp", "/api/plugin/rpc", "/ws"]) {
    await assert.rejects(policy.identify("siyuan_rpc", { channel: "http", path }), /对应的/);
  }
  for (const path of ["/%6dcp", "/api/../mcp", "//other.invalid/mcp"]) assert.throws(() => policy.cleanPath(path));
});

test("插件批量必须同时授权外层和每个子方法", async () => {
  const items = await policy.identify("siyuan_rpc", { channel: "plugin", plugin: "demo", calls: [{ method: "echo" }, { method: "delete" }] });
  assert.deepEqual(items.map(item => item.method), ["$batch", "echo", "delete"]);
  await assert.rejects(policy.authorize(items, items.slice(0, 2).map(item => grant(item)), "local"), /delete/);
  await policy.authorize(items, items.map(item => grant(item)), "local");
});

test("每次批准对缺失、拒绝、取消均失败，仅 allowed-once 放行", async () => {
  const grants = [grant(notebook, "ask")];
  await assert.rejects(policy.authorize([notebook], grants, "local"), /unavailable/);
  for (const outcome of ["rejected", "cancelled", "unavailable"]) {
    await assert.rejects(policy.authorize([notebook], grants, "local", async () => outcome), new RegExp(outcome));
  }
  const approved = [];
  await policy.authorize([notebook], grants, "local", async item => { approved.push(item.key); return "allowed-once"; });
  assert.deepEqual(approved, [notebook.key]);
});

test("WS 连接和每个 cmd 分别识别，不透明与二进制消息拒绝", async () => {
  const items = await policy.identify("siyuan_rpc", { channel: "ws", path: "/ws?app=test", messages: ['{"cmd":"echo"}'] });
  assert.deepEqual(items.map(item => [item.method, item.detail]), [["connect", ""], ["send", "echo"]]);
  for (const message of ["opaque", '{}', { binary: true }]) await assert.rejects(policy.identify("siyuan_rpc", { channel: "ws", path: "/ws", messages: [message] }));
  await assert.rejects(policy.identify("siyuan_rpc", { channel: "http", path: notebook.path, headers: { Authorization: "fixture" } }), /认证头/);
});

test("查询、协议方法权限过滤和分页直接计算，不隐式授权发现端点", () => {
  const items = Array.from({ length: 697 }, (_, i) => policy.endpoint("http", "POST", `/api/example/${i}`));
  const echo = policy.endpoint("mcp", "tools/call", "", "echo", "远端工具"); items.push(echo);
  const result = policy.filterEndpoints(items, [], "local", { protocol: "mcp", query: "ECHO 远端", decision: "deny", limit: 1 });
  assert.equal(result.total, 1); assert.equal(result.items[0].key, echo.key); assert.equal(result.items[0].decision, "deny");
  const page = policy.filterEndpoints(items, [grant(items[696])], "local", { method: "POST", decision: "allow" });
  assert.equal(page.total, 1); assert.equal(page.items[0].path, "/api/example/696");
  const other = policy.filterEndpoints(items, [grant(echo)], "other", { protocol: "mcp" });
  assert.equal(other.items[0].decision, "deny");
  const tail = policy.filterEndpoints(items, [], "local", { protocol: "http", offset: 695, limit: 1 });
  assert.equal(tail.total, 697); assert.equal(tail.items[0].path, "/api/example/695");
});
