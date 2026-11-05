import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";
import { KernelManager } from "../lib/manager.js";
import { SiYuanConnection } from "../lib/connection.js";
import { createRoute } from "../lib/route.js";

// 仅实现领域存储端口；网络使用隔离 HTTP/WS 服务，不构造 Harness 上下文。
function fixture(t) {
  const tables = new Map(), secrets = new Map();
  let commitFailure = false, writeFailure;
  const writes = [];
  const domain = { table(name) {
    if (!tables.has(name)) tables.set(name, new Map());
    const table = tables.get(name);
    return { get: key => structuredClone(table.get(key)), entries: () => table.entries(), async put(key, value) {
      if (commitFailure) { commitFailure = false; throw new Error("fixture commit failure"); }
      table.set(key, structuredClone(value));
    } };
  }, async close() {} };
  const credentials = {
    async resolve(ref) { return secrets.has(ref) ? { value: secrets.get(ref) } : undefined; },
    async describe(ref) { return { configured: secrets.has(ref), writable: true }; },
    async set(ref, value) {
      if (writeFailure?.(ref, value)) throw new Error("fixture credential failure");
      writes.push(ref); secrets.set(ref, value);
    },
    async unset(ref) {
      if (writeFailure?.(ref, undefined)) throw new Error("fixture credential failure");
      writes.push(ref); secrets.delete(ref);
    },
  };
  const create = () => new KernelManager(domain, credentials, async () => ({ summary: "{}" }));
  const manager = create(); t.after(() => manager.close());
  return { manager, create, secrets, writes, failCommit() { commitFailure = true; },
    failCredential(predicate) { writeFailure = predicate; } };
}
async function until(predicate) {
  const deadline = Date.now() + 4000;
  while (!predicate()) { if (Date.now() >= deadline) assert.fail("fixture lifecycle did not settle"); await delay(10); }
}
async function remote(t) {
  const state = { denyWs: false, login: "success", logins: 0, wsAttempts: 0, wsCookies: [], httpCookies: [], paths: [] };
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    state.paths.push(request.url);
    if (request.url === "/api/system/loginAuth") {
      state.logins++;
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      if (typeof state.login === "number") {
        response.writeHead(state.login, { "retry-after": "12" }); response.end("{}"); return;
      }
      if (state.login === "invalid") { response.end("not-json"); return; }
      if (state.login === "missing-cookie") { response.end(JSON.stringify({ code: 0 })); return; }
      if (state.login === "captcha" || input.authCode !== "fixture-access") {
        response.end(JSON.stringify({ code: state.login === "captcha" ? 1 : -1, msg: "fixture-private-response" })); return;
      }
      response.setHeader("set-cookie", ["proxy=unrelated; Path=/", "siyuan=fixture-session; Path=/; HttpOnly"]);
      response.end(JSON.stringify({ code: 0, data: null })); return;
    }
    if (request.url === "/api/system/version") { response.end(JSON.stringify({ code: 0, data: "fixture-version" })); return; }
    state.httpCookies.push(request.headers.cookie);
    if (request.headers.cookie !== "siyuan=fixture-session") {
      response.writeHead(401); response.end(JSON.stringify({ code: -1 })); return;
    }
    response.end(JSON.stringify({ code: 0, data: request.url === "/api/notebook/lsNotebooks" ? { notebooks: [] }
      : request.url === "/api/query/sql" ? [] : null }));
  });
  const ws = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    state.wsAttempts++; state.wsCookies.push(request.headers.cookie);
    if (state.denyWs || request.headers.cookie !== "siyuan=fixture-session") {
      socket.end(["HTTP/1.1 401 Unauthorized", "Connection: close", "", ""].join(String.fromCharCode(13, 10))); return;
    }
    ws.handleUpgrade(request, socket, head, client => ws.emit("connection", client, request));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const apiUrl = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    for (const socket of ws.clients) socket.terminate();
    await new Promise(resolve => ws.close(resolve));
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  });
  return { state, apiUrl, ws };
}

for (const mode of ["replace", "clear", "invalid-input", "commit"]) {
  test("双凭据更新失败补偿两项旧值：" + mode, async t => {
    const f = fixture(t); await f.manager.initialize({ apiUrl: "http://127.0.0.1:1", token: "fixture-old-token", authCode: "fixture-old-code" });
    const before = await f.manager.publicState();
    if (mode === "replace" || mode === "clear") f.failCredential(ref => ref.endsWith("_AUTHCODE"));
    if (mode === "commit") f.failCommit();
    const patch = mode === "clear" ? { clearToken: true, clearAuthCode: true }
      : { token: "fixture-new-token", authCode: mode === "invalid-input" ? String.fromCharCode(10) : "fixture-new-code" };
    const writes = f.writes.length;
    await assert.rejects(f.manager.saveKernel({ ...before.kernels[0], ...patch }), /failure|单行文本/);
    assert.equal(f.secrets.get("DSH_SIYUAN_LOCAL"), "fixture-old-token");
    assert.equal(f.secrets.get("DSH_SIYUAN_LOCAL_AUTHCODE"), "fixture-old-code");
    assert.equal((await f.manager.publicState()).revision, before.revision);
    if (mode === "invalid-input") assert.equal(f.writes.length, writes);
    f.failCredential(undefined);
    await f.manager.saveKernel({ ...before.kernels[0], token: "fixture-new-token", authCode: "fixture-new-code" });
    assert.equal(f.secrets.get("DSH_SIYUAN_LOCAL"), "fixture-new-token");
    assert.equal(f.secrets.get("DSH_SIYUAN_LOCAL_AUTHCODE"), "fixture-new-code");
  });
}

test("新增两项凭据失败恢复未配置；补偿失败给出明确错误", async t => {
  const f = fixture(t); await f.manager.initialize({ apiUrl: "http://127.0.0.1:1" });
  const kernel = (await f.manager.publicState()).kernels[0];
  f.failCredential(ref => ref.endsWith("_AUTHCODE"));
  await assert.rejects(f.manager.saveKernel({ ...kernel, token: "fixture-new", authCode: "fixture-access" }), /credential failure/);
  assert.equal(f.secrets.size, 0);
  f.failCredential((ref, value) => ref.endsWith("_AUTHCODE") || value === undefined);
  await assert.rejects(f.manager.saveKernel({ ...kernel, token: "fixture-new", authCode: "fixture-access" }), /凭据未能恢复/);
});

test("管理POST保存访问码后真实WS握手带Cookie，状态回读和重新初始化保留配置", async t => {
  const r = await remote(t), f = fixture(t); await f.manager.initialize({ apiUrl: r.apiUrl });
  let paused = false, ready = false;
  const stop = f.manager.watchKernels(event => { if (event.message) paused = true; if (event.kind === "ready") ready = true; }); t.after(stop);
  await until(() => paused);
  const server = createServer(createRoute(() => undefined, f.manager, {}));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = "http://127.0.0.1:" + server.address().port + "/api/siyuan-control";
  const kernel = (await f.manager.publicState()).kernels[0];
  const saved = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...kernel, action: "saveKernel", authCode: "fixture-access" }) });
  assert.equal(saved.status, 200); assert.deepEqual(await saved.json(), { id: "local" });
  await until(() => ready);
  const state = await (await fetch(url)).json();
  assert.equal(state.kernels[0].authCodeCredential.configured, true);
  assert.equal(state.kernels[0].reminderPause, undefined);
  assert.equal(r.state.wsCookies.at(-1), "siyuan=fixture-session");
  assert.equal(JSON.stringify(state).includes("fixture-access"), false);
  assert.equal((await f.manager.inspectConnection("local")).accessAvailable, true);
  const reopened = f.create(); t.after(() => reopened.close()); await reopened.initialize({});
  assert.equal((await reopened.publicState()).kernels[0].authCodeCredential.configured, true);
});

for (const mode of ["same-credential", "manual-check"]) {
  test("暂停核心可由人工恢复，其他核心保持暂停：" + mode, async t => {
    const r = await remote(t); r.state.denyWs = true;
    const f = fixture(t); await f.manager.initialize({ apiUrl: r.apiUrl, authCode: "fixture-access" });
    const other = await f.manager.saveKernel({ name: "other", apiUrl: r.apiUrl, authCode: "fixture-access" });
    const paused = new Set(), ready = [];
    const stop = f.manager.watchKernels(e => { if (e.message) paused.add(e.kernelId); if (e.kind === "ready") ready.push(e.kernelId); }); t.after(stop);
    await until(() => paused.size === 2); r.state.denyWs = false;
    const attempts = r.state.wsAttempts;
    await f.manager.inspectConnection("local", false, false);
    assert.ok((await f.manager.publicState()).kernels.find(k => k.id === "local").reminderPause);
    assert.equal(r.state.wsAttempts, attempts);
    const kernel = (await f.manager.publicState()).kernels.find(k => k.id === "local");
    if (mode === "same-credential") {
      f.failCommit();
      await assert.rejects(f.manager.saveKernel({ ...kernel, authCode: "fixture-access" }), /commit failure/);
      assert.ok((await f.manager.publicState()).kernels.find(k => k.id === "local").reminderPause);
      await f.manager.saveKernel({ ...kernel, authCode: "fixture-access" });
    } else await f.manager.inspectConnection("local");
    await until(() => ready.includes("local"));
    assert.equal((await f.manager.publicState()).kernels.find(k => k.id === "local").reminderPause, undefined);
    assert.ok((await f.manager.publicState()).kernels.find(k => k.id === other.id).reminderPause);
    assert.equal(r.state.wsAttempts, attempts + 1);
  });
}

test("只有访问码时，提醒与技能独立HTTP连接自动登录", async t => {
  const r = await remote(t), f = fixture(t); await f.manager.initialize({ apiUrl: r.apiUrl, authCode: "fixture-access" });
  assert.deepEqual(await f.manager.listSkills("local"), []);
  assert.deepEqual(await f.manager.readReminderBlocks("local", undefined, new AbortController().signal), []);
  assert.equal(r.state.logins, 2);
  assert.ok(r.state.httpCookies.length >= 4);
  assert.ok(r.state.httpCookies.every(cookie => cookie === "siyuan=fixture-session"));
});

test("同一连接并发HTTP和WS共用登录会话，取正确Cookie", async t => {
  const r = await remote(t), connection = new SiYuanConnection({ apiUrl: r.apiUrl, authCode: "fixture-access" });
  t.after(() => connection.dispose());
  const [response] = await Promise.all([connection.json("/api/notebook/lsNotebooks", {}), connection.ws.open("/ws?app=fixture&id=fixture&type=main")]);
  assert.equal(response.status, 200); await response.json();
  assert.equal(r.state.logins, 1); assert.equal(r.state.wsCookies[0], "siyuan=fixture-session");
});



test("技能读取登录失败进入暂停，下一次发现不重复登录", async t => {
  const r = await remote(t), f = fixture(t);
  await f.manager.initialize({ apiUrl: r.apiUrl, authCode: "fixture-wrong" });
  await assert.rejects(f.manager.listSkills("local"), /访问授权码校验失败/);
  assert.equal((await f.manager.publicState()).kernels[0].reminderPause.reason, "authentication");
  await assert.rejects(f.manager.listSkills("local"), /已暂停/);
  assert.equal(r.state.logins, 1);
});

test("人工HTTP检查失败保留暂停，不开启新的WS", async t => {
  const r = await remote(t); r.state.denyWs = true;
  const f = fixture(t); await f.manager.initialize({ apiUrl: r.apiUrl, authCode: "fixture-access" });
  let paused = false;
  const stop = f.manager.watchKernels(e => { if (e.message) paused = true; }); t.after(stop);
  await until(() => paused); const attempts = r.state.wsAttempts;
  r.state.denyWs = false; r.state.login = 403;
  await assert.rejects(f.manager.inspectConnection("local"), /403/);
  assert.equal((await f.manager.publicState()).kernels[0].reminderPause.reason, "permission");
  assert.equal(r.state.wsAttempts, attempts);
});

test("人工恢复暂停核心不中断其他已就绪核心", async t => {
  const r = await remote(t), f = fixture(t);
  await f.manager.initialize({ apiUrl: r.apiUrl, authCode: "fixture-access" });
  const other = await f.manager.saveKernel({ name: "other", apiUrl: r.apiUrl, authCode: "fixture-access" });
  const ready = new Set(), offline = [];
  const stop = f.manager.watchKernels(e => { if (e.kind === "ready") ready.add(e.kernelId); if (e.kind === "offline") offline.push(e.kernelId); }); t.after(stop);
  await until(() => ready.size === 2);
  r.state.login = 403; await assert.rejects(f.manager.readReminderBlocks("local", undefined, new AbortController().signal), /403/);
  await until(() => r.ws.clients.size === 1); const otherOffline = offline.filter(id => id === other.id).length;
  r.state.login = "success"; ready.delete("local"); await f.manager.inspectConnection("local");
  await until(() => ready.has("local"));
  assert.equal(offline.filter(id => id === other.id).length, otherOffline);
  assert.equal(r.ws.clients.size, 2);
});

for (const mode of ["wrong-code", "captcha", "missing-cookie", "invalid", 401, 403, 429]) {
  test("登录失败暂停自动重试并保留分类：" + mode, async t => {
    const r = await remote(t); r.state.login = mode;
    const f = fixture(t); await f.manager.initialize({ apiUrl: r.apiUrl, authCode: mode === "wrong-code" ? "fixture-wrong" : "fixture-access" });
    let pause;
    const stop = f.manager.watchKernels(e => { if (e.message) pause = e.message; }); t.after(stop);
    await until(() => pause);
    const state = (await f.manager.publicState()).kernels[0];
    assert.equal(state.reminderPause.reason, mode === 403 ? "permission" : mode === 429 ? "rate-limit" : "authentication");
    if (mode === 429) assert.equal(state.reminderPause.retryAfterSeconds, 12);
    assert.equal(pause.includes("fixture-private-response"), false);
    assert.equal(r.state.wsAttempts, 0);
    await delay(1150); assert.equal(r.state.logins, 1);
  });
}
