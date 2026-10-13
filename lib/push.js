import { setTimeout as delay } from 'node:timers/promises';
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
const fullCommands = new Set(['syncMergeResult', 'reloaddoc', 'mount', 'openBox', 'closeBox', 'removeBox',
    'removeDoc', 'moveDoc', 'moveDocs', 'rename', 'docsImported', 'reloadUI',
    'create', 'createdailynote', 'createnotebook', 'heading2doc', 'li2doc']);
function change(value) {
    const message = record(value);
    if (fullCommands.has(String(message.cmd)))
        return { kind: 'change' };
    if (message.cmd !== 'transactions')
        return undefined;
    const roots = record(message.context).rootIDs;
    // 缺少可靠范围的事务做一次全量校准；普通通知不触发读取。
    if (!Array.isArray(roots) || !roots.length || roots.some(id => typeof id !== 'string' || !/^\d{14}-[a-z0-9]{7}$/.test(id)))
        return { kind: 'change' };
    const transactions = Array.isArray(message.data) ? message.data : [];
    let marker = false;
    for (const transaction of transactions) {
        const operations = record(transaction).doOperations;
        if (!Array.isArray(operations))
            return { kind: 'change' };
        for (const operation of operations) {
            const item = record(operation);
            if (typeof item.data === 'string' && item.data.includes('DSH-REMINDER'))
                marker = true;
            // 移动可能同时影响两个文档，未知动作也不能按普通文本编辑忽略。
            if (!['insert', 'update', 'delete', 'setAttrs', 'updateAttrs'].includes(String(item.action)))
                return { kind: 'change' };
        }
    }
    if (!transactions.length)
        return { kind: 'change' };
    return { kind: 'change', roots: roots, marker };
}
/** 每核心一条只读推送连接；消费者只收到失效通知，不接触 socket 或凭据。 */
export class ReminderPushHub {
    port;
    listeners = new Set();
    runs = new Map();
    retiring = new Set();
    closed = false;
    constructor(port) {
        this.port = port;
    }
    emit(event) {
        for (const listener of this.listeners)
            listener(event);
    }
    watch = listener => {
        if (this.closed)
            throw new Error('思源推送已卸载');
        this.listeners.add(listener);
        for (const [kernelId, run] of this.runs)
            if (run.ready)
                listener({ kernelId, kind: 'ready' });
        this.sync();
        return async () => {
            this.listeners.delete(listener);
            if (!this.listeners.size) {
                this.stop();
                await Promise.allSettled([...this.retiring]);
            }
        };
    };
    stop() {
        for (const [kernelId, run] of this.runs) {
            this.emit({ kernelId, kind: 'offline' });
            run.controller.abort();
            this.retiring.add(run.done);
            void run.done.finally(() => this.retiring.delete(run.done));
        }
        this.runs.clear();
    }
    /** 持久配置 ACK 后重建连接快照；旧连接事件由 controller 隔离。 */
    reset() { this.stop(); this.sync(); }
    sync() {
        if (this.closed || !this.listeners.size)
            return;
        for (const kernelId of this.port.kernels()) {
            if (this.runs.has(kernelId))
                continue;
            const controller = new AbortController();
            const run = { controller, done: Promise.resolve(), ready: false };
            this.runs.set(kernelId, run);
            const previous = [...this.retiring];
            run.done = (async () => {
                // 配置切换先等旧连接释放，再为同一核心打开新连接。
                await Promise.allSettled(previous);
                let backoff = 1000;
                while (!controller.signal.aborted) {
                    let stream;
                    try {
                        stream = await this.port.open(kernelId, controller.signal, value => {
                            if (controller.signal.aborted)
                                return;
                            const event = change(value);
                            if (event)
                                this.emit({ kernelId, ...event });
                        });
                        controller.signal.throwIfAborted();
                        run.ready = true;
                        this.emit({ kernelId, kind: 'ready' });
                        const opened = Date.now();
                        await stream.ended;
                        if (Date.now() - opened >= 30000)
                            backoff = 1000;
                        if (!controller.signal.aborted)
                            throw new Error('思源推送连接已断开');
                    }
                    catch (error) {
                        if (!controller.signal.aborted)
                            this.emit({ kernelId, kind: 'offline', message: this.port.error(error) });
                    }
                    finally {
                        run.ready = false;
                        await stream?.dispose().catch(() => { });
                    }
                    if (controller.signal.aborted)
                        break;
                    await delay(backoff, undefined, { signal: controller.signal, ref: false }).catch(() => { });
                    backoff = Math.min(30000, backoff * 2);
                }
            })();
        }
    }
    async close() {
        this.closed = true;
        this.stop();
        this.listeners.clear();
        await Promise.allSettled([...this.retiring]);
    }
}
