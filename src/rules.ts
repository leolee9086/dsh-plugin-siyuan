import { z } from 'zod';
import type { ReminderService } from 'dsh-context-care/reminders';
import { textOf, type KernelWatch } from './push.js';
/** 提醒块自己的标记；只有事务里出现它，才说明规则内容可能变了。 */
const MARKER = 'DSH-REMINDER';

const Options = z.object({ refreshMs: z.number().int().min(1000).max(3600000).default(30000) }).strict();
const Config = z.object({ reminders: Options.default({ refreshMs: 30000 }) }).passthrough();
const Block = z.object({ id: z.string(), root_id: z.string().optional(), type: z.string(), subtype: z.string().optional(), markdown: z.string() });

/** 接收内核标准 Markdown，只移除 callout 容器；正文和代码字面量保持原样交给引擎。 */
function documents(input: unknown) {
  return z.array(Block).parse(input).flatMap(block => {
    if (block.type !== 'callout' || block.subtype !== 'DSH-REMINDER') return [];
    const lines = block.markdown.split(/\r?\n/).map(line => line.replace(/^\s*>[ \t]?/, ''));
    const heading = /^\[!DSH-REMINDER\]\s*(.*)$/i.exec(lines[0]?.trim() ?? '');
    if (!heading) return [];
    const text = lines.slice(1).join('\n').trim();
    return [{ id: block.id, rootId: block.root_id ?? '', title: heading[1].trim(), text }];
  });
}
function options(raw: unknown) { return Config.parse(raw ?? {}).reminders; }

function attach(service: Pick<ReminderService, 'connectDocuments'>, config: z.infer<typeof Options>,
  readBlocks: (kernelId: string, roots: string[] | undefined, signal: AbortSignal) => Promise<unknown[]>, report: (message: string) => void,
  kernels: () => string[], accepts: (kernelId: string, sessionId: string) => boolean, watch: KernelWatch) {
  return service.connectDocuments({
    plugin: 'dsh-plugin-siyuan', refreshMs: config.refreshMs, keys: kernels, accepts, report,
    sourceId: key => `siyuan:${key}:reminders`,
    async read(key, roots, signal) { return documents(await readBlocks(key, roots, signal)); },
    watch(receive) {
      return watch(event => {
        if (event.kind !== 'change') {
          receive({ key: event.kernelId, kind: event.kind, ...(event.kind === 'offline' ? { message: event.message } : {}) });
          return;
        }
        // 属性变更的负载是对象，先折成文本再比，不然标记判断会漏掉打标签这类操作。
        receive({ key: event.kernelId, kind: 'change', ...(event.roots === undefined ? {} : { roots: event.roots }),
          marker: event.operations.some(operation => textOf(operation.data).includes(MARKER)) });
      });
    },
  });
}

export const ReminderSources = { options, documents, attach };
