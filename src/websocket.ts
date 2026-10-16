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
  /** 在开始握手前安装，捕获升级后立即关闭及后续传输失败。 */
  onClose?: (error?: Error) => void;
  /** 默认30秒发送协议ping；0关闭，未收到上一轮pong时结束失联连接。 */
  heartbeatMs?: number;
}
export interface SocketMessage { binary: boolean; data: string; encoding: "base64" | "utf8" }
export type SocketAccessStatus = 401 | 403 | 429;

/** WS 握手或升级后的访问拒绝；消息不包含响应体和请求头。 */
export class SocketAccessError extends Error {
  constructor(readonly status: SocketAccessStatus, readonly source: "handshake" | "close", readonly retryAfterSeconds?: number) {
    super(source === "close" ? "WS 连接未通过认证" : status === 401 ? "WS 握手未通过认证（HTTP 401）"
      : status === 403 ? "WS 握手被拒绝（HTTP 403）" : "WS 握手受到限流（HTTP 429）");
    this.name = "SocketAccessError";
  }
}

function retryAfterSeconds(value: string | undefined): number | undefined {
  if (!value) return;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds <= Number.MAX_SAFE_INTEGER ? Math.max(0, seconds) : undefined;
}

/** 标准关闭帧的原因与关闭码已由 ws 分开；只认固定的未认证标记。 */
function socketCloseAccessError(reason: Buffer): SocketAccessError | undefined {
  if (reason.toString("utf8").trim() === "unauthenticated") return new SocketAccessError(401, "close");
  return undefined;
}

type PauseReason = "authentication" | "permission" | "rate-limit" | "protocol";
export interface SocketPause { reason: PauseReason; message: string; retryAfterSeconds?: number }
function pauseFor(error: unknown): SocketPause | undefined {
  if (error instanceof SocketAccessError) {
    const reason = error.status === 429 ? "rate-limit" : error.status === 403 ? "permission" : "authentication";
    const wait = error.retryAfterSeconds === undefined ? "" : `；Retry-After ${error.retryAfterSeconds} 秒`;
    return { reason, retryAfterSeconds: error.retryAfterSeconds,
      message: `${error.message}${wait}；已暂停自动重连，请检查核心访问策略、代理和连接配置，保存更新后恢复。WS 认证独立于 HTTP API token` };
  }
  if (error && typeof error === "object" && "code" in error && error.code === "WS_ERR_INVALID_CLOSE_CODE") {
    // 思源部分版本直接发送带两个空格的关闭载荷，ws 按协议拒绝其非法关闭码。
    // 无法从这个错误区分 unauthenticated 和 invalid query，保留协议错误分类。
    return { reason: "protocol", message: "WS 收到无效关闭帧，已暂停自动重连；请检查核心版本、访问认证和代理，保存连接配置更新后恢复" };
  }
}

export class SocketConnections {
  static pauseFor = pauseFor;
  private readonly sockets = new Set<WebSocket>();
  private closed = false;
  constructor(private readonly http: HttpConnection) {}

  async open(path: string, options: SocketOptions = {}): Promise<WebSocket> {
    if (this.closed) throw new Error("WS 服务已卸载");
    const heartbeatMs = options.heartbeatMs ?? 30000;
    if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 0) throw new Error("heartbeatMs 必须为非负整数");
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
      let failure: Error | undefined;
      const abort = () => socket.terminate();
      signal.addEventListener("abort", abort, { once: true });
      socket.on("message", (data, binary) => options.onMessage?.(messageBytes(data), binary));
      // 保留首个错误，terminate 引起的后续事件不会覆盖握手状态。
      socket.on("error", error => { failure ??= error; reject(failure); });
      socket.once("unexpected-response", (request, response) => {
        const status = response.statusCode;
        failure = status === 401 || status === 403 || status === 429
          ? new SocketAccessError(status, "handshake", retryAfterSeconds(response.headers["retry-after"]))
          : new Error(`WS 握手失败（HTTP ${status}）`);
        reject(failure);
        // 安装 unexpected-response 后，ws 将清理责任交给调用方。
        response.destroy(); request.destroy(); socket.terminate();
      });
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let awaitingPong = false;
      socket.on("pong", () => { awaitingPong = false; });
      socket.once("open", () => {
        if (heartbeatMs) {
          heartbeat = setInterval(() => {
            if (socket.readyState !== WebSocket.OPEN) return;
            if (awaitingPong) { socket.terminate(); return; }
            awaitingPong = true;
            socket.ping((error?: Error) => { if (error) socket.terminate(); });
          }, heartbeatMs);
          heartbeat.unref();
        }
        resolve(socket);
      });
      socket.once("close", (_code, reason) => {
        clearInterval(heartbeat);
        this.sockets.delete(socket);
        signal.removeEventListener("abort", abort);
        failure ??= socketCloseAccessError(reason);
        reject(signal.reason ?? failure ?? new Error("WS 在打开之前关闭"));
        options.onClose?.(failure);
      });
      if (signal.aborted) abort();
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
