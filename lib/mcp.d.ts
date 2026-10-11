/** MCP 生命周期由官方 SDK 管理；消费者可保留 session 使用 SDK 的全部能力。 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { HttpConnection } from "./http.js";
export interface McpSession {
    client: Client;
    transport: StreamableHTTPClientTransport;
    close(): Promise<void>;
}
export declare class McpConnections {
    private readonly http;
    private readonly sessions;
    private closed;
    constructor(http: HttpConnection);
    open(signal?: AbortSignal): Promise<McpSession>;
    private failAfterClose;
    private run;
    request(method: string, params: Record<string, unknown> | undefined, signal?: AbortSignal, timeoutMs?: number): Promise<unknown>;
    notify(method: string, params: Record<string, unknown> | undefined, signal?: AbortSignal, timeoutMs?: number): Promise<void>;
    dispose(): Promise<void>;
}
