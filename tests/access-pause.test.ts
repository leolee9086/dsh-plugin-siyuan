import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import { KernelManager } from '../lib/manager.js';

// 内存只实现插件的存储和凭据端口；HTTP 与 WS 使用真实隔离服务。
function storage() {
  const tables = new Map<string, Map<string, unknown>>();
  let fail = false;
  return { failNextCommit() { fail = true; }, table(name: string) {
    let values = tables.get(name);
    if (!values) { values = new Map<string, unknown>(); tables.set(name, values); }
    const table = values;
    return { get: (key: string) => structuredClone(table.get(key)),
      put: async (key: string, value: unknown) => {
        if (name === 'config' && fail) { fail = false; throw new Error('fixture commit failure'); }
        table.set(key, structuredClone(value));
      }, entries: () => table.entries() };
  }, async close() {} };
}

function managerFor(t: TestContext, domain = storage(), tokens = new Map<string, string>()) {
  const manager = new KernelManager(domain, {
    async resolve(ref) { const value = tokens.get(ref); return value === undefined ? undefined : { value }; },
    async describe(ref) { return { configured: tokens.has(ref), writable: true }; },
    async set(ref, value) { tokens.set(ref, value); }, async unset(ref) { tokens.delete(ref); },
  }, async () => ({ summary: '{}' }));
  t.after(() => manager.close());
  return manager;
}

async function remote(t: TestContext, handler: RequestListener) {
  const server = createServer(handler);
  const ws = new WebSocketServer({ server });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  t.after(async () => {
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>(resolve => ws.close(() => resolve()));
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return { apiUrl: 'http://127.0.0.1:' + address.port, ws };
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!condition() && Date.now() < deadline) await delay(10);
  assert.ok(condition(), 'connection lifecycle did not settle');
}

for (const status of [401, 403, 429] as const) {
  test('HTTP ' + status + '暂停仍存活WS及后续快照，保存连接变化仅恢复指定核心', { timeout: 10000 }, async t => {
    let calls = 0, refused = true;
    const server = await remote(t, (_request, response) => {
      calls++; response.writeHead(refused ? status : 200, { 'content-type': 'application/json', 'retry-after': '30' });
      response.end(JSON.stringify(refused ? { code: -1, msg: 'fixture-private-response' } : { code: 0, data: [] }));
    });
    const domain = storage(), manager = managerFor(t, domain);
    await manager.initialize({ apiUrl: server.apiUrl, token: 'fixture-old', timeoutMs: 1000 });
    const other = await manager.saveKernel({ name: 'second', apiUrl: server.apiUrl, timeoutMs: 1000 });
    let ready = 0;
    let stop = manager.watchReminders(event => { if (event.kind === 'ready') ready++; });
    await until(() => ready === 2);
    const snapshot = (id: string) => manager.readReminderBlocks(id, undefined, new AbortController().signal);
    await assert.rejects(snapshot('local'), new RegExp(String(status)));
    await assert.rejects(snapshot(other.id), new RegExp(String(status)));
    await until(() => server.ws.clients.size === 0);
    assert.equal(calls, 2);
    const pause = (await manager.publicState()).kernels.find(kernel => kernel.id === 'local')!.reminderPause;
    assert.equal(pause?.reason, status === 401 ? 'authentication' : status === 403 ? 'permission' : 'rate-limit');
    assert.equal(pause?.retryAfterSeconds, 30);
    assert.ok(!pause?.message.includes('fixture-private-response'));
    await stop();
    const replay: string[] = [];
    stop = manager.watchReminders(event => replay.push(event.kind));
    assert.deepEqual(replay, ['offline', 'offline']);
    const kernel = (await manager.publicState()).kernels.find(item => item.id === 'local')!;
    const endpoint = manager.endpoints('local', { query: '/api/query/sql' }).items[0]!;
    await manager.grant('local', endpoint.key, 'allow');
    for (const patch of [{ name: 'renamed' }, { timeoutMs: 1500 }, { enabled: false }, { enabled: true }, { token: 'fixture-old' }]) {
      await manager.saveKernel({ ...kernel, ...patch });
      assert.ok((await manager.publicState()).kernels.find(item => item.id === 'local')!.reminderPause);
    }
    await assert.rejects(snapshot('local'), /已暂停/);
    assert.equal(calls, 2);
    // 连接更新持久化失败时保留暂停，原地址仍生效。
    domain.failNextCommit();
    await assert.rejects(manager.saveKernel({ ...kernel, apiUrl: server.apiUrl + '/next' }), /commit failure/);
    assert.ok((await manager.publicState()).kernels.find(item => item.id === 'local')!.reminderPause);
    assert.equal(calls, 2);
    domain.failNextCommit();
    await assert.rejects(manager.saveKernel({ ...kernel, token: 'fixture-new' }), /commit failure/);
    assert.ok((await manager.publicState()).kernels.find(item => item.id === 'local')!.reminderPause);
    refused = false;
    // 重试同一新凭据仍算真实变化，证明失败提交已还原凭据端口。
    await manager.saveKernel({ ...kernel, token: 'fixture-new' });
    const state = await manager.publicState();
    assert.equal(state.kernels.find(item => item.id === 'local')!.reminderPause, undefined);
    assert.ok(state.kernels.find(item => item.id === other.id)!.reminderPause);
    await until(() => replay.includes('ready'));
    assert.deepEqual(await snapshot('local'), []);
    await assert.rejects(snapshot(other.id), /已暂停/);
    assert.equal(calls, 4);
    await stop();
  });
}

for (const entry of [
  { status: 401, body: { code: -1, msg: 'generic rejection' }, pattern: /只读接口拒绝访问.*401/ },
  { status: 403, body: { code: -1, msg: 'permission denied' }, pattern: /没有访问权限.*403/ },
  { status: 429, body: { code: -1, msg: 'limited' }, pattern: /限流.*Retry-After 12 秒/ },
]) {
  test('访问检查HTTP ' + entry.status + '保留语义且只发送一次', async t => {
    let calls = 0;
    const server = await remote(t, (request, response) => {
      if (request.url === '/api/system/version') { response.end(JSON.stringify({ code: 0, data: 'fixture-version' })); return; }
      calls++; response.writeHead(entry.status, { 'retry-after': '12' }); response.end(JSON.stringify(entry.body));
    });
    const manager = managerFor(t); await manager.initialize({ apiUrl: server.apiUrl });
    await assert.rejects(manager.inspectConnection('local'), entry.pattern);
    assert.equal(calls, 1);
    assert.ok((await manager.publicState()).kernels[0]!.reminderPause);
  });
}

test('未配置token时只读接口可用显示未发送凭据', async t => {
  const server = await remote(t, (request, response) => {
    assert.equal(request.headers.authorization, undefined);
    response.end(JSON.stringify({ code: 0, data: request.url === '/api/system/version' ? 'fixture-version' : { notebooks: [] } }));
  });
  const manager = managerFor(t); await manager.initialize({ apiUrl: server.apiUrl });
  const result = await manager.inspectConnection('local');
  assert.equal(result.accessAvailable, true); assert.equal(result.credentialSent, false);
});

test('旧配置读取迟到的HTTP拒绝不暂停新连接', async t => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  const server = await remote(t, (_request, response) => {
    if (first) {
      first = false; entered();
      void gate.then(() => { response.writeHead(401); response.end('{}'); });
    } else response.end(JSON.stringify({ code: 0, data: [] }));
  });
  const manager = managerFor(t); await manager.initialize({ apiUrl: server.apiUrl });
  const reading = manager.readReminderBlocks('local', undefined, new AbortController().signal);
  const rejected = assert.rejects(reading, /401/);
  t.after(release);
  await started;
  const kernel = (await manager.publicState()).kernels[0]!;
  await manager.saveKernel({ ...kernel, token: 'fixture-new' });
  release(); await rejected;
  assert.equal((await manager.publicState()).kernels[0]!.reminderPause, undefined);
  assert.deepEqual(await manager.readReminderBlocks('local', undefined, new AbortController().signal), []);
});

test('WS握手限流暂停自动重连，HTTP日期提示保留，实际凭据更新后恢复', { timeout: 10000 }, async t => {
  let limited = true, handshakes = 0;
  const server = createServer();
  const ws = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    handshakes++;
    if (limited) {
      const retry = new Date(Date.now() + 60000).toUTCString();
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nRetry-After: ' + retry + '\r\nContent-Length: 0\r\n\r\n');
    } else ws.handleUpgrade(request, socket, head, client => ws.emit('connection', client, request));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  t.after(async () => {
    for (const socket of ws.clients) socket.terminate();
    await new Promise<void>(resolve => ws.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const manager = managerFor(t);
  await manager.initialize({ apiUrl: 'http://127.0.0.1:' + address.port, token: 'fixture-old' });
  let paused = false, ready = false;
  const stop = manager.watchReminders(event => {
    if (event.kind === 'offline' && event.message) paused = true;
    if (event.kind === 'ready') ready = true;
  });
  await until(() => paused);
  const kernel = (await manager.publicState()).kernels[0]!;
  assert.equal(kernel.reminderPause?.reason, 'rate-limit');
  const seconds = kernel.reminderPause?.retryAfterSeconds;
  assert.ok(seconds !== undefined && seconds > 0 && seconds <= 60);
  await delay(1200); assert.equal(handshakes, 1);
  limited = false;
  await manager.saveKernel({ ...kernel, token: 'fixture-new' });
  await until(() => ready); assert.equal(handshakes, 2);
  assert.equal((await manager.publicState()).kernels[0]!.reminderPause, undefined);
  await stop();
});

for (const previous of [undefined, '', 'fixture-old']) {
  test('清除凭据提交失败恢复原条目：' + (previous === undefined ? '不存在' : previous === '' ? '空字符串' : '非空'), async t => {
    const domain = storage(), tokens = new Map<string, string>();
    const manager = managerFor(t, domain, tokens);
    await manager.initialize({ apiUrl: 'http://127.0.0.1:6806' });
    if (previous !== undefined) tokens.set('DSH_SIYUAN_LOCAL', previous);
    const state = await manager.publicState(), kernel = state.kernels[0]!;
    domain.failNextCommit();
    await assert.rejects(manager.saveKernel({ ...kernel, clearToken: true }), /commit failure/);
    assert.equal(tokens.has('DSH_SIYUAN_LOCAL'), previous !== undefined);
    assert.equal(tokens.get('DSH_SIYUAN_LOCAL'), previous);
    assert.equal((await manager.publicState()).revision, state.revision);
    await manager.saveKernel({ ...kernel, clearToken: true });
    assert.equal(tokens.has('DSH_SIYUAN_LOCAL'), false);
  });
}

test('新增凭据提交失败恢复为未配置，重试可以保存', async t => {
  const domain = storage(), tokens = new Map<string, string>();
  const manager = managerFor(t, domain, tokens);
  await manager.initialize({ apiUrl: 'http://127.0.0.1:6806' });
  const kernel = (await manager.publicState()).kernels[0]!;
  domain.failNextCommit();
  await assert.rejects(manager.saveKernel({ ...kernel, token: 'fixture-new' }), /commit failure/);
  assert.equal(tokens.has('DSH_SIYUAN_LOCAL'), false);
  await manager.saveKernel({ ...kernel, token: 'fixture-new' });
  assert.equal(tokens.get('DSH_SIYUAN_LOCAL'), 'fixture-new');
});

test('提交后订阅通知失败不会撤回已持久化配置和凭据', async t => {
  const server = await remote(t, (_request, response) => response.end('{}'));
  const domain = storage(), tokens = new Map<string, string>();
  const manager = managerFor(t, domain, tokens);
  await manager.initialize({ apiUrl: server.apiUrl, token: 'fixture-old' });
  let ready = false, failNotification = false;
  const stop = manager.watchReminders(event => {
    if (event.kind === 'ready') ready = true;
    if (event.kind === 'offline' && failNotification) {
      failNotification = false; throw new Error('fixture notification failure');
    }
  });
  await until(() => ready);
  const state = await manager.publicState(), kernel = state.kernels[0]!;
  failNotification = true;
  await assert.rejects(manager.saveKernel({ ...kernel, name: 'saved', token: 'fixture-new' }), /notification failure/);
  assert.equal(tokens.get('DSH_SIYUAN_LOCAL'), 'fixture-new');
  const saved = await manager.publicState();
  assert.equal(saved.revision, state.revision + 1);
  assert.equal(saved.kernels[0]!.name, 'saved');
  const stored = domain.table('config').get('state');
  assert.ok(stored && typeof stored === 'object' && 'revision' in stored);
  assert.equal(stored.revision, saved.revision);
  await stop();
});
