/** 插件自己的配置和活动数据规则；不读取 Harness 上下文或持久化服务。 */
import { normalizeConfig } from "./api.js";
import { EndpointPolicy, type Endpoint, type Grant } from "./policy.js";
const { endpoint } = EndpointPolicy;

export interface Kernel {
  id: string; name: string; apiUrl: string; timeoutMs: number; portFile?: string; kernelPid?: number; enabled: boolean;
}
export interface State {
  revision: number; kernels: Kernel[]; defaultKernelId: string | null;
  grants: Grant[]; endpoints: Endpoint[]; sessions: Record<string, string>;
  gatewayTools?: boolean;
}
export interface Activity {
  id: string; sessionId: string; callId: string; time: string; tool: string; kernelId: string; kernelName: string;
  target?: string; endpoints: Endpoint[]; resources: string[]; status: string; elapsedMs?: number; error?: string;
  authorization?: { endpointKey: string; decision: string; outcome: string }[];
}
const isRecord = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);
const validEndpoint = (v: any) => isRecord(v) && ["http", "mcp", "plugin", "ws", "connection"].includes(v.protocol)
  && ["method", "path", "detail", "description", "key"].every(k => typeof v[k] === "string")
  && v.key === endpoint(v.protocol, v.method, v.path, v.detail).key
  && (v.discoveredFor === undefined || typeof v.discoveredFor === "string")
  && (v.inputSchema === undefined || isRecord(v.inputSchema) && v.inputSchema.type === "object");
function validState(v: any): boolean {
  if (!isRecord(v) || !Number.isSafeInteger(v.revision) || v.revision < 1 || !Array.isArray(v.kernels)
    || !Array.isArray(v.grants) || !Array.isArray(v.endpoints) || !isRecord(v.sessions)
    || v.gatewayTools !== undefined && typeof v.gatewayTools !== "boolean") return false;
  const ids = new Set<string>();
  for (const kernel of v.kernels) {
    if (!isRecord(kernel) || typeof kernel.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(kernel.id)
      || ids.has(kernel.id) || typeof kernel.name !== "string" || !kernel.name.trim() || kernel.name.length > 100
      || typeof kernel.enabled !== "boolean" || "token" in kernel) return false;
    try { normalizeConfig(kernel); } catch { return false; }
    ids.add(kernel.id);
  }
  return (v.defaultKernelId === null || ids.has(v.defaultKernelId))
    && Object.values(v.sessions).every(id => typeof id === "string" && ids.has(id))
    && v.grants.every((g: any) => isRecord(g) && ids.has(g.kernelId) && typeof g.endpointKey === "string"
      && EndpointPolicy.decisions.includes(g.decision))
    && v.endpoints.every((e: any) => validEndpoint(e) && (!e.discoveredFor || ids.has(e.discoveredFor)));
}
/** 0.2.2 的错误脱敏已丢失审批明细，只恢复可读取结构并记录这一事实。 */
function restoreActivity(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !("authorization" in value) || value.authorization !== "[redacted]") return value;
  const { authorization: _lost, ...record } = value;
  const previous = "error" in record && typeof record.error === "string" ? record.error : "";
  return { ...record, error: [previous, "旧版错误脱敏导致审批明细丢失，无法恢复"].filter(Boolean).join("；") };
}
const jsonSchema = (check: (value: any) => boolean, normalize = (value: unknown) => value) => ({ parse(value: any) {
  value = normalize(value);
  if (!check(value)) throw new Error("思源持久记录形状无效");
  return structuredClone(value);
} });
const DOMAIN_SPEC = {
  name: "siyuan_control", version: 1, layout: "per-record",
  tables: {
    config: { valueSchema: jsonSchema(validState) },
    activity: { valueSchema: jsonSchema(v => isRecord(v)
      && ["id", "sessionId", "callId", "time", "tool", "kernelId", "kernelName"].every(k => typeof v[k] === "string")
      && Number.isFinite(Date.parse(v.time)) && Array.isArray(v.endpoints) && v.endpoints.every(validEndpoint)
      && Array.isArray(v.resources) && v.resources.every((id: any) => typeof id === "string")
      && (v.authorization === undefined || Array.isArray(v.authorization) && v.authorization.every((entry: unknown) =>
        entry !== null && typeof entry === "object" && "endpointKey" in entry && typeof entry.endpointKey === "string"
        && "decision" in entry && typeof entry.decision === "string" && "outcome" in entry && typeof entry.outcome === "string"))
      && ["checking", "awaiting-approval", "running", "succeeded", "failed", "partial", "denied", "uncertain", "sent"].includes(v.status), restoreActivity) },
  },
};

/** 换绑撤权与目录隔离属于数据变换，不需要模拟存储服务才能验证。 */
function revokeBinding(state: State, kernelId: string): void {
  state.grants = state.grants.filter(grant => grant.kernelId !== kernelId);
  state.endpoints = state.endpoints.filter(item => item.discoveredFor !== kernelId);
}
function replaceDiscovered(state: State, kernelId: string, items: Endpoint[]): void {
  const available = new Set(items.map(item => item.key));
  const removed = new Set(state.endpoints.filter(item => item.discoveredFor === kernelId && !available.has(item.key)).map(item => item.key));
  state.endpoints = [...state.endpoints.filter(item => item.discoveredFor !== kernelId), ...items];
  state.grants = state.grants.filter(grant => !(grant.kernelId === kernelId && removed.has(grant.endpointKey)));
}
function recoverActivity(item: Activity): Activity {
  if (!["checking", "awaiting-approval", "running"].includes(item.status)) return item;
  return { ...item, status: item.status === "running" ? "uncertain" : "denied",
    error: [item.error, item.status === "running" ? "宿主重载中断，结果未确认，请勿重复写入" : "派发前被宿主重载中断"].filter(Boolean).join("；") };
}
function targetId(state: State, explicit: unknown, sessionId?: string): unknown {
  return explicit ?? (sessionId ? state.sessions[sessionId] : undefined) ?? state.defaultKernelId;
}
function selectKernel(state: State, explicit: unknown, sessionId?: string): Kernel {
  const id = targetId(state, explicit, sessionId);
  if (typeof id !== "string") throw new Error("请先选择思源核心");
  const kernel = state.kernels.find(item => item.id === id);
  if (!kernel) throw new Error("所选思源核心不存在");
  return kernel;
}
/** 首次发现只接受唯一实例；已绑定配置和重新指定地址的撤权由各自入口处理。 */
function bindDiscovered(state: State, kernelId: string, instances: { pid: number }[]) {
  const kernel = selectKernel(state, kernelId);
  if (kernel.apiUrl !== "auto" || kernel.kernelPid) return;
  if (instances.length !== 1) throw new Error(instances.length
    ? "发现多个思源实例，请在思源连接管理界面选择明确的 PID"
    : "未发现有效的思源实例，请启动思源后重试");
  kernel.kernelPid = instances[0]!.pid;
  // 旧版未绑定配置的授权没有确定目标，首次绑定后也需针对该实例授权。
  revokeBinding(state, kernelId);
}
function requireBoundKernel(kernel: Kernel): void {
  if (!kernel.enabled) throw new Error("思源核心已停用");
  if (kernel.apiUrl === "auto" && !kernel.kernelPid) throw new Error("自动连接尚未绑定 PID，请在思源连接管理界面检查实例选择");
}
function requireRevision(expected: number, current: number, closed: boolean, message: string): void {
  if (closed || expected !== current) throw new Error(message);
}

/** 状态领域唯一入口；宿主适配器和行为测试均通过此入口使用数据规则。 */
export const ControlState = Object.freeze({ DOMAIN_SPEC, revokeBinding, replaceDiscovered, recoverActivity,
  targetId, selectKernel, bindDiscovered, requireBoundKernel, requireRevision });
