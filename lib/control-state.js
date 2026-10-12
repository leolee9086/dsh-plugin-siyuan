/** 插件自己的配置和活动数据规则；不读取 Harness 上下文或持久化服务。 */
import { normalizeConfig } from "./api.js";
import { EndpointPolicy } from "./policy.js";
const { endpoint } = EndpointPolicy;
const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const validEndpoint = (v) => isRecord(v) && ["http", "mcp", "plugin", "ws", "connection"].includes(v.protocol)
    && ["method", "path", "detail", "description", "key"].every(k => typeof v[k] === "string")
    && v.key === endpoint(v.protocol, v.method, v.path, v.detail).key
    && (v.discoveredFor === undefined || typeof v.discoveredFor === "string");
function validState(v) {
    if (!isRecord(v) || !Number.isSafeInteger(v.revision) || v.revision < 1 || !Array.isArray(v.kernels)
        || !Array.isArray(v.grants) || !Array.isArray(v.endpoints) || !isRecord(v.sessions))
        return false;
    const ids = new Set();
    for (const kernel of v.kernels) {
        if (!isRecord(kernel) || typeof kernel.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(kernel.id)
            || ids.has(kernel.id) || typeof kernel.name !== "string" || !kernel.name.trim() || kernel.name.length > 100
            || typeof kernel.enabled !== "boolean" || "token" in kernel)
            return false;
        try {
            normalizeConfig(kernel);
        }
        catch {
            return false;
        }
        ids.add(kernel.id);
    }
    return (v.defaultKernelId === null || ids.has(v.defaultKernelId))
        && Object.values(v.sessions).every(id => typeof id === "string" && ids.has(id))
        && v.grants.every((g) => isRecord(g) && ids.has(g.kernelId) && typeof g.endpointKey === "string"
            && ["deny", "ask", "allow"].includes(g.decision))
        && v.endpoints.every((e) => validEndpoint(e) && (!e.discoveredFor || ids.has(e.discoveredFor)));
}
const jsonSchema = (check) => ({ parse(value) {
        if (!check(value))
            throw new Error("思源持久记录形状无效");
        return structuredClone(value);
    } });
const DOMAIN_SPEC = {
    name: "siyuan_control", version: 1, layout: "per-record",
    tables: {
        config: { valueSchema: jsonSchema(validState) },
        activity: { valueSchema: jsonSchema(v => isRecord(v)
                && ["id", "sessionId", "callId", "time", "tool", "kernelId", "kernelName"].every(k => typeof v[k] === "string")
                && Number.isFinite(Date.parse(v.time)) && Array.isArray(v.endpoints) && v.endpoints.every(validEndpoint)
                && Array.isArray(v.resources) && v.resources.every((id) => typeof id === "string")
                && ["checking", "awaiting-approval", "running", "succeeded", "failed", "partial", "denied", "uncertain", "sent"].includes(v.status)) },
    },
};
/** 换绑撤权与目录隔离属于数据变换，不需要模拟存储服务才能验证。 */
function revokeBinding(state, kernelId) {
    state.grants = state.grants.filter(grant => grant.kernelId !== kernelId);
    state.endpoints = state.endpoints.filter(item => item.discoveredFor !== kernelId);
}
function replaceDiscovered(state, kernelId, items) {
    const available = new Set(items.map(item => item.key));
    const removed = new Set(state.endpoints.filter(item => item.discoveredFor === kernelId && !available.has(item.key)).map(item => item.key));
    state.endpoints = [...state.endpoints.filter(item => item.discoveredFor !== kernelId), ...items];
    state.grants = state.grants.filter(grant => !(grant.kernelId === kernelId && removed.has(grant.endpointKey)));
}
function recoverActivity(item) {
    if (!["checking", "awaiting-approval", "running"].includes(item.status))
        return item;
    return { ...item, status: item.status === "running" ? "uncertain" : "denied",
        error: item.status === "running" ? "宿主重载中断，结果未确认，请勿重复写入" : "派发前被宿主重载中断" };
}
function targetId(state, explicit, sessionId) {
    return explicit ?? (sessionId ? state.sessions[sessionId] : undefined) ?? state.defaultKernelId;
}
function selectKernel(state, explicit, sessionId) {
    const id = targetId(state, explicit, sessionId);
    if (typeof id !== "string")
        throw new Error("请先选择思源核心");
    const kernel = state.kernels.find(item => item.id === id);
    if (!kernel)
        throw new Error("所选思源核心不存在");
    return kernel;
}
function requireBoundKernel(kernel) {
    if (!kernel.enabled)
        throw new Error("思源核心已停用");
    if (kernel.apiUrl === "auto" && !kernel.kernelPid)
        throw new Error("请先在思源界面检查连接以绑定 PID；核心退出后不会自动换库");
}
function requireRevision(expected, current, closed, message) {
    if (closed || expected !== current)
        throw new Error(message);
}
/** 状态领域唯一入口；宿主适配器和行为测试均通过此入口使用数据规则。 */
export const ControlState = Object.freeze({ DOMAIN_SPEC, revokeBinding, replaceDiscovered, recoverActivity,
    targetId, selectKernel, requireBoundKernel, requireRevision });
