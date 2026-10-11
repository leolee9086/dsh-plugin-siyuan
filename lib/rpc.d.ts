/** 思源插件 JSON-RPC：ID 匹配和批量响应交给 json-rpc-2.0，HTTP/WS 只承担传输。 */
import { type JSONRPCParams, type JSONRPCResponse } from "json-rpc-2.0";
import type { HttpConnection } from "./http.js";
import type { SocketConnections } from "./websocket.js";
export interface RpcCall {
    method: string;
    params?: JSONRPCParams;
    notification?: boolean;
}
export interface RpcOptions {
    plugin?: string;
    transport?: "http" | "ws";
    signal?: AbortSignal;
    timeoutMs?: number;
}
export declare class PluginRpc {
    private readonly http;
    private readonly sockets;
    constructor(http: HttpConnection, sockets: SocketConnections);
    /** 单次调用返回 result；内核 JSON-RPC error 保留 code 和 data。 */
    request(method: string, params: JSONRPCParams | undefined, options?: RpcOptions): Promise<unknown>;
    notify(method: string, params: JSONRPCParams | undefined, options?: RpcOptions): Promise<void>;
    batch(calls: RpcCall[], options?: RpcOptions): Promise<JSONRPCResponse[]>;
    private run;
}
