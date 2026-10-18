import test from 'node:test';
import assert from 'node:assert/strict';
import { KernelManager, managedTools } from '../lib/manager.js';
import { SiYuanConnection } from '../lib/connection.js';
import { createTools } from '../lib/host.js';
import { fixture, docId, blockId } from './fixture.mjs';

function memoryDomain() {
  const tables = new Map();
  return { table(name) {
    if (!tables.has(name)) tables.set(name, new Map());
    const values = tables.get(name);
    return { get: key => structuredClone(values.get(key)), put: async (key, value) => values.set(key, structuredClone(value)), entries: () => values.entries() };
  }, async close() {} };
}
function createManager() {
  return new KernelManager(memoryDomain(), {
    async resolve() {}, async describe() { return { configured: false, writable: true }; }, async set() {}, async unset() {},
  }, (connection, name, args, exec) => createTools(connection).find(tool => tool.name === name).execute(args, exec));
}
const until = async condition => {
  const end = Date.now() + 5000;
  while (!condition() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(condition(), 'push lifecycle did not settle');
};
const snapshot = manager => manager.readReminderBlocks('local', undefined, new AbortController().signal);
const row = { id: blockId, root_id: docId, type: 'callout', subtype: 'DSH-REMINDER', markdown: '> [!DSH-REMINDER] rule' };

test('internal snapshots and shared WS work under tool denial while model invoke keeps endpoint authorization', async () => {
  const server = await fixture();
  const manager = createManager();
  const first = [], second = [];
  let connections = 0, sends = 0;
  server.ws.on('connection', socket => { connections++; socket.on('message', () => sends++); });
  try {
    await manager.initialize({ apiUrl: server.apiUrl, timeoutMs: 1000 });
    const template = new SiYuanConnection({}); managedTools(manager, createTools(template)); await template.dispose();
    server.data.reminderBlocks = [row];
    const endpoints = [
      manager.endpoints('local', { query: '/api/query/sql', protocol: 'http' }).items[0],
      manager.endpoints('local', { query: '/api/sqlite/flushTransaction', protocol: 'http' }).items[0],
      manager.endpoints('local', { protocol: 'ws' }).items.find(item => item.path === '/ws'),
    ];
    const calls = [
      { channel: 'http', method: 'POST', path: '/api/query/sql', body: { stmt: 'SELECT * FROM blocks' } },
      { channel: 'http', method: 'POST', path: '/api/sqlite/flushTransaction', body: {} },
      { channel: 'ws', path: '/ws', messages: [] },
    ];
    assert.ok(endpoints.every(endpoint => endpoint.decision === 'ask-full-access'));
    assert.deepEqual(await snapshot(manager), [row]);
    // 工具调用没有审批答复时不得发送请求，内部快照不会替它授予权限。
    const requests = server.requests.length;
    for (const args of calls) await assert.rejects(manager.invoke('siyuan_rpc', { kernelId: 'local', ...args }), /未获批准/);
    assert.equal(server.requests.length, requests); assert.equal(connections, 0);
    for (const endpoint of endpoints) await manager.grant('local', endpoint.key, 'deny');
    const stopFirst = manager.watchReminders(event => first.push(event));
    const stopSecond = manager.watchReminders(event => second.push(event));
    await until(() => first.some(event => event.kind === 'ready') && second.some(event => event.kind === 'ready'));
    assert.equal(connections, 1); assert.equal(server.ws.clients.size, 1);
    assert.deepEqual(await snapshot(manager), [row]);
    const deniedRequests = server.requests.length;
    for (const args of calls) await assert.rejects(manager.invoke('siyuan_rpc', { kernelId: 'local', ...args }), /设为拒绝/);
    assert.equal(server.requests.length, deniedRequests); assert.equal(connections, 1);
    const socket = [...server.ws.clients][0];
    const message = value => socket.send(JSON.stringify(value));
    const changed = () => first.filter(event => event.kind === 'change');
    message({ cmd: 'statusbar', data: {} });
    message({ cmd: 'transactions', context: { rootIDs: [docId] }, data: [{ doOperations: [{ action: 'update', data: '<div>ordinary</div>' }] }] });
    await until(() => changed().length === 1);
    assert.deepEqual(changed()[0], { kernelId: 'local', kind: 'change', roots: [docId], marker: false });
    message({ cmd: 'transactions', context: { rootIDs: [docId] }, data: [{ doOperations: [{ action: 'insert', data: '<div data-subtype="DSH-REMINDER">rule</div>' }] }] });
    message({ cmd: 'transactions', data: [] });
    message({ cmd: 'syncMergeResult', data: {} });
    message({ cmd: 'moveDocs', data: {} });
    message({ cmd: 'mount', data: {} });
    await until(() => changed().length === 6);
    assert.equal(changed()[1].marker, true);
    assert.ok(changed().slice(2).every(event => event.roots === undefined));
    assert.equal(sends, 0, 'watch is receive-only');
    const firstCount = first.length;
    await stopFirst(); assert.equal(server.ws.clients.size, 1);
    socket.terminate();
    await until(() => connections === 2 && second.filter(event => event.kind === 'ready').length === 2);
    assert.equal(first.length, firstCount);
    await stopSecond();
    await until(() => server.ws.clients.size === 0);
    await manager.close();
    assert.equal(server.ws.clients.size, 0);
  } finally { await manager.close(); await server.close(); }
});

test('default ask permits internal WS and last consumer cancellation aborts reconnect backoff promptly', async () => {
  const server = await fixture();
  const manager = createManager();
  try {
    await manager.initialize({ apiUrl: server.apiUrl, timeoutMs: 1000 });
    const events = [];
    const stop = manager.watchReminders(event => events.push(event));
    await until(() => events.some(event => event.kind === 'ready'));
    [...server.ws.clients][0].terminate();
    await until(() => events.some(event => event.kind === 'offline' && event.message));
    const began = Date.now(); await stop();
    assert.ok(Date.now() - began < 500);
    assert.equal(server.ws.clients.size, 0);
  } finally { await manager.close(); await server.close(); }
});

test('internal snapshot flushes before a full or document-scoped read and rejects SQL-shaped roots', async () => {
  const server = await fixture();
  const manager = createManager();
  try {
    await manager.initialize({ apiUrl: server.apiUrl, timeoutMs: 1000 });
    server.data.reminderBlocks = [row, { ...row, id: docId, root_id: blockId }];
    assert.equal((await snapshot(manager)).length, 2);
    assert.deepEqual(await manager.readReminderBlocks('local', [docId], new AbortController().signal), [row]);
    assert.deepEqual(server.requests.map(request => request.path), [
      '/api/sqlite/flushTransaction', '/api/query/sql', '/api/sqlite/flushTransaction', '/api/query/sql',
    ]);
    const statements = server.requests.filter(request => request.path === '/api/query/sql').map(request => JSON.parse(request.bytes).stmt);
    assert.match(statements[0], /WHERE type='callout' AND subtype='DSH-REMINDER' ORDER BY id LIMIT -1$/);
    assert.match(statements[1], new RegExp(`AND root_id IN \\('${docId}'\\) ORDER BY id LIMIT -1$`));
    await assert.rejects(manager.readReminderBlocks('local', ["x') OR 1=1 --"], new AbortController().signal), /ID 无效/);
    assert.equal(server.requests.length, 4);
    server.data.flushResult = { code: -1, msg: 'index failed', data: null };
    await assert.rejects(snapshot(manager), /index failed/);
    assert.equal(server.requests.at(-1).path, '/api/sqlite/flushTransaction');
    assert.equal(server.requests.length, 5, 'failed barrier must not query stale blocks');
  } finally { await manager.close(); await server.close(); }
});

for (const interruption of ['abort', 'revision']) {
  test(`internal snapshot stops after ${interruption} during the transaction barrier`, async () => {
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const server = await fixture({ beforeFlush: async () => { entered(); await gate; } });
    const manager = createManager();
    const controller = new AbortController();
    try {
      await manager.initialize({ apiUrl: server.apiUrl, timeoutMs: 1000 });
      const pending = manager.readReminderBlocks('local', undefined, controller.signal);
      const rejected = assert.rejects(pending, interruption === 'abort' ? /abort|取消/i : /配置已变化/);
      await started;
      if (interruption === 'abort') controller.abort();
      else await manager.select(null);
      release(); await rejected;
      assert.deepEqual(server.requests.map(request => request.path), ['/api/sqlite/flushTransaction']);
    } finally { release(); await manager.close(); await server.close(); }
  });
}
