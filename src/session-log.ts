/**
 * 读会话的规范内容：活会话先落盘，再按持久化读句柄取头和事件。
 *
 * 两个服务都在插件的 inject 里声明，由宿主保证就绪，所以直接用 `ctx.sessions` /
 * `ctx.sessionPersistence`；日志格式不在这里拼，交给 `dsh-session-sy`。
 */
import type { SessionStore } from "@deepseek-ai/dsh-session";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
import type { SessionParts } from "./session-import.js";

export interface SessionLogServices {
  sessions: SessionStore;
  persistence: SessionPersistence;
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
  // 会话 id 由调用方保证来自宿主，品牌只存在于类型层。
  const id = sessionId as SessionId;
  signal?.throwIfAborted();
  const live = services.sessions.get(id);
  if (live !== undefined) await services.sessions.flush(live);
  signal?.throwIfAborted();
  const options = signal === undefined ? {} : { signal };
  const handle = await services.persistence.open(id, "read", options);
  try {
    const { events } = await handle.read(0, undefined, options);
    return { header: handle.header, events };
  } finally { await handle.close(); }
}
