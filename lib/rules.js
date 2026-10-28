import { z } from 'zod';
const Options = z.object({ refreshMs: z.number().int().min(1000).max(3600000).default(30000) }).strict();
const Config = z.object({ reminders: Options.default({ refreshMs: 30000 }) }).passthrough();
const Block = z.object({ id: z.string(), root_id: z.string().optional(), type: z.string(), subtype: z.string().optional(), markdown: z.string() });
/** 接收内核标准 Markdown，只移除 callout 容器；正文和代码字面量保持原样交给引擎。 */
function documents(input) {
    return z.array(Block).parse(input).flatMap(block => {
        if (block.type !== 'callout' || block.subtype !== 'DSH-REMINDER')
            return [];
        const lines = block.markdown.split(/\r?\n/).map(line => line.replace(/^\s*>[ \t]?/, ''));
        const heading = /^\[!DSH-REMINDER\]\s*(.*)$/i.exec(lines[0]?.trim() ?? '');
        if (!heading)
            return [];
        const text = lines.slice(1).join('\n').trim();
        return [{ id: block.id, rootId: block.root_id ?? '', title: heading[1].trim(), text }];
    });
}
function options(raw) { return Config.parse(raw ?? {}).reminders; }
function attach(service, config, readBlocks, report, kernels, accepts, watch) {
    return service.connectDocuments({
        plugin: 'dsh-plugin-siyuan', refreshMs: config.refreshMs, keys: kernels, accepts, report,
        sourceId: key => `siyuan:${key}:reminders`,
        async read(key, roots, signal) { return documents(await readBlocks(key, roots, signal)); },
        watch(receive) { return watch(event => { const { kernelId, ...change } = event; receive({ ...change, key: kernelId }); }); },
    });
}
export const ReminderSources = { options, documents, attach };
