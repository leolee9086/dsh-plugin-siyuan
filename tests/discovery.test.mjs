/** 自动发现使用临时登记文件和真实协议服务器，不读写机器上的思源登记文件。 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { defaultPortFile, KernelDiscovery } from "../lib/discovery.js";
import { normalizeConfig } from "../lib/api.js";
import { SiYuanConnection } from "../lib/connection.js";
import { createTools } from "../lib/host.js";
import { fixture } from "./fixture.mjs";

async function setup(t, config = {}, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "siyuan-discovery-"));
  const portFile = path.join(directory, "port.json");
  const servers = [await fixture(options)];
  const connection = new SiYuanConnection({ portFile, timeoutMs: 3000, ...config });
  const register = entries => writeFile(portFile, JSON.stringify(entries));
  const port = server => new URL(server.apiUrl).port;
  await register({ [process.pid]: port(servers[0]) });
  t.after(async () => {
    try { await connection.dispose(); }
    finally { for (const server of servers) await server.close(); await rm(directory, { recursive: true }); }
  });
  const rpc = createTools(connection).find(tool => tool.name === "siyuan_rpc");
  const call = async args => JSON.parse((await rpc.execute(args)).summary);
  return { portFile, servers, server: servers[0], connection, register, port, call };
}

async function child(t) {
  const process_ = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await once(process_, "spawn");
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    const exited = once(process_, "exit");
    process_.kill();
    await exited;
  };
  t.after(stop);
  return { pid: process_.pid, stop };
}

test("桌面三平台按账户Home定位，缺少内核时契约和五工具仍可离线加载", async () => {
  assert.equal(defaultPortFile("win32", "C:\\Users\\Fixture"), "C:\\Users\\Fixture\\.config\\siyuan\\port.json");
  assert.equal(defaultPortFile("darwin", "/Users/fixture"), "/Users/fixture/.config/siyuan/port.json");
  assert.equal(defaultPortFile("linux", "/home/fixture"), "/home/fixture/.config/siyuan/port.json");
  assert.equal(normalizeConfig({}).apiUrl, "auto");
  assert.equal(normalizeConfig({ apiUrl: "http://localhost:1234/prefix/" }).apiUrl, "http://localhost:1234/prefix");
  for (const input of [{ portFile: "relative" }, { kernelPid: 0 }, { kernelPid: 1.2 }, { apiUrl: "ftp://host" }]) {
    assert.throws(() => normalizeConfig(input));
  }
  const connection = new SiYuanConnection({ portFile: path.join(tmpdir(), "siyuan-missing", "port.json") });
  try {
    assert.equal(createTools(connection).length, 5);
    assert.ok((await connection.http.describe("POST", "/api/notebook/lsNotebooks")).spec);
    const tool = createTools(connection).find(tool => tool.name === "siyuan_rpc");
    assert.equal(JSON.parse((await tool.execute({ channel: "contract", limit: 1 })).summary).total, 697);
  } finally { await connection.dispose(); }
});

test("失效PID与无效记录被淘汰，探针不带token，业务失败只发送一次", async t => {
  const stale = await child(t);
  await stale.stop();
  const context = await setup(t, { token: "fixture-secret" });
  const { connection, server, register, port, portFile } = context;
  const entries = { [process.pid]: port(server), [stale.pid]: port(server), "0": "6806", "-1": "80", "bad": "80", "2147483648": "80" };
  await register(entries);
  const before = await readFile(portFile, "utf8");
  assert.deepEqual((await connection.discovery.discover()).map(item => item.pid), [process.pid]);
  assert.equal(await readFile(portFile, "utf8"), before);
  const response = await connection.http.request("/fail", { method: "POST", body: "single-write" });
  assert.equal(response.status, 418);
  await response.text();
  assert.equal(server.requests.filter(req => req.path === "/fail").length, 1);
  assert.equal(server.requests.find(req => req.path === "/fail").headers.authorization, "Token fixture-secret");
  assert.ok(server.requests.filter(req => req.path === "/api/system/version").every(req => req.headers.authorization === undefined));
  await assert.rejects(connection.http.fetch("http://other.invalid/target"), /内核的地址/);
});

test("多个运行实例必须选择，选中PID退出不会悄悄切到剩余实例", async t => {
  const active = await child(t);
  const { connection, servers, server, register, port, call } = await setup(t);
  const second = await fixture(); servers.push(second);
  await register({ [process.pid]: port(server), [active.pid]: port(second) });
  const status = await call({ channel: "connection", action: "status" });
  assert.equal(status.mode, "auto");
  assert.equal(status.instances.length, 2);
  await assert.rejects(connection.json("/api/notebook/lsNotebooks", {}), /多个思源实例/);
  assert.equal(server.requests.filter(req => req.path === "/api/notebook/lsNotebooks").length, 0);
  assert.equal(second.requests.filter(req => req.path === "/api/notebook/lsNotebooks").length, 0);
  await assert.rejects(call({ channel: "connection", action: "select" }), /参数不合法/);
  assert.equal((await call({ channel: "connection", action: "select", pid: active.pid })).apiUrl, second.apiUrl);
  await (await connection.json("/api/notebook/lsNotebooks", {})).json();
  assert.equal(second.requests.filter(req => req.path === "/api/notebook/lsNotebooks").length, 1);
  const selected = new KernelDiscovery(normalizeConfig({ portFile: status.portFile, kernelPid: active.pid }));
  assert.equal(await selected.resolve(), second.apiUrl);
  await active.stop();
  await assert.rejects(connection.json("/api/notebook/lsNotebooks", {}), /已不可用/);
  await call({ channel: "connection", action: "select", pid: process.pid });
  assert.equal(await connection.http.endpoint(), server.apiUrl);
});

test("端口登记更新作用于新HTTP/WS/RPC/隧道/MCP，旧MCP会话及DELETE绑定原目标", async t => {
  const { connection, servers, server, register, port } = await setup(t);
  const session = await connection.mcp.open();
  const retained = await connection.http.bindFetch();
  const oldSocket = await connection.ws.open("/ws");
  const second = await fixture(); servers.push(second);
  await register({ [process.pid]: port(second) });
  await (await connection.http.request("/echo", { method: "POST", body: "new-http" })).text();
  assert.ok(second.requests.some(req => req.path === "/echo" && req.bytes.toString() === "new-http"));
  assert.equal((await connection.ws.exchange("/ws", { messages: ["new-ws"], durationMs: 1000, maxMessages: 1 })).messages[0].data, "new-ws");
  assert.equal((await connection.rpc.request("echo", { new: true })).new, true);
  assert.equal((await connection.rpc.request("echo", { new: true }, { transport: "ws" })).new, true);
  const tunnel = await connection.http.openTunnel("/tunnel");
  tunnel.socket.write("tunnel");
  assert.equal((await once(tunnel.socket, "data"))[0].toString(), "tunnel");
  tunnel.socket.destroy();
  const rawConnect = await connection.http.request("/connect-body", { method: "CONNECT" });
  assert.deepEqual(Buffer.from(await rawConnect.arrayBuffer()), Buffer.from([0, 255, 42, 128]));
  await (await retained.fetch(retained.url("/echo"), { method: "POST", body: "old-bound" })).text();
  assert.ok(server.requests.some(req => req.bytes.toString() === "old-bound"));
  const message = once(oldSocket, "message");
  oldSocket.send("old-ws");
  assert.equal((await message)[0].toString(), "old-ws");
  assert.equal((await session.client.listTools()).tools[0].name, "echo");
  await session.close();
  assert.equal(server.data.mcpDeleted, 1);
  assert.equal(second.data.mcpDeleted, 0);
  assert.equal((await connection.mcp.request("tools/list")).tools[0].name, "echo");
  assert.equal(second.data.mcpDeleted, 1);
  oldSocket.terminate();
});

test("缺失、损坏、错误形状的登记文件给明确错误，显式URL无需登记文件", async t => {
  const { connection, register, portFile, server } = await setup(t);
  await register([]);
  await assert.rejects(connection.http.endpoint(), /PID→端口对象/);
  await writeFile(portFile, "{");
  await assert.rejects(connection.http.endpoint(), /无法读取思源端口文件/);
  await rm(portFile);
  await assert.rejects(connection.http.endpoint(), /无法读取思源端口文件/);
  const explicit = new SiYuanConnection({ apiUrl: server.apiUrl, portFile, kernelPid: 2147483647 });
  try {
    assert.equal((await explicit.discovery.status()).mode, "explicit");
    await (await explicit.json("/api/notebook/lsNotebooks", {})).json();
    await assert.rejects(explicit.discovery.select(process.pid), /显式 apiUrl/);
  } finally { await explicit.dispose(); }
});

test("非思源版本响应与失联端口不作为实例，不会向其发送业务请求或token", async t => {
  const { connection, server, register } = await setup(t, { token: "fixture-secret" }, { version: { fake: true } });
  await assert.rejects(connection.json("/api/notebook/lsNotebooks", {}), /没有可连接/);
  assert.ok(server.requests.every(req => req.path === "/api/system/version" && req.headers.authorization === undefined));
  const closed = await fixture();
  const closedPort = new URL(closed.apiUrl).port;
  await closed.close();
  await register({ [process.pid]: closedPort });
  assert.equal((await connection.discovery.discover()).length, 0);
});

test("探针期间取消、超时与卸载阻止业务调用，并保留取消原因", async t => {
  let began;
  let started = new Promise(resolve => { began = resolve; });
  const { connection, server } = await setup(t, {}, { beforeVersion: async () => {
    began();
    await new Promise(resolve => setTimeout(resolve, 250));
  } });
  const controller = new AbortController();
  const reason = new Error("cancel discovery");
  const pending = connection.http.request("/echo", { signal: controller.signal });
  await started; controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  await assert.rejects(connection.http.request("/echo", { timeoutMs: 25 }), /timeout/i);
  started = new Promise(resolve => { began = resolve; });
  const unloading = connection.http.request("/echo");
  await started; await connection.dispose();
  await assert.rejects(unloading, /卸载/);
  assert.equal(server.requests.filter(req => req.path === "/echo").length, 0);
});
