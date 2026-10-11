import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { HttpConnection } from "../lib/http.js";
import { normalizeConfig, callKernel, KernelError } from "../lib/api.js";
import { ContractError } from "../lib/contract.js";
import { fixture } from "./fixture.mjs";

async function withHttp(run) {
  const server = await fixture();
  const http = new HttpConnection(normalizeConfig({ apiUrl: server.apiUrl, token: "fixture-secret", timeoutMs: 3000 }));
  try { await run(http, server); }
  finally { http.dispose(); await server.close(); }
}

test("HTTP保持未知路径、查询、状态、头和二进制字节", () => withHttp(async (http, server) => {
  const bytes = new Uint8Array([0, 128, 255, 10]);
  const result = await http.request("/future/path?key=a&key=b", { method: "PATCH", headers: { "x-custom": "yes" }, body: bytes });
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
  assert.equal(result.headers.get("x-fixture"), "preserved");
  const request = server.requests.at(-1);
  assert.equal(request.headers.authorization, "Token fixture-secret");
  assert.equal(request.headers["x-custom"], "yes");
  assert.equal(request.method, "PATCH");
  assert.equal(request.search, "?key=a&key=b");
  const failure = await http.request("/fail");
  assert.equal(failure.status, 418);
  assert.equal(await failure.text(), "rejected body");
  const redirect = await http.request("/redirect");
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "http://other.invalid/");
  await redirect.body.cancel();
  await assert.rejects(http.fetch("http://another.invalid/api", {}), /只接受/);
  assert.throws(() => http.url("//another.invalid"));
}));

test("表单、multipart 单文件数组和流式上传保持原文", () => withHttp(async (http, server) => {
  const form = new URLSearchParams({ path: "a b", content: "line\n" });
  const response = await http.request("/form", { method: "POST", body: form });
  assert.equal(await response.text(), form.toString());
  const multipart = new FormData();
  multipart.append("file[]", new Blob([new Uint8Array([0, 255, 42])]), "sample.bin");
  multipart.append("id", "20261011180000-abcdefg");
  const upload = await http.request("/api/asset/upload", { method: "POST", body: multipart, validate: true });
  const uploaded = await upload.text();
  assert.match(uploaded, /name="file\[\]"; filename="sample.bin"/);
  assert.ok(server.requests.at(-1).bytes.includes(Buffer.from([0, 255, 42])));
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([4, 5])); controller.enqueue(new Uint8Array([6])); controller.close(); } });
  const streamed = await http.request("/stream-upload", { method: "POST", body: stream });
  assert.deepEqual([...new Uint8Array(await streamed.arrayBuffer())], [4, 5, 6]);
}));

test("显式契约校验拒绝错误请求，原始转发保留兼容性", () => withHttp(async (http, server) => {
  const path = "/api/block/getBlockKramdown";
  await assert.rejects(http.json(path, { id: 42 }), ContractError);
  assert.equal(server.requests.length, 0);
  const raw = await http.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: '{"id":42}' });
  assert.equal(raw.status, 200);
  await raw.body.cancel();
  assert.equal(server.requests.length, 1);
  await assert.rejects(callKernel(http, "/rejected", {}), KernelError);
}));

test("原始方法覆盖 TRACE/PROPFIND 与 GET 请求体", () => withHttp(async (http, server) => {
  // TRACK 不在思源接口/路由库方法集合内，Node 服务端解析器会在路由前拒绝它。
  for (const method of ["TRACE", "PROPFIND", "GET"]) {
    const response = await http.request("/raw", { method, body: "raw body", headers: { "content-type": "text/plain" } });
    assert.equal(await response.text(), "raw body", method);
    assert.equal(server.requests.at(-1).method, method);
  }
  const response = await http.request("/raw", { method: "HEAD" });
  assert.equal(response.body, null);
}));

test("CONNECT 交付可收发的真实隧道，卸载关闭它", () => withHttp(async http => {
  const tunnel = await http.openTunnel("/tunnel", { timeoutMs: 0 });
  assert.equal(tunnel.status, 200);
  const received = once(tunnel.socket, "data");
  tunnel.socket.write(Buffer.from([0, 255, 7]));
  assert.deepEqual((await received)[0], Buffer.from([0, 255, 7]));
  const closed = once(tunnel.socket, "close");
  http.dispose();
  await closed;
}));

test("超时覆盖响应体，取消和卸载停止未完成请求", () => withHttp(async http => {
  const slow = await http.request("/slow-body", { timeoutMs: 80 });
  await assert.rejects(slow.text(), /abort|timeout/i);
  const controller = new AbortController();
  const pending = http.request("/hang", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending);
  const long = http.request("/hang", { timeoutMs: 0 });
  http.dispose();
  await assert.rejects(long);
  await assert.rejects(http.request("/binary"));
}));

test("CONNECT保留首段和后续有界响应字节", () => withHttp(async http => {
  const response = await http.request("/connect-body", { method: "CONNECT" });
  assert.equal(response.status, 200);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 255, 42, 128]);
}));

test("multipart不带方括号的file数组也遵循契约", () => withHttp(async http => {
  const form = new FormData();
  form.append("file", new Blob(["fixture"]), "fixture.zip");
  const response = await http.request("/api/system/importConf", { method: "POST", body: form, validate: true });
  assert.equal(response.status, 200);
  await response.body.cancel();
}));
