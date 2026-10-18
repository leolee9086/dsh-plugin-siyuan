import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KernelManager } from '../lib/manager.js';

function memoryDomain() {
  const tables = new Map<string, Map<string, unknown>>();
  return { table(name: string) {
    let values = tables.get(name);
    if (!values) { values = new Map<string, unknown>(); tables.set(name, values); }
    const table = values;
    return { get: (key: string) => structuredClone(table.get(key)),
      put: async (key: string, value: unknown) => { table.set(key, structuredClone(value)); }, entries: () => table.entries() };
  }, async close() {} };
}

// 只提供插件自己的持久端口；进程、登记文件与HTTP探针均为真实设施。
test('管理器恢复退出PID、持久保存新绑定并支持候选列表显式切换', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'siyuan-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const portFile = join(directory, 'port.json');
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ code: 0, msg: '', data: '3.8.6' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await once(child, 'spawn'); assert.ok(child.pid);
  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true; const exited = once(child, 'exit'); child.kill(); await exited;
  }
  t.after(stop);
  await writeFile(portFile, JSON.stringify({ [child.pid]: address.port, [process.pid]: address.port }));
  const domain = memoryDomain();
  const credentials = { async resolve() { return undefined; }, async describe() { return { configured: false, writable: true }; },
    async set() {}, async unset() {} };
  const create = () => new KernelManager(domain, credentials, async () => ({ summary: '{}' }));
  const manager = create(); t.after(() => manager.close());
  await manager.initialize({ portFile, kernelPid: child.pid });
  const endpoint = manager.endpoints('local', { query: '/api/query/sql' }).items[0]!;
  await manager.grant('local', endpoint.key, 'allow');
  const candidates = await manager.connectionInstances('local');
  assert.equal(candidates.instances?.length, 2);
  await assert.rejects(manager.selectInstance('local', -1), /正整数/);
  await stop();
  await manager.inspectConnection('local');
  assert.equal((await manager.publicState()).kernels[0]!.kernelPid, process.pid);
  assert.equal(manager.endpoints('local', { query: '/api/query/sql' }).items[0]!.decision, 'ask-full-access');
  await assert.rejects(manager.selectInstance('local', child.pid), /不是当前有效/);
  await manager.selectInstance('local', process.pid);
  const restored = create(); t.after(() => restored.close()); await restored.initialize({});
  assert.equal((await restored.publicState()).kernels[0]!.kernelPid, process.pid);
});

test('公开版本可达不掩盖token失效，更新凭据后恢复且保留同核心端点授权', async t => {
  let expected = 'fixture-old', protectedCalls = 0;
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/system/version') { response.end(JSON.stringify({ code: 0, data: '3.8.6' })); return; }
    protectedCalls++;
    if (request.headers.authorization !== `Token ${expected}`) {
      response.writeHead(401); response.end(JSON.stringify({ code: -1, msg: 'Auth failed [header: Authorization]' })); return;
    }
    response.end(JSON.stringify({ code: 0, data: { notebooks: [] } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const secrets = new Map<string, string>();
  const manager = new KernelManager(memoryDomain(), {
    async resolve(ref) { const value = secrets.get(ref); return value === undefined ? undefined : { value }; },
    async describe(ref) { return { configured: secrets.has(ref), writable: true }; },
    async set(ref, value) { secrets.set(ref, value); }, async unset(ref) { secrets.delete(ref); },
  }, async () => ({ summary: '{}' }));
  t.after(() => manager.close());
  await manager.initialize({ apiUrl: `http://127.0.0.1:${address.port}`, token: expected });
  const endpoint = manager.endpoints('local', { query: '/api/query/sql' }).items[0]!;
  await manager.grant('local', endpoint.key, 'allow');
  assert.deepEqual(await manager.inspectConnection('local'), { apiUrl: `http://127.0.0.1:${address.port}`,
    version: '3.8.6', accessAvailable: true, credentialSent: true, mcpTools: 0 });
  expected = 'fixture-new';
  const before = protectedCalls;
  await assert.rejects(manager.inspectConnection('local'), /服务可达.*token.*401/);
  assert.equal(protectedCalls - before, 1);
  const kernel = (await manager.publicState()).kernels[0]!;
  await manager.saveKernel({ ...kernel, token: expected });
  assert.deepEqual(await manager.inspectConnection('local'), { apiUrl: `http://127.0.0.1:${address.port}`,
    version: '3.8.6', accessAvailable: true, credentialSent: true, mcpTools: 0 });
  assert.equal(manager.endpoints('local', { query: '/api/query/sql' }).items[0]!.decision, 'allow');
});
