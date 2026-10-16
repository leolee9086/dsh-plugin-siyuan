import type { ReminderService } from 'dsh-context-care/reminders';
import type { ReminderWatch } from './push.js';
type RuleService = Pick<ReminderService, 'registerSource' | 'validateRule'>;
interface Options {
    refreshMs: number;
}
declare function options(raw: unknown): Options;
/** Parse only the reminder service's native callouts, then read their dsh-rule declaration.
 * The registered rule identity includes the block id; renaming its heading never changes identity. */
declare function parseCallout(value: unknown): {
    id: string;
    title: string;
    text: string;
} | undefined;
/** 订阅负责失效，快照负责内容；计时器只重试失败读取和被容量拒绝的候选。 */
declare function attach(service: RuleService, config: Options, readBlocks: (kernelId: string, roots: string[] | undefined, signal: AbortSignal) => Promise<unknown[]>, report: (message: string) => void, kernels: () => string[], accepts: (kernelId: string, sessionId: string) => boolean, watch: ReminderWatch): {
    refresh: () => Promise<void>;
    dispose(): Promise<void>;
};
/** Aggregate entry: parsing and source lifecycle share one public import. */
export declare const ReminderSources: {
    options: typeof options;
    parseCallout: typeof parseCallout;
    attach: typeof attach;
};
export {};
