import test from "node:test";
import assert from "node:assert/strict";
import { ControlState as rules } from "../../lib/control-state.js";
import { EndpointPolicy } from "../../lib/policy.js";

function state() {
  return { revision: 1, kernels: ["local", "other"].map(id => ({ id, name: id, enabled: true, apiUrl: "http://127.0.0.1:6806", timeoutMs: 15000 })),
    defaultKernelId: "local", sessions: { "session-1": "other" }, ruleSessions: {}, grants: [], endpoints: [] };
}
const discovered = (kernelId, name) => ({ ...EndpointPolicy.endpoint("mcp", "tools/call", "", name), discoveredFor: kernelId });
const grant = (item, kernelId = "local") => ({ kernelId, endpointKey: item.key, decision: "allow" });

test("核心目标遵循显式参数、会话、默认顺序，无效目标不换库", () => {
  const value = state();
  assert.equal(rules.selectKernel(value, "local", "session-1").id, "local");
  assert.equal(rules.selectKernel(value, undefined, "session-1").id, "other");
  assert.equal(rules.selectKernel(value, undefined, "new-session").id, "local");
  assert.throws(() => rules.selectKernel(value, "missing", "session-1"), /不存在/);
  value.defaultKernelId = null; assert.throws(() => rules.selectKernel(value, undefined), /选择/);
});

test("换绑撤去本核心授权和发现目录，保留其他核心与人工声明", () => {
  const value = state(); const local = discovered("local", "echo"), other = discovered("other", "echo");
  const declared = EndpointPolicy.endpoint("plugin", "custom");
  value.endpoints = [local, other, declared]; value.grants = [grant(local), grant(other, "other")];
  rules.revokeBinding(value, "local");
  assert.deepEqual(value.endpoints, [other, declared]); assert.deepEqual(value.grants, [grant(other, "other")]);
});

test("MCP 目录更新只撤去本核心消失工具的授权，新工具仍未授权", () => {
  const value = state(); const old = discovered("local", "old"), keep = discovered("local", "keep"), other = discovered("other", "old");
  value.endpoints = [old, keep, other]; value.grants = [grant(old), grant(keep), grant(other, "other")];
  const added = discovered("local", "new"); rules.replaceDiscovered(value, "local", [keep, added]);
  assert.deepEqual(value.endpoints, [other, keep, added]);
  assert.deepEqual(value.grants, [grant(keep), grant(other, "other")]);
});

test("中断恢复只改变未结算记录，原记录保持不变", () => {
  const base = { id: "op", sessionId: "session-1", callId: "call", time: "2026-10-12T03:00:00Z", tool: "siyuan_query",
    kernelId: "local", kernelName: "本机", endpoints: [], resources: [] };
  for (const status of ["checking", "awaiting-approval", "running"]) {
    const row = { ...base, status }; const recovered = rules.recoverActivity(row);
    assert.equal(recovered.status, status === "running" ? "uncertain" : "denied"); assert.equal(row.status, status);
  }
  for (const status of ["succeeded", "failed", "partial", "denied", "uncertain", "sent"]) {
    const row = { ...base, status }; assert.equal(rules.recoverActivity(row), row);
  }
});

test("未绑定自动核心、停用核心与过期配置在行为规则中拒绝", () => {
  const kernel = state().kernels[0];
  assert.throws(() => rules.requireBoundKernel({ ...kernel, apiUrl: "auto" }), /绑定 PID/);
  assert.throws(() => rules.requireBoundKernel({ ...kernel, enabled: false }), /停用/);
  rules.requireBoundKernel({ ...kernel, apiUrl: "auto", kernelPid: 42 });
  rules.requireRevision(1, 1, false, "配置变化");
  assert.throws(() => rules.requireRevision(1, 2, false, "配置变化"), /配置变化/);
  assert.throws(() => rules.requireRevision(1, 1, true, "已卸载"), /已卸载/);
});

test("首次绑定唯一实例撤去未绑定授权，多实例与空目录保留原配置", () => {
  const value = state(); value.kernels[0].apiUrl = "auto";
  value.grants = [grant(discovered("local", "echo"))];
  for (const instances of [[], [{ pid: 10 }, { pid: 20 }]]) {
    const before = structuredClone(value);
    assert.throws(() => rules.bindDiscovered(value, "local", instances), /思源/);
    assert.deepEqual(value, before);
  }
  rules.bindDiscovered(value, "local", [{ pid: 10 }]);
  assert.equal(value.kernels[0].kernelPid, 10); assert.deepEqual(value.grants, []);
  value.grants = [grant(discovered("local", "echo"))];
  rules.bindDiscovered(value, "local", [{ pid: 20 }]);
  assert.equal(value.kernels[0].kernelPid, 10); assert.equal(value.grants.length, 1);
});

test("端点策略持久化保留两种询问以及已有的拒绝与允许", () => {
  const value = state();
  value.grants = ["ask", "ask-full-access", "deny", "allow"].map((decision, index) => ({ kernelId: "local", endpointKey: `endpoint-${index}`, decision }));
  assert.deepEqual(rules.DOMAIN_SPEC.tables.config.valueSchema.parse(value).grants, value.grants);
});

test("损坏配置拒绝解析，不替换成默认授权", () => {
  const schema = rules.DOMAIN_SPEC.tables.config.valueSchema;
  const good = state(); assert.deepEqual(schema.parse(good), good); assert.notEqual(schema.parse(good), good);
  const changes = [
    value => { value.grants = [{ kernelId: "local", endpointKey: "bad", decision: "unexpected" }]; },
    value => { value.kernels[0].token = "fixture-only-secret"; },
    value => { value.kernels.push({ ...value.kernels[0] }); },
    value => { value.defaultKernelId = "missing"; },
    value => { value.sessions["session-1"] = "missing"; },
    value => { value.endpoints = [{ ...discovered("local", "echo"), key: "wrong" }]; },
  ];
  for (const change of changes) { const value = state(); change(value); assert.throws(() => schema.parse(value), /形状无效/); }
});
