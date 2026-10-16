import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlState } from '../../lib/control-state.js';

const config = ControlState.DOMAIN_SPEC.tables.config.valueSchema;
const legacy = () => ({ revision: 1,
  kernels: ['local', 'work'].map(id => ({ id, name: id, enabled: true, apiUrl: 'http://127.0.0.1:6806', timeoutMs: 15000 })),
  defaultKernelId: 'local', sessions: { session: 'work' }, grants: [], endpoints: [] });

test('旧会话保留操作选择，规则来源独立继承全局默认核心', () => {
  const input = legacy(), state = config.parse(input);
  assert.deepEqual(state.sessions, input.sessions);
  assert.deepEqual(state.ruleSessions, {});
  assert.equal('ruleSessions' in input, false);
  assert.equal(ControlState.targetId(state, undefined, 'session'), 'work');
  assert.equal(ControlState.ruleTargetId(state, 'session'), 'local');
  assert.deepEqual(ControlState.sessionSelection(state, 'session'), {
    sessionKernelId: 'work', selectedKernelId: 'work', sessionRuleKernelId: null, selectedRuleKernelId: 'local',
  });
});

test('两个选择独立修改与清除，显式操作目标只影响本次调用', () => {
  const state = config.parse(legacy());
  ControlState.setSessionKernel(state, 'session', 'work', 'rules');
  ControlState.setSessionKernel(state, 'session', 'local', 'operation');
  assert.equal(ControlState.ruleTargetId(state, 'session'), 'work');
  assert.equal(ControlState.targetId(state, undefined, 'session'), 'local');
  assert.equal(ControlState.targetId(state, 'work', 'session'), 'work');
  assert.equal(ControlState.targetId(state, undefined, 'session'), 'local');
  ControlState.setSessionKernel(state, 'session', null, 'rules');
  assert.equal(ControlState.ruleTargetId(state, 'session'), 'local');
  state.defaultKernelId = 'work';
  assert.equal(ControlState.ruleTargetId(state, 'session'), 'work');
  assert.equal(ControlState.targetId(state, undefined, 'session'), 'local');
  ControlState.setSessionKernel(state, 'session', null, 'operation');
  assert.equal(ControlState.targetId(state, undefined, 'session'), 'work');
  assert.deepEqual(config.parse(state), state);
});

test('未配置全局默认时没有隐式来源，损坏规则选择拒绝恢复', () => {
  const state = config.parse({ ...legacy(), defaultKernelId: null });
  assert.equal(ControlState.ruleTargetId(state, 'session'), null);
  assert.equal(ControlState.targetId(state, undefined, 'session'), 'work');
  ControlState.setSessionKernel(state, 'session', 'local', 'rules');
  assert.equal(ControlState.ruleTargetId(state, 'session'), 'local');
  assert.throws(() => ControlState.setSessionKernel(state, 'session', 'missing', 'rules'), /不存在/);
  for (const ruleSessions of [null, [], { session: 'missing' }, { session: 42 }]) {
    assert.throws(() => config.parse({ ...legacy(), ruleSessions }), /形状无效/);
  }
});
