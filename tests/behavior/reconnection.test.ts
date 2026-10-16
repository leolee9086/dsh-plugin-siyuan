import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlState, type State } from '../../lib/control-state.js';

function state(): State {
  return { revision: 1, kernels: [{ id: 'local', name: '本机', enabled: true, apiUrl: 'auto', timeoutMs: 3000, kernelPid: 10 }],
    defaultKernelId: 'local', sessions: { session: 'local' }, ruleSessions: {}, endpoints: [],
    grants: [{ kernelId: 'local', endpointKey: 'endpoint', decision: 'allow' }] };
}

test('存活绑定保持授权，PID退出后唯一候选恢复并可持久化', () => {
  const value = state();
  assert.equal(ControlState.reconcileBinding(value, 'local', [{ pid: 10 }, { pid: 20 }]), false);
  assert.equal(value.grants.length, 1);
  assert.equal(ControlState.reconcileBinding(value, 'local', [{ pid: 20 }]), true);
  assert.equal(value.kernels[0]!.kernelPid, 20);
  assert.deepEqual(value.grants, []);
  const restored = ControlState.DOMAIN_SPEC.tables.config.valueSchema.parse(value);
  assert.equal(restored.kernels[0].kernelPid, 20);
  assert.equal(restored.sessions.session, 'local');
});

test('停机和多候选保留配置；显式选择重新核对候选并撤去旧权限', () => {
  const value = state(), before = structuredClone(value);
  for (const candidates of [[], [{ pid: 20 }, { pid: 30 }]]) {
    assert.throws(() => ControlState.reconcileBinding(value, 'local', candidates), /思源/);
    assert.deepEqual(value, before);
  }
  assert.throws(() => ControlState.reconcileBinding(value, 'local', [{ pid: 20 }], 30), /不是当前有效/);
  assert.deepEqual(value, before);
  assert.equal(ControlState.reconcileBinding(value, 'local', [{ pid: 20 }, { pid: 30 }], 30), true);
  assert.equal(value.kernels[0]!.kernelPid, 30);
  assert.deepEqual(value.grants, []);
});
