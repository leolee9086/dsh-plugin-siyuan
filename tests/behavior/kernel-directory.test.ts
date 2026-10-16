import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KernelManager, managedTools, type Domain } from '../../lib/manager.js';

// 注入插件自己的存储/凭据端口，所有行为均通过生产管理器入口执行。
function memoryDomain() {
  const tables = new Map<string, Map<string, unknown>>();
  return { table(name: string) {
    let values = tables.get(name);
    if (!values) { values = new Map<string, unknown>(); tables.set(name, values); }
    const table = values;
    return { get: (key: string) => structuredClone(table.get(key)),
      put: async (key: string, value: unknown) => { table.set(key, structuredClone(value)); },
      entries: () => table.entries() };
  }, async close() {} } satisfies Domain;
}

async function setup(t: TestContext) {
  const domain = memoryDomain();
  const secrets = new Map<string, string>();
  const access = { available: true, resolves: 0, descriptions: 0 };
  const manager = new KernelManager(domain, {
    async resolve(ref) {
      access.resolves++;
      if (!access.available) throw new Error('credential service offline');
      const value = secrets.get(ref);
      return value === undefined ? undefined : { value };
    },
    async describe(ref) { access.descriptions++; return { configured: secrets.has(ref), writable: true }; },
    async set(ref, value) { secrets.set(ref, value); },
    async unset(ref) { secrets.delete(ref); },
  }, async () => assert.fail('目录请求不应派发业务调用'), async () => assert.fail('目录请求不应申请端点审批'));
  t.after(() => manager.close());
  // 不存在的端口登记文件可检出意外的本机发现；目录不需要有效的 PID。
  await manager.initialize({ apiUrl: 'auto', kernelPid: 12345,
    portFile: join(tmpdir(), 'siyuan-directory-unread-port.json'), token: 'directory-fixture-secret' });
  const directory = managedTools(manager, []).find(tool => tool.name === 'siyuan_kernels');
  assert.ok(directory);
  return { manager, directory, access, domain };
}

const calling = (sessionId: string) => ({ sessionId });

function decode(output: { summary: string }): unknown { return JSON.parse(output.summary); }

test('核心目录列出启用和停用核心，默认选择与会话覆盖相互独立', async t => {
  const { manager, directory } = await setup(t);
  const other = await manager.saveKernel({ name: '远程笔记', apiUrl: 'http://127.0.0.1:1', enabled: false });
  await manager.select(other.id, 'current-session');
  await manager.select('local', 'private-other-session');
  const output = await directory.execute({}, calling('current-session'));
  const expected = {
    defaultKernelId: 'local', sessionKernelId: other.id, selectedKernelId: other.id,
    sessionRuleKernelId: null, selectedRuleKernelId: 'local',
    kernels: [
      { id: 'local', name: '本机思源', enabled: true, apiUrl: 'auto', kernelPid: 12345 },
      { id: other.id, name: '远程笔记', enabled: false, apiUrl: 'http://127.0.0.1:1' },
    ],
  };
  assert.deepEqual(decode(output), expected);
  assert.equal(output.summary.includes('private-other-session'), false);
  assert.deepEqual(decode(await directory.execute({}, calling('new-session'))),
    { ...expected, sessionKernelId: null, selectedKernelId: 'local' });
  assert.deepEqual(decode(await manager.invoke('siyuan_kernels', {})),
    decode(await directory.execute({}, calling('new-session'))));
});

test('规则来源独立于操作选择，修改全局默认后未覆盖的会话随之切换', async t => {
  const { manager } = await setup(t);
  const other = await manager.saveKernel({ name: '工作笔记', apiUrl: 'http://127.0.0.1:1', enabled: true });
  await manager.select(other.id, 'session');
  assert.equal(manager.acceptsReminder('local', 'session'), true);
  assert.equal(manager.acceptsReminder(other.id, 'session'), false);
  await manager.selectRuleSource(other.id, 'session');
  await manager.select('local', 'session');
  assert.equal(manager.acceptsReminder(other.id, 'session'), true);
  assert.equal(manager.acceptsReminder('local', 'session'), false);
  await manager.selectRuleSource(null, 'session');
  assert.equal(manager.acceptsReminder('local', 'session'), true);
  await manager.select(other.id);
  assert.equal(manager.acceptsReminder(other.id, 'session'), true);
  assert.equal(manager.acceptsReminder(other.id, 'new-session'), true);
});

test('无默认核心和空配置均能读取目录，删除核心会清除当前选择', async t => {
  const { manager, directory } = await setup(t);
  await manager.select(null);
  const unselected = decode(await directory.execute({}));
  assert.deepEqual(unselected, {
    defaultKernelId: null, sessionKernelId: null, selectedKernelId: null, sessionRuleKernelId: null, selectedRuleKernelId: null,
    kernels: [{ id: 'local', name: '本机思源', enabled: true, apiUrl: 'auto', kernelPid: 12345 }],
  });
  await manager.select('local', 'current-session');
  await manager.selectRuleSource('local', 'current-session');
  assert.equal(manager.acceptsReminder('local', 'current-session'), true);
  await manager.removeKernel('local');
  assert.equal(manager.acceptsReminder('local', 'current-session'), false);
  assert.deepEqual(decode(await directory.execute({}, calling('current-session'))), {
    defaultKernelId: null, sessionKernelId: null, selectedKernelId: null, sessionRuleKernelId: null, selectedRuleKernelId: null, kernels: [],
  });
});

test('目录在凭据服务离线时仍可用，不发网络请求、不改变配置或活动', async t => {
  const { directory, domain, access } = await setup(t);
  t.mock.method(globalThis, 'fetch', async () => assert.fail('目录请求不应访问网络'));
  access.available = false;
  const before = { ...access };
  const stored = structuredClone(domain.table('config').get('state'));
  await directory.execute({}, calling('current-session'));
  assert.deepEqual(access, before);
  assert.deepEqual(domain.table('config').get('state'), stored);
  assert.deepEqual([...domain.table('activity').entries()], []);
});

test('目录只投影公开字段并复用已登记的凭据过滤', async t => {
  const { manager, directory } = await setup(t);
  await manager.saveKernel({ id: 'local', name: '笔记 directory-fixture-secret',
    apiUrl: 'auto', portFile: join(tmpdir(), 'private-port-file.json') });
  const output = await directory.execute({});
  assert.deepEqual(decode(output), {
    defaultKernelId: 'local', sessionKernelId: null, selectedKernelId: 'local', sessionRuleKernelId: null, selectedRuleKernelId: 'local',
    kernels: [{ id: 'local', name: '笔记 [redacted]', enabled: true, apiUrl: 'auto' }],
  });
  for (const privateText of ['directory-fixture-secret', 'DSH_SIYUAN_LOCAL', 'portFile', 'credential', 'timeoutMs']) {
    assert.equal(output.summary.includes(privateText), false, privateText);
  }
});

test('目录拒绝指定核心或伪造会话的参数，工具和公共服务使用同一校验', async t => {
  const { manager, directory } = await setup(t);
  for (const args of [{ kernelId: 'local' }, { sessionId: 'another-session' }, { action: 'select' }]) {
    await assert.rejects(directory.execute(args), /参数不合法/);
    await assert.rejects(manager.invoke('siyuan_kernels', args), /参数不合法/);
  }
});

test('目录遵守调用取消和管理器卸载', async t => {
  const { manager, directory } = await setup(t);
  const signal = AbortSignal.abort(new Error('directory cancelled'));
  await assert.rejects(directory.execute({}, { signal }), /directory cancelled/);
  await assert.rejects(manager.invoke('siyuan_kernels', {}, { signal }), /directory cancelled/);
  await manager.close();
  await assert.rejects(directory.execute({}), /已卸载/);
});
