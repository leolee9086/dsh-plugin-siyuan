/** 每段读多少事件：大会话按这个粒度切开，单篇文档才不会被一条字符串撑爆。 */
const EVENTS_PER_PART = 10000;
/**
 * 读一段会话的头和按序事件，大会话按事件区间分成多段。
 *
 * 活会话的尾巴还在内存里，所以先走一遍持久化的 flush 屏障；冷会话没有可 flush 的内容。
 * 会话是否存在由持久化的 open 判定，它自己的 NotFound 原样抛出。
 */
export async function readSessionParts(services, sessionId, signal) {
    // 会话 id 由调用方保证来自宿主，品牌只存在于类型层。
    const id = sessionId;
    signal?.throwIfAborted();
    const live = services.sessions.get(id);
    if (live !== undefined)
        await services.sessions.flush(live);
    signal?.throwIfAborted();
    const options = signal === undefined ? {} : { signal };
    const handle = await services.persistence.open(id, "read", options);
    try {
        const parts = [];
        for (let offset = 0;; offset += EVENTS_PER_PART) {
            const { events } = await handle.read(offset, EVENTS_PER_PART, options);
            if (events.length === 0)
                break;
            parts.push({ header: handle.header, events });
            if (events.length < EVENTS_PER_PART)
                break;
        }
        return parts;
    }
    finally {
        await handle.close();
    }
}
