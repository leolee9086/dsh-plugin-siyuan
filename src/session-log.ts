/**
 * 读会话的规范内容：活会话先落盘，再按持久化读句柄分页取头和事件。
 *
 * 两个服务都在插件的 inject 里声明，由宿主保证就绪，所以直接用 `ctx.sessions` /
 * `ctx.sessionPersistence`；日志格式不在这里拼，交给 `dsh-session-sy`。
 *
 * 分页不是性能优化：一个几小时的会话渲染出来是几百 MB，超过 V8 单字符串上限，
 * 整篇读会直接 `Failed to convert rust String into napi string`。按事件区间切开，
 * 每一段单独渲染成一篇文档。
 */
import type { SessionStore } from "@deepseek-ai/dsh-session";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
import type { SessionParts } from "./session-import.js";

/** 每段读多少事件：大会话按这个粒度切开，单篇文档才不会被一条字符串撑爆。 */
const EVENTS_PER_PART = 10000;

export interface SessionLogServices {
  sessions: SessionStore;
  persistence: SessionPersistence;
}

/**
 * 读一段会话的头和按序事件，大会话按事件区间分成多段。
 *
 * 活会话的尾巴还在内存里，所以先走一遍持久化的 flush 屏障；冷会话没有可 flush 的内容。
 * 会话是否存在由持久化的 open 判定，它自己的 NotFound 原样抛出。
 */
export async function readSessionParts(
  services: SessionLogServices, sessionId: string, signal?: AbortSignal,
): Promise<SessionParts[]> {
  // 会话 id 由调用方保证来自宿主，品牌只存在于类型层。
  const id = sessionId as SessionId;
  signal?.throwIfAborted();
  const live = services.sessions.get(id);
  if (live !== undefined) await services.sessions.flush(live);
  signal?.throwIfAborted();
  const options = signal === undefined ? {} : { signal };
  const handle = await services.persistence.open(id, "read", options);
  try {
    const parts: SessionParts[] = [];
    for (let offset = 0; ; offset += EVENTS_PER_PART) {
      const { events } = await handle.read(offset, EVENTS_PER_PART, options);
      if (events.length === 0) break;
      parts.push({ header: handle.header, events });
      if (events.length < EVENTS_PER_PART) break;
    }
    return parts;
  } finally { await handle.close(); }
}
