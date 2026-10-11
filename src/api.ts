/** 配置和内核信封语义；原始 HTTP 传输位于 http.ts。 */
import path from "node:path";

export interface ApiConfig {
  /** auto 按思源本机登记发现；HTTP(S) 地址优先使用明确配置。 */
  apiUrl: string;
  token: string;
  timeoutMs: number;
  portFile?: string;
  kernelPid?: number;
}
export interface Envelope<T> { code: number; msg: string; data: T }

export class KernelError extends Error {
  constructor(readonly endpoint: string, readonly code: number, message: string) {
    super(`${endpoint} 被内核拒绝（code=${code}）：${message}`);
    this.name = "KernelError";
  }
}

export function normalizeConfig(raw: unknown): ApiConfig {
  if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) {
    throw new TypeError("插件配置必须为对象");
  }
  const input = (raw ?? {}) as Record<string, unknown>;
  const suppliedUrl = input.apiUrl ?? "auto";
  if (typeof suppliedUrl !== "string") throw new TypeError("apiUrl 必须为字符串");
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
  if (typeof token !== "string" || /[\r\n]/.test(token)) throw new TypeError("token 必须为单行字符串");
  const timeoutMs = input.timeoutMs ?? 15000;
  if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs 必须为正整数");
  }
  return { apiUrl, token: token.trim(), timeoutMs,
    ...(portFile === undefined ? {} : { portFile: portFile as string }),
    ...(kernelPid === undefined ? {} : { kernelPid: kernelPid as number }) };
}

export interface KernelCaller {
  json(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<Response>;
}

/** 只供采用 {code,msg,data} 的接口使用；RPC、文件、MCP 保留各自响应协议。 */
export async function callKernel<T = unknown>(
  connection: KernelCaller, endpoint: string, payload: Record<string, unknown> = {}, signal?: AbortSignal,
): Promise<T> {
  const response = await connection.json(endpoint, payload, signal);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${endpoint} 返回 HTTP ${response.status} ${response.statusText}`);
  }
  const envelope = await response.json() as Envelope<T>;
  if (!envelope || typeof envelope.code !== "number") throw new Error(`${endpoint} 响应缺少内核 code`);
  if (envelope.code !== 0) throw new KernelError(endpoint, envelope.code, envelope.msg);
  return envelope.data;
}
