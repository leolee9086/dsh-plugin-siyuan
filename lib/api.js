/** 配置和内核信封语义；原始 HTTP 传输位于 http.ts。 */
import path from "node:path";
export class KernelError extends Error {
    endpoint;
    code;
    constructor(endpoint, code, message) {
        super(`${endpoint} 被内核拒绝（code=${code}）：${message}`);
        this.endpoint = endpoint;
        this.code = code;
        this.name = "KernelError";
    }
}
/** 明确的 HTTP 访问拒绝；不携带响应正文、状态文本或请求凭据。 */
export class KernelAccessError extends Error {
    status;
    retryAfterSeconds;
    constructor(status, retryAfter) {
        super(status === 401 ? "思源 HTTP 访问未通过认证（401）"
            : status === 403 ? "思源 HTTP 访问被权限策略拒绝（403）" : "思源 HTTP 访问受到限流（429）");
        this.status = status;
        this.name = "KernelAccessError";
        if (retryAfter) {
            const seconds = /^\d+$/.test(retryAfter) ? Number(retryAfter) : Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000);
            if (Number.isSafeInteger(seconds))
                this.retryAfterSeconds = Math.max(0, seconds);
        }
    }
    static pauseFor(error) {
        if (!(error instanceof KernelAccessError))
            return;
        const reason = error.status === 429 ? "rate-limit" : error.status === 403 ? "permission" : "authentication";
        const wait = error.retryAfterSeconds === undefined ? "" : `；Retry-After ${error.retryAfterSeconds} 秒`;
        return { reason, retryAfterSeconds: error.retryAfterSeconds,
            message: `${error.message}${wait}；已暂停提醒读取和自动重连，请检查核心认证、权限及代理，更新连接配置后恢复` };
    }
}
export function normalizeConfig(raw) {
    if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) {
        throw new TypeError("插件配置必须为对象");
    }
    const input = (raw ?? {});
    const suppliedUrl = input.apiUrl ?? "auto";
    if (typeof suppliedUrl !== "string")
        throw new TypeError("apiUrl 必须为字符串");
    let apiUrl = suppliedUrl;
    if (apiUrl !== "auto") {
        const url = new URL(apiUrl);
        if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
            throw new Error("apiUrl 必须为 auto 或不含凭据、查询和片段的 HTTP(S) 地址");
        }
        apiUrl = url.href.replace(/\/$/, "");
    }
    const { portFile, kernelPid } = input;
    if (portFile !== undefined && (typeof portFile !== "string" || !path.isAbsolute(portFile))) {
        throw new TypeError("portFile 必须为端口文件的绝对路径");
    }
    if (kernelPid !== undefined && (typeof kernelPid !== "number" || !Number.isSafeInteger(kernelPid)
        || kernelPid <= 0 || kernelPid > 2147483647)) {
        throw new TypeError("kernelPid 必须为正整数 PID");
    }
    const token = input.token ?? "";
    if (typeof token !== "string" || /[\r\n]/.test(token))
        throw new TypeError("token 必须为单行字符串");
    const timeoutMs = input.timeoutMs ?? 15000;
    if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        throw new TypeError("timeoutMs 必须为正整数");
    }
    return { apiUrl, token: token.trim(), timeoutMs,
        ...(portFile === undefined ? {} : { portFile: portFile }),
        ...(kernelPid === undefined ? {} : { kernelPid: kernelPid }) };
}
/** 只供采用 {code,msg,data} 的接口使用；RPC、文件、MCP 保留各自响应协议。 */
export async function callKernel(connection, endpoint, payload = {}, signal) {
    const response = await connection.json(endpoint, payload, signal);
    if (!response.ok) {
        const { status } = response;
        const retryAfter = response.headers.get("retry-after");
        await response.body?.cancel();
        if (status === 401 || status === 403 || status === 429)
            throw new KernelAccessError(status, retryAfter);
        throw new Error(`${endpoint} 返回 HTTP ${status} ${response.statusText}`);
    }
    const envelope = await response.json();
    if (!envelope || typeof envelope.code !== "number")
        throw new Error(`${endpoint} 响应缺少内核 code`);
    if (envelope.code !== 0)
        throw new KernelError(endpoint, envelope.code, envelope.msg);
    return envelope.data;
}
