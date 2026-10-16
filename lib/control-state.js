/** 插件自己的配置和活动数据规则；不读取 Harness 上下文或持久化服务。 */
import { normalizeConfig } from "./api.js";
import { z } from "zod";
import { EndpointPolicy } from "./policy.js";
const { endpoint } = EndpointPolicy;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isArray = (value) => Array.isArray(value);
function validEndpoint(value) {
    if (!isRecord(value))
        return false;
    const { protocol, method, path, detail, description, key } = value;
    return (protocol === "http" || protocol === "mcp" || protocol === "plugin" || protocol === "ws" || protocol === "connection")
        && typeof method === "string" && typeof path === "string" && typeof detail === "string"
        && typeof description === "string" && typeof key === "string"
        && key === endpoint(protocol, method, path, detail).key
        && (value.blocked === undefined || typeof value.blocked === "string")
        && (value.discoveredFor === undefined || typeof value.discoveredFor === "string")
        && (value.inputSchema === undefined || isRecord(value.inputSchema) && value.inputSchema.type === "object");
}
function validKernel(value) {
    if (!isRecord(value) || typeof value.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)
        || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100
        || typeof value.enabled !== "boolean" || typeof value.apiUrl !== "string"
        || typeof value.timeoutMs !== "number" || "token" in value)
        return false;
    try {
        normalizeConfig(value);
        return true;
    }
    catch {
        return false;
    }
}
/** 旧配置允许省略连接默认项；把默认项真正写进副本后才校验完整 State。 */
function restoreState(value) {
    if (!isRecord(value) || !isArray(value.kernels))
        return value;
    return { ...value, ruleSessions: value.ruleSessions === undefined ? {} : value.ruleSessions, kernels: value.kernels.map(kernel => {
            if (!isRecord(kernel) || kernel.apiUrl != null && kernel.timeoutMs != null)
                return kernel;
            try {
                const config = normalizeConfig(kernel);
                return { ...kernel, apiUrl: config.apiUrl, timeoutMs: config.timeoutMs };
            }
            catch {
                return kernel;
            }
        }) };
}
function validState(value) {
    if (!isRecord(value) || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1
        || !isArray(value.kernels) || !isArray(value.grants) || !isArray(value.endpoints) || !isRecord(value.sessions) || !isRecord(value.ruleSessions)
        || value.gatewayTools !== undefined && typeof value.gatewayTools !== "boolean")
        return false;
    const ids = new Set();
    for (const kernel of value.kernels) {
        if (!validKernel(kernel) || ids.has(kernel.id))
            return false;
        ids.add(kernel.id);
    }
    return (value.defaultKernelId === null || typeof value.defaultKernelId === "string" && ids.has(value.defaultKernelId))
        && [...Object.values(value.sessions), ...Object.values(value.ruleSessions)].every(id => typeof id === "string" && ids.has(id))
        && value.grants.every(grant => isRecord(grant) && typeof grant.kernelId === "string" && ids.has(grant.kernelId)
            && typeof grant.endpointKey === "string" && EndpointPolicy.decisions.some(decision => decision === grant.decision))
        && value.endpoints.every(item => validEndpoint(item) && (!item.discoveredFor || ids.has(item.discoveredFor)));
}
/** 0.2.2 的错误脱敏已丢失审批明细，只恢复可读取结构并记录这一事实。 */
function restoreActivity(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || !("authorization" in value) || value.authorization !== "[redacted]")
        return value;
    const { authorization: _lost, ...record } = value;
    const previous = "error" in record && typeof record.error === "string" ? record.error : "";
    return { ...record, error: [previous, "旧版错误脱敏导致审批明细丢失，无法恢复"].filter(Boolean).join("；") };
}
function validActivity(value) {
    return isRecord(value)
        && ["id", "sessionId", "callId", "tool", "kernelId", "kernelName"].every(key => typeof value[key] === "string")
        && typeof value.time === "string" && Number.isFinite(Date.parse(value.time))
        && isArray(value.endpoints) && value.endpoints.every(validEndpoint)
        && isArray(value.resources) && value.resources.every(id => typeof id === "string")
        && (value.target === undefined || typeof value.target === "string")
        && (value.error === undefined || typeof value.error === "string")
        && (value.elapsedMs === undefined || typeof value.elapsedMs === "number" && Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0)
        && (value.authorization === undefined || isArray(value.authorization) && value.authorization.every(entry => isRecord(entry) && typeof entry.endpointKey === "string" && typeof entry.decision === "string" && typeof entry.outcome === "string"))
        && typeof value.status === "string"
        && ["checking", "awaiting-approval", "running", "succeeded", "failed", "partial", "denied", "uncertain", "sent"].includes(value.status);
}
// 真实存储域需要 Zod schema；恢复旧记录后再校验，并返回独立副本。
const jsonSchema = (check, normalize = (value) => value) => z.preprocess(normalize, z.custom(check, "思源持久记录形状无效")).transform(value => structuredClone(value));
const DOMAIN_SPEC = {
    name: "siyuan_control", version: 1, layout: "per-record",
    tables: {
        config: { valueSchema: jsonSchema(validState, restoreState) },
        activity: { valueSchema: jsonSchema(validActivity, restoreActivity) },
    },
};
/** 换绑撤权与目录隔离属于数据变换，不需要模拟存储服务才能验证。 */
function revokeBinding(state, kernelId) {
    state.grants = state.grants.filter(grant => grant.kernelId !== kernelId);
    state.endpoints = state.endpoints.filter(item => item.discoveredFor !== kernelId);
}
function replaceDiscovered(state, kernelId, items) {
    if (!isArray(items) || !items.every(validEndpoint))
        throw new Error("思源发现端点形状无效");
    const available = new Set(items.map(item => item.key));
    const removed = new Set(state.endpoints.filter(item => item.discoveredFor === kernelId && !available.has(item.key)).map(item => item.key));
    state.endpoints = [...state.endpoints.filter(item => item.discoveredFor !== kernelId), ...items];
    state.grants = state.grants.filter(grant => !(grant.kernelId === kernelId && removed.has(grant.endpointKey)));
}
function recoverActivity(item) {
    if (!["checking", "awaiting-approval", "running"].includes(item.status))
        return item;
    return { ...item, status: item.status === "running" ? "uncertain" : "denied",
        error: [item.error, item.status === "running" ? "宿主重载中断，结果未确认，请勿重复写入" : "派发前被宿主重载中断"].filter(Boolean).join("；") };
}
function targetId(state, explicit, sessionId) {
    return explicit ?? (sessionId ? state.sessions[sessionId] : undefined) ?? state.defaultKernelId;
}
/** 规则来源只继承全局默认核心，不继承会话操作核心。 */
function ruleTargetId(state, sessionId) {
    return (sessionId ? state.ruleSessions[sessionId] : undefined) ?? state.defaultKernelId;
}
function sessionSelection(state, sessionId) {
    const sessionKernelId = sessionId === undefined ? null : state.sessions[sessionId] ?? null;
    const sessionRuleKernelId = sessionId === undefined ? null : state.ruleSessions[sessionId] ?? null;
    return { sessionKernelId, selectedKernelId: sessionKernelId ?? state.defaultKernelId,
        sessionRuleKernelId, selectedRuleKernelId: ruleTargetId(state, sessionId) };
}
function setSessionKernel(state, sessionId, kernelId, purpose) {
    if (!sessionId)
        throw new Error("请选择会话");
    if (kernelId !== null)
        selectKernel(state, kernelId);
    const selections = purpose === 'operation' ? state.sessions : state.ruleSessions;
    if (kernelId === null)
        delete selections[sessionId];
    else
        selections[sessionId] = kernelId;
}
function kernelDirectory(state, sessionId) {
    return {
        defaultKernelId: state.defaultKernelId,
        ...sessionSelection(state, sessionId),
        kernels: state.kernels.map(({ id, name, enabled, apiUrl, kernelPid }) => ({ id, name, enabled, apiUrl, kernelPid })),
    };
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
/** 首次发现只接受唯一实例；已绑定配置和重新指定地址的撤权由各自入口处理。 */
function bindDiscovered(state, kernelId, instances) {
    const kernel = selectKernel(state, kernelId);
    if (kernel.apiUrl !== "auto" || kernel.kernelPid)
        return;
    if (instances.length !== 1)
        throw new Error(instances.length
            ? "发现多个思源实例，请在思源连接管理界面选择明确的 PID"
            : "未发现有效的思源实例，请启动思源后重试");
    kernel.kernelPid = instances[0].pid;
    // 旧版未绑定配置的授权没有确定目标，首次绑定后也需针对该实例授权。
    revokeBinding(state, kernelId);
}
/** 在派发前重新核对绑定。唯一候选可恢复；多候选由连接管理明确选择。 */
function reconcileBinding(state, kernelId, instances, selectedPid) {
    const kernel = selectKernel(state, kernelId);
    if (kernel.apiUrl !== "auto")
        throw new Error("显式地址无需选择本机实例");
    const current = instances.find(item => item.pid === kernel.kernelPid);
    const selected = selectedPid === undefined ? current ?? (instances.length === 1 ? instances[0] : undefined)
        : instances.find(item => item.pid === selectedPid);
    if (!selected)
        throw new Error(selectedPid !== undefined ? `PID ${selectedPid} 不是当前有效的思源实例`
            : instances.length ? "发现多个思源实例，请刷新实例列表并选择连接目标"
                : "未发现有效的思源实例，请启动思源后重试；连接恢复后会重新发现");
    if (kernel.kernelPid === selected.pid)
        return false;
    kernel.kernelPid = selected.pid;
    // 新进程没有可验证的笔记库身份；沿用核心配置，但重新评估它的端点权限。
    revokeBinding(state, kernelId);
    return true;
}
function requireBoundKernel(kernel) {
    if (!kernel.enabled)
        throw new Error("思源核心已停用");
    if (kernel.apiUrl === "auto" && !kernel.kernelPid)
        throw new Error("自动连接尚未绑定 PID，请在思源连接管理界面检查实例选择");
}
function requireRevision(expected, current, closed, message) {
    if (closed || expected !== current)
        throw new Error(message);
}
/** 状态领域唯一入口；宿主适配器和行为测试均通过此入口使用数据规则。 */
export const ControlState = Object.freeze({ DOMAIN_SPEC, revokeBinding, replaceDiscovered, recoverActivity,
    targetId, ruleTargetId, sessionSelection, setSessionKernel, kernelDirectory, selectKernel, bindDiscovered, reconcileBinding, requireBoundKernel, requireRevision });
