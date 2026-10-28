import { z } from 'zod';
import type { ReminderService } from 'dsh-context-care/reminders';
import type { ReminderWatch } from './push.js';
declare const Options: z.ZodObject<{
    refreshMs: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
/** 接收内核标准 Markdown，只移除 callout 容器；正文和代码字面量保持原样交给引擎。 */
declare function documents(input: unknown): {
    id: string;
    rootId: string;
    title: string;
    text: string;
}[];
declare function options(raw: unknown): {
    refreshMs: number;
};
declare function attach(service: Pick<ReminderService, 'connectDocuments'>, config: z.infer<typeof Options>, readBlocks: (kernelId: string, roots: string[] | undefined, signal: AbortSignal) => Promise<unknown[]>, report: (message: string) => void, kernels: () => string[], accepts: (kernelId: string, sessionId: string) => boolean, watch: ReminderWatch): {
    refresh: () => Promise<void>;
    dispose(): Promise<void>;
};
export declare const ReminderSources: {
    options: typeof options;
    documents: typeof documents;
    attach: typeof attach;
};
export {};
