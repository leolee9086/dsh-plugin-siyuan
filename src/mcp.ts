/** MCP 生命周期由官方 SDK 管理；消费者可保留 session 使用 SDK 的全部能力。 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { HttpConnection } from "./http.js";

export interface McpSession {
  client: Client;
  transport: StreamableHTTPClientTransport;
  close(): Promise<void>;
}
export class McpConnections {
  private readonly sessions = new Set<McpSession>();
  private closed = false;
  constructor(private readonly http: HttpConnection) {}

  async open(signal?: AbortSignal): Promise<McpSession> {
    if (this.closed) throw new Error("MCP 服务已卸载");
    const controller = new AbortController();
    const lifetime = this.http.signal(signal ? AbortSignal.any([controller.signal, signal]) : controller.signal, 0);
    const bound = await this.http.bindFetch(lifetime);
    lifetime.throwIfAborted();
    if (this.closed) throw new Error("MCP 服务已卸载");
    const client = new Client({ name: "dsh-plugin-siyuan", version: "0.2.0" });
    const transport = new StreamableHTTPClientTransport(bound.url("/mcp"), {
      fetch: (input, init) => bound.fetch(input, init, { timeoutMs: 0, signal: lifetime }),
      reconnectionOptions: { maxRetries: 0, maxReconnectionDelay: 30000, initialReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1.5 },
    });
    let closing: Promise<void> | undefined;
    const session: McpSession = { client, transport, close: () => {
      closing ??= (async () => {
        try {
          if (transport.sessionId && !lifetime.aborted) {
            // DELETE 自身也需要期限；不要让卸载无限等待失联内核。
            await bound.fetch(bound.url("/mcp"), { method: "DELETE", headers: {
              "mcp-session-id": transport.sessionId,
              ...(transport.protocolVersion ? { "mcp-protocol-version": transport.protocolVersion } : {}),
            } }, { signal: lifetime }).then(async response => {
              await response.body?.cancel();
              if (!response.ok && response.status !== 405) throw new Error(`MCP 结束会话 HTTP ${response.status}`);
            });
          }
        } finally {
          controller.abort();
          await client.close();
          this.sessions.delete(session);
        }
      })();
      return closing;
    } };
    this.sessions.add(session);
    try {
      await client.connect(transport, { signal: lifetime, timeout: this.http.config.timeoutMs });
      lifetime.throwIfAborted();
      if (this.closed) throw new Error("MCP 服务已卸载");
      return session;
    } catch (error) {
      return this.failAfterClose(session, error);
    }
  }

  private async failAfterClose(session: McpSession, error: unknown): Promise<never> {
    try { await session.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], `MCP 操作失败且关闭失败：${String(error)}`, { cause: error }); }
    throw error;
  }

  private async run<T>(signal: AbortSignal | undefined, timeoutMs: number,
    action: (session: McpSession, signal: AbortSignal) => Promise<T>): Promise<T> {
    const bounded = this.http.signal(signal, timeoutMs);
    const session = await this.open(bounded);
    let result: T;
    try {
      result = await action(session, bounded);
      bounded.throwIfAborted();
    } catch (error) {
      // 取消时 fetch 可能只报告通用 AbortError，给调用方保留实际的取消原因。
      return this.failAfterClose(session, bounded.aborted ? bounded.reason : error);
    }
    await session.close();
    return result;
  }

  request(method: string, params: Record<string, unknown> | undefined, signal?: AbortSignal,
    timeoutMs = this.http.config.timeoutMs): Promise<unknown> {
    return this.run(signal, timeoutMs, async (session, bounded) => {
      const options = { signal: bounded, timeout: timeoutMs || this.http.config.timeoutMs };
      if (method === "tools/call") {
        if (typeof params?.name !== "string") throw new Error("tools/call 需要 params.name");
        return session.client.callTool(params as Parameters<Client["callTool"]>[0], undefined, options);
      }
      // SDK 的通用 request 保留资源、提示、发现与扩展方法的可达性。
      return session.client.request({ method, ...(params === undefined ? {} : { params }) }, ResultSchema, options);
    });
  }

  notify(method: string, params: Record<string, unknown> | undefined, signal?: AbortSignal,
    timeoutMs = this.http.config.timeoutMs): Promise<void> {
    return this.run(signal, timeoutMs, async session => {
      await session.client.notification({ method, ...(params === undefined ? {} : { params }) });
    });
  }

  async dispose(): Promise<void> {
    this.closed = true;
    const results = await Promise.allSettled([...this.sessions].map(session => session.close()));
    const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, "MCP 会话清理失败");
  }
}
