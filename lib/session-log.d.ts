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
    read(start: number, end?: number, options?: {
        signal?: AbortSignal;
    }): Promise<{
        events: readonly unknown[];
    }>;
    close(): Promise<void>;
}
/** 会话持久化服务上用到的方法。 */
interface SessionPersistenceService {
    open(id: string, mode: "read", options?: {
        signal?: AbortSignal;
    }): Promise<SessionReadHandle>;
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
/** 从宿主上下文取会话读取需要的两个服务；活会话存储是可选的，冷会话不需要它。 */
export declare function sessionServices(ctx: object): SessionLogServices;
/**
 * 读一段会话的头和按序事件。
 *
 * 活会话的尾巴还在内存里，所以先走一遍持久化的 flush 屏障；冷会话没有可 flush 的内容。
 * 会话是否存在由持久化的 open 判定，它自己的 NotFound 原样抛出。
 */
export declare function readSessionParts(services: SessionLogServices, sessionId: string, signal?: AbortSignal): Promise<SessionParts>;
export {};
