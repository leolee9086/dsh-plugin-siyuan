import { setTimeout as delay } from 'node:timers/promises';
/** 把操作负载折成可搜索的文本；字符串原样，对象按 JSON。消费者拿它判断自己关心的标记。 */
export function textOf(value) {
    if (typeof value === 'string')
        return value;
    if (value === null || typeof value !== 'object')
        return '';
    try {
        return JSON.stringify(value) ?? '';
    }
    catch {
        return '';
    }
}
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
const fullCommands = new Set(['syncMergeResult', 'reloaddoc', 'mount', 'openBox', 'closeBox', 'removeBox',
    'removeDoc', 'moveDoc', 'moveDocs', 'rename', 'docsImported', 'reloadUI',
    'create', 'createdailynote', 'createnotebook', 'heading2doc', 'li2doc']);
/** 收集事务里的块操作；遇到未知动作返回 undefined，由调用方退回全量校准。 */
function operations(value) {
    const transactions = Array.isArray(value) ? value : [];
    const result = [];
    for (const transaction of transactions) {
        const items = record(transaction).doOperations;
        if (!Array.isArray(items))
            return undefined;
        for (const operation of items) {
            const item = record(operation);
            const action = String(item.action);
            // 移动可能同时影响两个文档，未知动作也不能按普通文本编辑忽略。
            if (!['insert', 'update', 'delete', 'setAttrs', 'updateAttrs'].includes(action))
                return undefined;
            result.push({ action, data: item.data });
        }
    }
    return result.length ? result : undefined;
}
function change(value) {
    const message = record(value);
    if (fullCommands.has(String(message.cmd)))
        return { kind: 'change', operations: [] };
    if (message.cmd !== 'transactions')
        return undefined;
    const roots = record(message.context).rootIDs;
    // 缺少可靠范围的事务做一次全量校准；普通通知不触发读取。
    if (!Array.isArray(roots) || !roots.length || roots.some(id => typeof id !== 'string' || !/^\d{14}-[a-z0-9]{7}$/.test(id))) {
        return { kind: 'change', operations: [] };
    }
    const collected = operations(message.data);
    // 读不出操作细节时同样退回全量：宁可多校准一次，也不漏掉一次真实变化。
    if (!collected)
        return { kind: 'change', operations: [] };
    return { kind: 'change', roots: roots, operations: collected };
}
/** 每核心一条只读推送连接；消费者只收到失效通知，不接触 socket 或凭据。 */
export class KernelPushHub {
    port;
    listeners = new Set();
    runs = new Map();
    retiring = new Set();
    // 暂停随核心保留；撤销订阅、端点授权和普通配置保存都不解除。
    paused = new Map();
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
        for (const kernelId of this.port.kernels()) {
            const pause = this.paused.get(kernelId);
            if (pause)
                listener({ kernelId, kind: 'offline', message: pause.message });
        }
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
            run.ready = false;
            run.controller.abort();
            this.emit({ kernelId, kind: 'offline' });
            this.retiring.add(run.done);
            void run.done.finally(() => this.retiring.delete(run.done));
        }
        this.runs.clear();
    }
    /** 只有成功提交的连接绑定更新可以解除指定核心的暂停。 */
    reset(resumeFor = []) {
        this.stop();
        for (const kernelId of resumeFor)
            this.paused.delete(kernelId);
        this.sync();
    }
    pausedState(kernelId) {
        const pause = this.paused.get(kernelId);
        return pause ? { ...pause } : undefined;
    }
    /** HTTP 快照与 WS 共用核心暂停；停止现有流，离线事件撤下已注册的规则。 */
    pause(kernelId, error) {
        if (this.closed || !this.port.kernels().includes(kernelId))
            return;
        const pause = this.port.pause(error);
        if (!pause)
            return;
        this.paused.set(kernelId, pause);
        const run = this.runs.get(kernelId);
        if (run) {
            run.ready = false;
            run.controller.abort();
        }
        this.emit({ kernelId, kind: 'offline', message: pause.message });
        return pause;
    }
    sync() {
        if (this.closed || !this.listeners.size)
            return;
        for (const kernelId of this.port.kernels()) {
            if (this.runs.has(kernelId) || this.paused.has(kernelId))
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
                        run.ready = false;
                        if (!controller.signal.aborted && !this.pause(kernelId, error)) {
                            this.emit({ kernelId, kind: 'offline', message: this.port.error(error) });
                        }
                    }
                    finally {
                        run.ready = false;
                        await stream?.dispose().catch(() => { });
                    }
                    if (controller.signal.aborted || this.paused.has(kernelId))
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
