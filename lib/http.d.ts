/** 思源 HTTP 转发。标准方法用 fetch，受 Fetch 规范限制的方法用 Node HTTP。 */
import * as http from "node:http";
import type { Duplex } from "node:stream";
import type { ApiConfig } from "./api.js";
import { Contract, type EndpointSpec } from "./contract.js";
import { KernelDiscovery } from "./discovery.js";
export interface HttpOptions {
    method?: string;
    headers?: HeadersInit;
    body?: BodyInit | null;
    signal?: AbortSignal;
    /** 0 表示由调用者管理长连接期限。 */
    timeoutMs?: number;
    validate?: boolean;
}
export interface Tunnel {
    socket: Duplex;
    head: Buffer;
    status: number;
    headers: http.IncomingHttpHeaders;
}
export declare class HttpConnection {
    readonly config: ApiConfig;
    readonly contract: Contract;
    readonly discovery: KernelDiscovery;
    private resolvedEndpoint?;
    private readonly lifetime;
    private readonly router;
    private readonly tunnels;
    constructor(config: ApiConfig, contract?: Contract);
    /** 同步组合路径；auto 的新网络操作使用 resolveUrl 或 bindFetch 重新发现。 */
    url(path: string, endpoint?: string | undefined): URL;
    endpoint(signal?: AbortSignal): Promise<string>;
    resolveUrl(path: string, signal?: AbortSignal): Promise<URL>;
    /** MCP 等会话在初始化时捕获目标，后续请求和清理都不能迁移到另一个内核。 */
    bindFetch(signal?: AbortSignal): Promise<{
        url: (path: string) => URL;
        fetch: (input: RequestInfo | URL, init?: RequestInit, options?: HttpOptions) => Promise<Response>;
    }>;
    headers(input?: HeadersInit): Headers;
    signal(signal?: AbortSignal, timeoutMs?: number): AbortSignal;
    /** 原始 fetch 的 URL 必须属于这次解析的内核；会话消费者使用 bindFetch 固定目标。 */
    fetch: (input: RequestInfo | URL, init?: RequestInit, options?: HttpOptions) => Promise<Response>;
    private fetchAt;
    request(path: string, options?: HttpOptions): Promise<Response>;
    json(path: string, payload: unknown, signal?: AbortSignal): Promise<Response>;
    /** 契约发现复用同一组路由闭包；不会维护另一份路径表。 */
    describe(method: string, path: string): Promise<{
        spec?: EndpointSpec;
        params: Record<string, string>;
    }>;
    private validateRaw;
    private validate;
    private send;
    private nodeRequest;
    /** 真正的 CONNECT 返回套接字和已收到的首段字节，不伪装成 fetch Response。 */
    openTunnel(path: string, options?: Omit<HttpOptions, "method" | "body">): Promise<Tunnel>;
    dispose(): void;
}
