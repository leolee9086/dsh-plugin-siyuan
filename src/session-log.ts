/**
 * 读会话的规范内容：活会话先落盘，再按持久化读句柄取头和事件。
 *
 * 宿主的会话包不能直接当依赖：npm 上的 `@deepseek-ai/dsh-session` 把尚未发布的
 * `@deepseek-ai/dsh-type-meta` 声明成 peer，安装阶段就 404。所以这里只声明真正用到的两个方法，
 * 运行时从 Context 上取。日志格式本身不在这里拼，交给 `dsh-session-sy`。
 */
import type { SessionParts } from "./session-import.js";

/** 会话读句柄上用到的方法。 */
interface SessionReadHandle {
  readonly header: unknown;
  read(start: number, end?: number, options?: { signal?: AbortSignal }): Promise<{ events: readonly unknown[] }>;
  close(): Promise<void>;
}

/** 会话持久化服务上用到的方法。 */
interface SessionPersistenceService {
  open(id: string, mode: "read", options?: { signal?: AbortSignal }): Promise<SessionReadHandle>;
}

/** 活会话存储上用到的方法。 */
interface SessionStoreService {
  get(id: string): object | undefined;
  flush(session: object): Promise<void>;
}

export interface SessionLogServices {
  sessions: SessionStoreService | undefined;
  persistence: SessionPersistenceService;
}

/** 取一个必选方法；服务缺席或换名时当场说清楚，不留到调用时变成 undefined。 */
function method(host: unknown, name: string, label: string): (...args: unknown[]) => unknown {
  if (host === null || typeof host !== "object") throw new Error(`${label}不可用`);
  const value = (host as Record<string, unknown>)[name];
  if (typeof value !== "function") throw new Error(`${label}缺少 ${name}`);
  return (value as (...args: unknown[]) => unknown).bind(host);
}

/** 从宿主上下文取会话读取需要的两个服务；活会话存储是可选的，冷会话不需要它。 */
export function sessionServices(ctx: object): SessionLogServices {
  const open = method(Reflect.get(ctx, "sessionPersistence"), "open", "会话持久化服务");
  const store = Reflect.get(ctx, "sessions");
  const sessions = store === null || typeof store !== "object" ? undefined : {
    get: (id: string) => {
      const found = method(store, "get", "会话存储")(id);
      return found !== null && typeof found === "object" ? found : undefined;
    },
    flush: async (session: object) => { await method(store, "flush", "会话存储")(session); },
  };
  return {
    sessions,
    persistence: { open: (id, mode, options) => open(id, mode, options) as Promise<SessionReadHandle> },
  };
}

/**
 * 读一段会话的头和按序事件。
 *
 * 活会话的尾巴还在内存里，所以先走一遍持久化的 flush 屏障；冷会话没有可 flush 的内容。
 * 会话是否存在由持久化的 open 判定，它自己的 NotFound 原样抛出。
 */
export async function readSessionParts(
  services: SessionLogServices, sessionId: string, signal?: AbortSignal,
): Promise<SessionParts> {
  signal?.throwIfAborted();
  const live = services.sessions?.get(sessionId);
  if (live !== undefined) await services.sessions?.flush(live);
  signal?.throwIfAborted();
  const options = signal === undefined ? {} : { signal };
  const handle = await services.persistence.open(sessionId, "read", options);
  try {
    const { events } = await handle.read(0, undefined, options);
    return { header: handle.header, events };
  } finally { await handle.close(); }
}
