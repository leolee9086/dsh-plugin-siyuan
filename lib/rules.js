import { parseDocument } from 'yaml';
/** Validation compiles the rule too, but the source retains its original declaration.
 * Compiled engine fields must not be published back into the strict source schema. */
function validateDeclaration(service, rule) {
    service.validateRule(rule);
}
// The service owns this namespace; other rule consumers use their own callout subtype.
const CALLOUT = 'DSH-REMINDER';
const ID = /^\d{14}-[a-z0-9]{7}$/;
function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('规则配置应为对象');
    return value;
}
function bounded(value, fallback, min, max) {
    const number = value ?? fallback;
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < min || number > max)
        throw new Error(`规则配置数值必须在 ${min}—${max} 之间`);
    return number;
}
function options(raw) {
    const input = raw === undefined ? {} : object(raw);
    const config = input.reminders === undefined ? {} : object(input.reminders);
    for (const key of Object.keys(config))
        if (!['refreshMs'].includes(key))
            throw new Error(`未知提醒来源配置 ${key}`);
    return { refreshMs: bounded(config.refreshMs, 30000, 1000, 3600000) };
}
/** Parse only the reminder service's native callouts, then read their dsh-rule declaration.
 * The registered rule identity includes the block id; renaming its heading never changes identity. */
function parseCallout(value) {
    const block = object(value);
    if (block.type !== 'callout' || block.subtype !== CALLOUT || typeof block.markdown !== 'string')
        return undefined;
    if (typeof block.id !== 'string' || !ID.test(block.id))
        throw new Error('callout 缺少有效块 ID');
    const lines = block.markdown.replaceAll('\r\n', '\n').split('\n').map(line => line.replace(/^> ?/, ''));
    if (!/^\[!DSH-REMINDER\](?:\s|$)/.test(lines[0] ?? ''))
        throw new Error('callout 标记与提醒类型不一致');
    const starts = lines.flatMap((line, index) => /^```dsh-rule\s*$/.test(line) ? [index] : []);
    if (starts.length !== 1)
        throw new Error('每个规则 callout 必须有且只有一个 dsh-rule 代码块');
    const start = starts[0];
    const end = lines.findIndex((line, index) => index > start && /^```\s*$/.test(line));
    if (end < 0)
        throw new Error('dsh-rule 代码块未闭合');
    const document = parseDocument(lines.slice(start + 1, end).join('\n'), { uniqueKeys: true, version: '1.2' });
    if (document.errors.length)
        throw new Error(document.errors.map(error => error.message).join('; '));
    const declaration = object(document.toJS({ maxAliasCount: 0 }));
    if (!['reminder/v1', 'reminder/v2', 'reminder/v3'].includes(String(declaration.format)))
        throw new Error('format 必须为 reminder/v1、reminder/v2 或 reminder/v3');
    const localId = declaration.id ?? 'reminder';
    if (typeof localId !== 'string' || !localId || localId.length > 128)
        throw new Error('规则 id 应为1—128字符');
    const text = [...lines.slice(1, start), ...lines.slice(end + 1)]
        .filter(line => !/^\s*\{:\s.*\}\s*$/.test(line)).join('\n').trim();
    if (!text || text.length > 16384)
        throw new Error('提醒正文应为1—16384字符');
    const title = lines[0].replace(/^\[!DSH-REMINDER\]\s*/, '') || localId;
    return { ...declaration, id: `${block.id}:${localId}`, title, text };
}
/** 订阅负责失效，快照负责内容；计时器只重试失败读取和被容量拒绝的候选。 */
function attach(service, config, readBlocks, report, kernels, accepts, watch) {
    let closed = false, revision = 0;
    let active;
    const caches = new Map();
    const retiring = new Set();
    const cacheFor = (kernelId) => {
        let cache = caches.get(kernelId);
        if (!cache) {
            cache = { ready: false, controller: new AbortController(), full: false, roots: new Set(), retry: false, scanning: false, blocks: new Map() };
            caches.set(kernelId, cache);
        }
        return cache;
    };
    const remove = (cache) => {
        const handle = cache.handle;
        cache.handle = undefined;
        cache.content = undefined;
        if (handle) {
            const done = Promise.resolve(handle.dispose()).catch(error => report(String(error)));
            retiring.add(done);
            void done.finally(() => retiring.delete(done));
        }
    };
    const publish = (kernelId, cache) => {
        const source = cache.pending;
        if (!source || !cache.ready || closed)
            return;
        const content = JSON.stringify({ rules: source.rules, diagnostics: source.diagnostics });
        if (cache.content === content) {
            cache.pending = undefined;
            return;
        }
        try {
            if (cache.handle)
                cache.handle.replace(source);
            // 会话选择规则来源核心，context-care 再按规则 scope 过滤会话。
            else
                cache.handle = service.registerSource(source, { acceptSession: sessionId => accepts(kernelId, sessionId) });
            cache.content = content;
            cache.pending = undefined;
            for (const error of source.diagnostics ?? [])
                report(error.id + ': ' + error.message);
        }
        catch (error) {
            // 超限候选保持在内存，下次只重新注册；保留上一批已接受规则。
            if (!(error instanceof Error && 'code' in error && error.code === 'reminder-capacity-exceeded')) {
                remove(cache);
                cache.pending = undefined;
            }
            report('思源提醒来源 ' + source.sourceId + ': ' + String(error instanceof Error ? error.message : error));
        }
    };
    const scan = async (kernelId, cache) => {
        // 取走这一批 dirty 标记；await 期间新来的事件写入下一批，不会被本次清空。
        const full = cache.full, roots = new Set(cache.roots), signal = cache.controller.signal;
        cache.full = false;
        cache.roots.clear();
        cache.retry = false;
        cache.scanning = true;
        try {
            const blocks = await readBlocks(kernelId, full ? undefined : [...roots], signal);
            signal.throwIfAborted();
            if (closed || !cache.ready || !kernels().includes(kernelId))
                return;
            const next = full ? new Map() : new Map([...cache.blocks].filter(([, block]) => !roots.has(block.root)));
            for (const value of blocks) {
                const block = object(value), id = String(block.id), root = String(block.root_id ?? '');
                const signature = JSON.stringify([block.type, block.subtype, block.markdown]);
                const previous = cache.blocks.get(id);
                let parsed;
                if (previous?.signature === signature)
                    parsed = { ...previous, root };
                else {
                    parsed = { root, signature };
                    try {
                        const rule = parseCallout(block);
                        if (rule) {
                            validateDeclaration(service, rule);
                            parsed.rule = rule;
                        }
                    }
                    catch (error) {
                        parsed.diagnostic = { id, message: error instanceof Error ? error.message : String(error) };
                    }
                }
                next.set(id, parsed);
            }
            cache.blocks = next;
            const values = [...next].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
            cache.pending = { sourceId: 'siyuan:' + kernelId + ':reminders', plugin: 'dsh-plugin-siyuan', revision: ++revision,
                rules: values.flatMap(value => value.rule ? [value.rule] : []), diagnostics: values.flatMap(value => value.diagnostic ? [value.diagnostic] : []) };
            publish(kernelId, cache);
        }
        catch (error) {
            if (signal.aborted || closed)
                return;
            remove(cache);
            cache.pending = undefined;
            cache.retry = true;
            report('思源提醒来源 siyuan:' + kernelId + ':reminders: ' + String(error instanceof Error ? error.message : error));
        }
        finally {
            cache.scanning = false;
        }
    };
    const kick = () => {
        if (closed)
            return Promise.resolve();
        active ??= Promise.resolve().then(async () => {
            for (;;) {
                const dirty = [...caches].filter(([, cache]) => cache.ready && (cache.full || cache.roots.size));
                if (!dirty.length || closed)
                    break;
                await Promise.all(dirty.map(([kernelId, cache]) => scan(kernelId, cache)));
            }
        }).finally(() => {
            active = undefined;
            // Promise 收尾与通知回调交错时，仍接续最后一批新标记。
            if (!closed && [...caches.values()].some(cache => cache.ready && (cache.full || cache.roots.size))) {
                void kick().catch(error => report(String(error)));
            }
        });
        return active;
    };
    const receive = (event) => {
        if (closed)
            return;
        const cache = cacheFor(event.kernelId);
        if (event.kind === 'offline') {
            cache.ready = false;
            cache.controller.abort();
            cache.full = false;
            cache.roots.clear();
            cache.pending = undefined;
            cache.retry = false;
            remove(cache);
            if (event.message)
                report('思源提醒订阅 ' + event.kernelId + ': ' + event.message);
            return;
        }
        if (event.kind === 'ready') {
            cache.controller.abort();
            cache.controller = new AbortController();
            cache.ready = true;
            cache.full = true;
        }
        else {
            if (!cache.ready)
                return;
            const roots = event.roots;
            if (!roots || roots.some(id => !ID.test(id)))
                cache.full = true;
            else {
                const known = new Set([...cache.blocks.values()].map(block => block.root));
                // 已知规则文档的任意子块编辑，以及新标记的插入，都需要重新读取所在文档。
                for (const root of roots)
                    if (cache.scanning || cache.full || cache.retry || event.marker || known.has(root))
                        cache.roots.add(root);
            }
        }
        void kick().catch(error => report(String(error)));
    };
    const unwatch = watch(receive);
    const refresh = () => {
        if (closed)
            return Promise.resolve();
        const current = new Set(kernels());
        for (const [id, cache] of caches) {
            if (!current.has(id)) {
                receive({ kernelId: id, kind: 'offline' });
                caches.delete(id);
            }
            else if (cache.ready)
                cache.full = true;
        }
        return kick();
    };
    const timer = setInterval(() => {
        for (const [id, cache] of caches) {
            if (!cache.ready)
                continue;
            if (cache.retry)
                cache.full = true;
            else
                publish(id, cache);
        }
        void kick().catch(error => report(String(error)));
    }, config.refreshMs);
    timer.unref();
    return { refresh, async dispose() {
            closed = true;
            clearInterval(timer);
            for (const cache of caches.values()) {
                cache.controller.abort();
                remove(cache);
            }
            await unwatch();
            await active;
            await Promise.allSettled([...retiring]);
            caches.clear();
        } };
}
/** Aggregate entry: parsing and source lifecycle share one public import. */
export const ReminderSources = { options, parseCallout, attach };
