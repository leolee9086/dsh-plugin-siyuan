/** 取一个必选方法；服务缺席或换名时当场说清楚，不留到调用时变成 undefined。 */
function method(host, name, label) {
    if (host === null || typeof host !== "object")
        throw new Error(`${label}不可用`);
    const value = host[name];
    if (typeof value !== "function")
        throw new Error(`${label}缺少 ${name}`);
    return value.bind(host);
}
/** 从宿主上下文取会话读取需要的两个服务；活会话存储是可选的，冷会话不需要它。 */
export function sessionServices(ctx) {
    const open = method(Reflect.get(ctx, "sessionPersistence"), "open", "会话持久化服务");
    const store = Reflect.get(ctx, "sessions");
    const sessions = store === null || typeof store !== "object" ? undefined : {
        get: (id) => {
            const found = method(store, "get", "会话存储")(id);
            return found !== null && typeof found === "object" ? found : undefined;
        },
        flush: async (session) => { await method(store, "flush", "会话存储")(session); },
    };
    return {
        sessions,
        persistence: { open: (id, mode, options) => open(id, mode, options) },
    };
}
/**
 * 读一段会话的头和按序事件。
 *
 * 活会话的尾巴还在内存里，所以先走一遍持久化的 flush 屏障；冷会话没有可 flush 的内容。
 * 会话是否存在由持久化的 open 判定，它自己的 NotFound 原样抛出。
 */
export async function readSessionParts(services, sessionId, signal) {
    signal?.throwIfAborted();
    const live = services.sessions?.get(sessionId);
    if (live !== undefined)
        await services.sessions?.flush(live);
    signal?.throwIfAborted();
    const options = signal === undefined ? {} : { signal };
    const handle = await services.persistence.open(sessionId, "read", options);
    try {
        const { events } = await handle.read(0, undefined, options);
        return { header: handle.header, events };
    }
    finally {
        await handle.close();
    }
}
