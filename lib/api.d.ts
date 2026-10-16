export interface ApiConfig {
    /** auto 按思源本机登记发现；HTTP(S) 地址优先使用明确配置。 */
    apiUrl: string;
    token: string;
    timeoutMs: number;
    portFile?: string;
    kernelPid?: number;
}
export interface Envelope<T> {
    code: number;
    msg: string;
    data: T;
}
export declare class KernelError extends Error {
    readonly endpoint: string;
    readonly code: number;
    constructor(endpoint: string, code: number, message: string);
}
/** 明确的 HTTP 访问拒绝；不携带响应正文、状态文本或请求凭据。 */
export declare class KernelAccessError extends Error {
    readonly status: 401 | 403 | 429;
    readonly retryAfterSeconds?: number;
    constructor(status: 401 | 403 | 429, retryAfter: string | null);
    static pauseFor(error: unknown): {
        reason: "rate-limit" | "permission" | "authentication";
        retryAfterSeconds: number | undefined;
        message: string;
    } | undefined;
}
export declare function normalizeConfig(raw: unknown): ApiConfig;
export interface KernelCaller {
    json(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<Response>;
}
/** 只供采用 {code,msg,data} 的接口使用；RPC、文件、MCP 保留各自响应协议。 */
export declare function callKernel<T = unknown>(connection: KernelCaller, endpoint: string, payload?: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
