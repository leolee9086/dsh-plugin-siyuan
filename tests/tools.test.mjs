import test from "node:test";
import assert from "node:assert/strict";
import { SiYuanConnection } from "../lib/connection.js";
import { createTools } from "../lib/host.js";
import { fixture, notebookId, docId, blockId } from "./fixture.mjs";

async function withTools(run) {
  const server = await fixture();
  const connection = new SiYuanConnection({ apiUrl: server.apiUrl, timeoutMs: 3000 });
  const tools = createTools(connection);
  const call = async (name, args, signal) => {
    const result = await tools.find(tool => tool.name === name).execute(args, { signal });
    assert.equal(typeof result.summary, "string");
    return JSON.parse(result.summary);
  };
  try { await run(call, server, tools); }
  finally { await connection.dispose(); await server.close(); }
}

test("四个 CRUD 工具完成文档/块创建、查询、更新、删除，内容空白不丢失", () => withTools(async (call, server, tools) => {
  assert.deepEqual(tools.map(tool => tool.name), ["siyuan_query", "siyuan_create", "siyuan_update", "siyuan_delete", "siyuan_rpc"]);
  assert.equal((await call("siyuan_query", { action: "notebooks" })).notebooks[0].id, notebookId);
  const markdown = "  文档\n\n";
  assert.equal((await call("siyuan_create", { action: "doc", notebook: notebookId, path: "/test", markdown })).docId, docId);
  assert.equal(server.data.document.markdown, markdown);
  await call("siyuan_create", { action: "block", parentID: docId, data: "  block\n" });
  assert.equal(server.data.block.data, "  block\n");
  await call("siyuan_create", { action: "append", parentID: docId, data: "append" });
  await call("siyuan_update", { action: "block", id: blockId, data: "\n  changed\n", lockType: true });
  assert.equal((await call("siyuan_query", { action: "read", id: blockId })).kramdown, "\n  changed\n");
  await call("siyuan_update", { action: "block", id: blockId, data: "" });
  assert.equal(server.data.block.data, "");
  await call("siyuan_update", { action: "rename_doc", id: docId, title: "新标题" });
  assert.equal(server.data.document.title, "新标题");
  assert.equal((await call("siyuan_query", { action: "children", id: docId }))[0].id, blockId);
  await call("siyuan_query", { action: "docs", notebook: notebookId, limit: 3, offset: 2 });
  assert.match(JSON.parse(server.requests.at(-1).bytes).stmt, /LIMIT 3 OFFSET 2$/);
  await call("siyuan_query", { action: "sql", stmt: "SELECT * FROM blocks LIMIT 1" });
  await call("siyuan_query", { action: "search", query: "changed", page: 1, pageSize: 10 });
  await call("siyuan_delete", { action: "block", id: blockId });
  await call("siyuan_delete", { action: "doc", id: docId });
  assert.deepEqual(server.data.deleted, [blockId, docId]);
  await assert.rejects(call("siyuan_query", { action: "read", id: "invalid" }), /参数不合法/);
  await assert.rejects(call("siyuan_create", { action: "block", data: "x" }), /锚点/);
  await assert.rejects(call("siyuan_query", { action: "notebooks", extra: true }), /参数不合法/);
}));

test("第五工具覆盖契约发现、未知HTTP、上传下载、插件RPC、MCP和WS", () => withTools(async call => {
  const contract = await call("siyuan_rpc", { channel: "contract", path: "/api/block/getBlockKramdown", includeSchema: true });
  assert.ok(contract.total >= 1);
  assert.ok(contract.endpoints.find(spec => spec.path === "/api/block/getBlockKramdown").schema.$defs);
  const http = await call("siyuan_rpc", { channel: "http", path: "/future", method: "PATCH", body: { test: true }, responseEncoding: "json" });
  assert.deepEqual(http.body, { test: true });
  const binary = await call("siyuan_rpc", { channel: "http", path: "/binary", method: "GET" });
  assert.equal(binary.body, "AP+ACg==");
  const stream = await call("siyuan_rpc", { channel: "http", path: "/stream", method: "GET" });
  assert.equal(stream.body, "AAH+/w==");
  const upload = await call("siyuan_rpc", { channel: "http", path: "/echo", bodyType: "base64", body: "AP8=" });
  assert.equal(upload.body, "AP8=");
  const form = await call("siyuan_rpc", { channel: "http", path: "/echo", bodyType: "form", body: { key: ["a", "b"] }, responseEncoding: "text" });
  assert.equal(form.body, "key=a&key=b");
  await call("siyuan_rpc", { channel: "http", path: "/api/asset/upload", bodyType: "multipart", body: { id: docId },
    files: [{ field: "file[]", name: "sample.bin", base64: "AP8=" }], validate: true });
  assert.deepEqual(await call("siyuan_rpc", { channel: "plugin", method: "echo", params: { test: true } }), { test: true });
  assert.equal((await call("siyuan_rpc", { channel: "plugin", calls: [{ method: "echo", params: [1] }], transport: "ws" }))[0].result[0], 1);
  assert.equal((await call("siyuan_rpc", { channel: "mcp", method: "tools/list" })).tools[0].name, "echo");
  const mcp = await call("siyuan_rpc", { channel: "mcp", method: "tools/call", params: { name: "echo", arguments: { ok: true } } });
  assert.deepEqual(JSON.parse(mcp.content[0].text), { ok: true });
  const ws = await call("siyuan_rpc", { channel: "ws", path: "/ws", messages: ["hello"], maxMessages: 1 });
  assert.equal(ws.messages[0].data, "hello");
  const failure = await call("siyuan_rpc", { channel: "http", path: "/fail", responseEncoding: "text" });
  assert.equal(failure.status, 418);
  await assert.rejects(call("siyuan_rpc", { channel: "http", path: "/binary", maxBytes: 1 }), /maxBytes/);
  await assert.rejects(call("siyuan_rpc", { channel: "http", path: "/echo", files: [{ field: "file", name: "x", base64: "AA==" }] }), /参数不合法|multipart/);
  await assert.rejects(call("siyuan_rpc", { channel: "mcp", method: "tools/list", params: { cursor: "hang" }, timeoutMs: 150 }), /timeout/i);
}));

test("工具遮罩包含引号的echo鉴权值，原始连接保留原响应", async () => {
  const server = await fixture();
  const token = 'fixture-"secret';
  const connection = new SiYuanConnection({ apiUrl: server.apiUrl, token, timeoutMs: 3000 });
  try {
    const tool = createTools(connection).find(tool => tool.name === "siyuan_rpc");
    const output = await tool.execute({ channel: "http", path: "/auth-echo" });
    assert.equal(JSON.parse(output.summary).body.authorization, "Token [redacted]");
    const raw = await connection.http.request("/auth-echo");
    assert.equal((await raw.json()).authorization, "Token " + token);
  } finally { await connection.dispose(); await server.close(); }
});
