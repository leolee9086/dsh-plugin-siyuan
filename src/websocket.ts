/** WS 传输保持消息字节和长期连接；工具调用可使用有界收发并立即关闭。 */
import WebSocket, { type RawData } from "ws";
import type { HttpConnection } from "./http.js";

export function messageBytes(data: RawData): Buffer {
  return Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
}
export interface SocketOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  protocols?: string[];
  onMessage?: (data: Buffer, binary: boolean) => void;
}
export interface SocketMessage { binary: boolean; data: string; encoding: "base64" | "utf8" }

export class SocketConnections {
  private readonly sockets = new Set<WebSocket>();
  private closed = false;
  constructor(private readonly http: HttpConnection) {}

  async open(path: string, options: SocketOptions = {}): Promise<WebSocket> {
    if (this.closed) throw new Error("WS 服务已卸载");
    const signal = this.http.signal(options.signal, 0);
    const url = await this.http.resolveUrl(path, signal);
    signal.throwIfAborted();
    if (this.closed) throw new Error("WS 服务已卸载");
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, options.protocols, {
        headers: Object.fromEntries(this.http.headers(options.headers)),
        handshakeTimeout: this.http.config.timeoutMs,
        followRedirects: false,
      });
      this.sockets.add(socket);
      const abort = () => socket.terminate();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      socket.on("message", (data, binary) => options.onMessage?.(messageBytes(data), binary));
      // error 监听长期存在，消费者仍可注册自己的监听器。
      socket.on("error", reject);
      socket.once("open", () => resolve(socket));
      socket.once("close", () => {
        this.sockets.delete(socket);
        signal.removeEventListener("abort", abort);
        reject(signal.reason ?? new Error("WS 在打开之前关闭"));
      });
    });
  }

  async exchange(path: string, options: SocketOptions & {
    messages?: (string | Uint8Array)[]; durationMs: number; maxMessages: number;
  }): Promise<{ messages: SocketMessage[]; ended: "limit" | "timeout" | "closed" }> {
    const messages: SocketMessage[] = [];
    let finish: ((value: "limit" | "timeout" | "closed") => void) | undefined;
    const done = new Promise<"limit" | "timeout" | "closed">(resolve => { finish = resolve; });
    const socket = await this.open(path, { ...options, onMessage: (data, binary) => {
      if (messages.length >= options.maxMessages) return;
      messages.push({ binary, data: data.toString(binary ? "base64" : "utf8"), encoding: binary ? "base64" : "utf8" });
      if (messages.length >= options.maxMessages) finish!("limit");
    } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => finish!("closed");
    try {
      socket.once("close", onAbort);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
      timer = setTimeout(() => finish!("timeout"), options.durationMs);
      for (const message of options.messages ?? []) {
        await new Promise<void>((resolve, reject) => socket.send(message, error => error ? reject(error) : resolve()));
      }
      const ended = await done;
      options.signal?.throwIfAborted();
      return { messages, ended };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      socket.terminate();
    }
  }

  dispose(): void {
    this.closed = true;
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
  }
}
