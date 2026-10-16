/** WS 传输保持消息字节和长期连接；工具调用可使用有界收发并立即关闭。 */
import WebSocket, { type RawData } from "ws";
import type { HttpConnection } from "./http.js";
export declare function messageBytes(data: RawData): Buffer;
export interface SocketOptions {
    signal?: AbortSignal;
    headers?: Record<string, string>;
    protocols?: string[];
    onMessage?: (data: Buffer, binary: boolean) => void;
    /** 在开始握手前安装，捕获升级后立即关闭及后续传输失败。 */
    onClose?: (error?: Error) => void;
    /** 默认30秒发送协议ping；0关闭，未收到上一轮pong时结束失联连接。 */
    heartbeatMs?: number;
}
export interface SocketMessage {
    binary: boolean;
    data: string;
    encoding: "base64" | "utf8";
}
export type SocketAccessStatus = 401 | 403 | 429;
/** WS 握手或升级后的访问拒绝；消息不包含响应体和请求头。 */
export declare class SocketAccessError extends Error {
    readonly status: SocketAccessStatus;
    readonly source: "handshake" | "close";
    readonly retryAfterSeconds?: number | undefined;
    constructor(status: SocketAccessStatus, source: "handshake" | "close", retryAfterSeconds?: number | undefined);
}
type PauseReason = "authentication" | "permission" | "rate-limit" | "protocol";
export interface SocketPause {
    reason: PauseReason;
    message: string;
    retryAfterSeconds?: number;
}
declare function pauseFor(error: unknown): SocketPause | undefined;
export declare class SocketConnections {
    private readonly http;
    static pauseFor: typeof pauseFor;
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
export {};
