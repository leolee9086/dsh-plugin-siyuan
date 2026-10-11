/** WS 传输保持消息字节和长期连接；工具调用可使用有界收发并立即关闭。 */
import WebSocket, { type RawData } from "ws";
import type { HttpConnection } from "./http.js";
export declare function messageBytes(data: RawData): Buffer;
export interface SocketOptions {
    signal?: AbortSignal;
    headers?: Record<string, string>;
    protocols?: string[];
    onMessage?: (data: Buffer, binary: boolean) => void;
}
export interface SocketMessage {
    binary: boolean;
    data: string;
    encoding: "base64" | "utf8";
}
export declare class SocketConnections {
    private readonly http;
    private readonly sockets;
    private closed;
    constructor(http: HttpConnection);
    open(path: string, options?: SocketOptions): Promise<WebSocket>;
    exchange(path: string, options: SocketOptions & {
        messages?: (string | Uint8Array)[];
        durationMs: number;
        maxMessages: number;
    }): Promise<{
        messages: SocketMessage[];
        ended: "limit" | "timeout" | "closed";
    }>;
    dispose(): void;
}
