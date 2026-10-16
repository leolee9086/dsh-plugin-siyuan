import test from "node:test";
import assert from "node:assert/strict";
import { ControlState } from "../../lib/control-state.js";
import { EndpointPolicy } from "../../lib/policy.js";

const config = ControlState.DOMAIN_SPEC.tables.config.valueSchema;
const activity = ControlState.DOMAIN_SPEC.tables.activity.valueSchema;
const kernel = { id: "local", name: "本机", enabled: true, apiUrl: "auto", timeoutMs: 15000 };
const endpoint = EndpointPolicy.endpoint("http", "POST", "/api/block/getBlockKramdown");
function state(kernels: unknown[] = [kernel]) {
  return { revision: 1, kernels, defaultKernelId: "local", grants: [], endpoints: [endpoint], sessions: {} };
}
function row() {
  return { id: "operation", sessionId: "session", callId: "call", time: "2026-10-15T15:30:00Z",
    tool: "siyuan_query", kernelId: "local", kernelName: "本机", status: "succeeded", endpoints: [endpoint], resources: [] };
}

test("旧状态缺少连接默认项时生成完整副本，不改变原记录", () => {
  const legacy = { id: "local", name: "本机", enabled: true };
  for (const input of [legacy, { ...legacy, apiUrl: null, timeoutMs: null }, { ...legacy, apiUrl: "auto" },
    { ...legacy, timeoutMs: 2500 }]) {
    const original = state([input]);
    const before = structuredClone(original);
    const parsed = config.parse(original);
    assert.equal(parsed.kernels[0]?.apiUrl, "auto");
    assert.equal(parsed.kernels[0]?.timeoutMs, "timeoutMs" in input && typeof input.timeoutMs === "number" ? input.timeoutMs : 15000);
    assert.deepEqual(original, before);
    assert.notEqual(parsed.kernels[0], input);
  }
});

test("完整状态保留连接字段和可选值，拒绝错误类型与凭据", () => {
  const complete = state([{ ...kernel, apiUrl: "http://127.0.0.1:6806/", kernelPid: 42 }]);
  assert.deepEqual(config.parse(complete), complete);
  for (const patch of [{ apiUrl: false }, { timeoutMs: "15000" }, { timeoutMs: 0 }, { kernelPid: "42" },
    { kernelPid: -1 }, { portFile: 42 }, { token: "synthetic-only-token" }, { enabled: 1 }]) {
    assert.throws(() => config.parse(state([{ ...kernel, ...patch }])), /形状无效/);
  }
  assert.throws(() => config.parse({ ...state(), revision: "1" }), /形状无效/);
  assert.throws(() => config.parse({ ...state(), gatewayTools: "true" }), /形状无效/);
});

test("状态和活动统一校验端点的可选字段与协议", () => {
  const complete = { ...endpoint, blocked: "策略禁止", discoveredFor: "local", inputSchema: { type: "object", properties: {} } };
  assert.deepEqual(config.parse({ ...state(), endpoints: [complete] }).endpoints, [complete]);
  for (const patch of [{ blocked: 42 }, { discoveredFor: false }, { inputSchema: [] }, { inputSchema: { type: "array" } },
    { protocol: "ftp" }, { method: 1 }, { description: null }, { key: "mismatch" }]) {
    const endpoints = [{ ...endpoint, ...patch }];
    assert.throws(() => config.parse({ ...state(), endpoints }), /形状无效/);
    assert.throws(() => activity.parse({ ...row(), endpoints }), /形状无效/);
  }
});

test("活动记录接受完整可选字段并深拷贝审批明细", () => {
  const input = { ...row(), target: "http://127.0.0.1:6806", error: "", elapsedMs: 0,
    authorization: [{ endpointKey: endpoint.key, decision: "ask", outcome: "allowed-once" }] };
  const parsed = activity.parse(input);
  assert.deepEqual(parsed, input);
  assert.notEqual(parsed.authorization, input.authorization);
  assert.notEqual(parsed.endpoints[0], input.endpoints[0]);
});

test("活动记录拒绝错误可选字段及非有限耗时", () => {
  for (const patch of [{ target: 42 }, { error: {} }, { elapsedMs: "1" }, { elapsedMs: -1 }, { elapsedMs: NaN },
    { elapsedMs: Infinity }, { authorization: [{}] }, { resources: [42] }, { status: "unknown" }, { time: 42 }]) {
    assert.throws(() => activity.parse({ ...row(), ...patch }), /形状无效/);
  }
});

test("旧版已遮罩审批记录恢复为可读取活动并保留损失说明", () => {
  const input = { ...row(), authorization: "[redacted]", error: "旧错误" };
  const parsed = activity.parse(input);
  assert.equal(parsed.authorization, undefined);
  assert.match(parsed.error ?? "", /旧错误；旧版错误脱敏导致审批明细丢失/);
  assert.equal(input.authorization, "[redacted]");
});
