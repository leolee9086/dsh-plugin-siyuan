import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { SiYuanConnection } from "../lib/connection.js";
import { fixture } from "./fixture.mjs";

async function withConnection(run) {
  const server = await fixture();
  const connection = new SiYuanConnection({ apiUrl: server.apiUrl, timeoutMs: 3000 });
  try { await run(connection, server); }
  finally { await connection.dispose(); await server.close(); }
}

test("插件JSON-RPC通过HTTP/WS调用、通知、批量并保留错误数据", () => withConnection(async (connection, server) => {
  for (const transport of ["http", "ws"]) {
    assert.deepEqual(await connection.rpc.request("echo", { transport }, { plugin: "my-plugin", transport }), { transport });
    assert.equal(await connection.rpc.request("echo", undefined, { plugin: "my-plugin", transport }), null);
    await connection.rpc.notify("notice", { transport }, { plugin: "my-plugin", transport });
    const responses = await connection.rpc.batch([
      { method: "echo", params: ["first"] }, { method: "notice", notification: true }, { method: "missing" },
    ], { plugin: "my-plugin", transport });
    assert.deepEqual(responses.map(response => response.id), [1, 3]);
    assert.deepEqual(responses[0].result, ["first"]);
    assert.equal(responses[1].error.code, -32601);
    assert.deepEqual(await connection.rpc.batch([{ method: "notice", notification: true }], { transport }), []);
    await assert.rejects(connection.rpc.request("missing", {}, { transport }), error => error.code === -32601 && error.data === "details");
  }
  assert.ok(server.data.notifications.length >= 6);
}));

test("WS 保持文本和二进制，有界收发超时与取消均释放连接", () => withConnection(async (connection, server) => {
  const text = await connection.ws.exchange("/ws?app=fixture&id=test", { messages: ["  hello\n"], durationMs: 1000, maxMessages: 1 });
  assert.deepEqual(text.messages, [{ binary: false, data: "  hello\n", encoding: "utf8" }]);
  assert.equal(text.ended, "limit");
  const binary = await connection.ws.exchange("/ws", { messages: [new Uint8Array([0, 255])], durationMs: 1000, maxMessages: 1 });
  assert.equal(binary.messages[0].data, "AP8=");
  const empty = await connection.ws.exchange("/ws/hang", { durationMs: 30, maxMessages: 1 });
  assert.equal(empty.ended, "timeout");
  const controller = new AbortController();
  const abort = connection.ws.exchange("/ws/hang", { signal: controller.signal, durationMs: 3000, maxMessages: 1 });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(abort);
  const socket = await connection.ws.open("/ws/hang");
  const close = once(socket, "close");
  await connection.dispose();
  await close;
  assert.equal(socket.readyState, 3);
  assert.ok(server.ws.clients.size <= 1);
}));

test("官方 MCP SDK 真实握手、发现、调用、通用资源方法与DELETE清理", () => withConnection(async (connection, server) => {
  const tools = await connection.mcp.request("tools/list");
  assert.equal(tools.tools[0].name, "echo");
  const result = await connection.mcp.request("tools/call", { name: "echo", arguments: { content: "原文\n" } });
  assert.equal(JSON.parse(result.content[0].text).content, "原文\n");
  assert.deepEqual((await connection.mcp.request("resources/list")).resources, []);
  const session = await connection.mcp.open();
  assert.equal((await session.client.listTools()).tools[0].name, "echo");
  assert.ok(session.transport.protocolVersion);
  const count = server.data.mcpDeleted;
  await connection.dispose();
  assert.equal(server.data.mcpDeleted, count + 1);
  assert.equal(server.data.mcpDeleted, 4);
  await assert.rejects(connection.mcp.open(), /卸载/);
}));

test("RPC保留HTTP错误和取消原因，MCP调用覆盖超时", () => withConnection(async connection => {
  await assert.rejects(connection.rpc.request("echo", {}, { plugin: "fail" }), /HTTP 418/);
  const controller = new AbortController();
  const reason = new Error("fixture cancelled");
  const pending = connection.rpc.request("hang", {}, { transport: "ws", signal: controller.signal });
  setTimeout(() => controller.abort(reason), 30);
  await assert.rejects(pending, error => error === reason);
  await assert.rejects(connection.mcp.request("tools/list", { cursor: "hang" }, undefined, 150), /timeout/i);
}));
