import test from "node:test";
import assert from "node:assert/strict";
import { KernelManager, managedTools } from "../lib/manager.js";
import { SiYuanConnection } from "../lib/connection.js";
import { createTools } from "../lib/host.js";
import { fixture, docId } from "./fixture.mjs";

// 隔离领域存储端口，仅保存本测试产生的配置和活动，不装配或模拟宿主上下文。
function memoryDomain() {
  const tables = new Map();
  return { table(name) {
    if (!tables.has(name)) tables.set(name, new Map());
    const values = tables.get(name);
    return { get: key => structuredClone(values.get(key)), put: async (key, value) => { values.set(key, structuredClone(value)); }, entries: () => values.entries() };
  }, async close() {} };
}

test("全量发布经真实协议运行，复用管理器的授权、目标和活动；发现schema及注册选择可恢复", async t => {
  const server = await fixture(); t.after(() => server.close());
  const domain = memoryDomain(); const tools = new Map();
  const manager = new KernelManager(domain, {
    async resolve() {}, async describe() { return { configured: false, writable: true }; }, async set() {}, async unset() {},
  }, (connection, name, args, exec) => createTools(connection).find(tool => tool.name === name).execute(args, exec),
  async () => "rejected");
  t.after(() => manager.close());
  await manager.initialize({ apiUrl: server.apiUrl, timeoutMs: 3000 });
  const templates = new SiYuanConnection({});
  managedTools(manager, createTools(templates)); await templates.dispose();
  const port = {
    registerGroup: () => ({ add() {}, remove() {}, dispose() {} }),
    registerTool(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); },
  };
  await assert.rejects(manager.registerGateway(true), /工具箱/);
  const detach = manager.attachGateway(port);
  await manager.inspectConnection("local", true);
  assert.deepEqual(domain.table("config").get("state").endpoints[0].inputSchema, { type: "object", additionalProperties: true });
  assert.equal((await manager.registerGateway(true)).registered, 664);
  const lookup = text => [...tools.values()].find(tool => tool.description.includes(text));
  const exec = { callId: "published-http", agent: { session: { id: "gateway-test" } } };
  const sql = lookup("POST /api/query/sql；");
  const before = server.requests.length;
  await assert.rejects(sql.execute({ body: { stmt: "select 1" } }, exec), /未获批准/);
  assert.equal(server.requests.length, before);
  const sqlEndpoint = manager.endpoints("local", { query: "/api/query/sql" }).items[0];
  await manager.grant("local", sqlEndpoint.key, "allow");
  assert.deepEqual(JSON.parse((await sql.execute({ body: { stmt: "select 1" } }, exec)).summary), [{ id: docId }]);
  const record = manager.activities("gateway-test").items.find(item => item.status === "succeeded");
  assert.equal(record.callId, exec.callId); assert.equal(record.tool, sql.name); assert.equal(record.kernelId, "local");
  assert.equal(record.authorization[0].outcome, "endpoint-allowed");
  const upload = lookup("POST /api/file/putFile；");
  await manager.grant("local", manager.endpoints("local", { query: "/api/file/putFile" }).items[0].key, "allow");
  await upload.execute({ body: { path: "/data/example.txt", file: "example.txt" }, files: [{ field: "file", name: "example.txt", base64: "aGk=" }] }, exec);
  const sentFile = server.requests.findLast(request => request.path === "/api/file/putFile");
  const form = await new Response(sentFile.bytes, { headers: { "content-type": sentFile.headers["content-type"] } }).formData();
  assert.equal(form.getAll("file").length, 1); assert.equal(await form.get("file").text(), "hi");
  const echo = lookup("思源 MCP echo");
  const mcpEndpoints = manager.endpoints("local", { protocol: "mcp", method: "tools/call" }).items;
  await manager.grant("local", mcpEndpoints.find(item => !item.detail).key, "allow");
  await assert.rejects(echo.execute({ text: "先仅授权外层" }, exec), /未获批准/);
  await manager.grant("local", mcpEndpoints.find(item => item.detail === "echo").key, "allow");
  const echoed = JSON.parse((await echo.execute({ text: "你好" }, { ...exec, callId: "published-mcp" })).summary);
  assert.deepEqual(JSON.parse(echoed.content[0].text), { text: "你好" });
  detach(); assert.equal(tools.size, 0); assert.equal(manager.gatewayState().requested, true);
  await assert.rejects(echo.execute({}), /撤回/);
  manager.attachGateway(port); assert.equal(tools.size, 664);
  await manager.removeKernel("local"); assert.equal(tools.size, 663);
  await manager.registerGateway(false); assert.equal(tools.size, 0);
});
