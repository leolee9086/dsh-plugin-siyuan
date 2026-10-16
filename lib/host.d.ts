/** 第一批五个工具共享完整思源连接；数据原文在参数整理时保持不变。 */
import type { Context } from "@deepseek-ai/cordis";
import type { ReminderService } from "dsh-context-care/reminders";
import { SiYuanConnection } from "./connection.js";
import { KernelManager } from "./manager.js";
export declare const name = "dsh-plugin-siyuan";
export declare const inject: string[];
export declare const SERVICE = "siyuan";
declare module "@deepseek-ai/cordis" {
    interface Context {
        siyuan: Pick<KernelManager, "invoke">;
        reminderRules: ReminderService;
        toolGateway: Pick<Parameters<KernelManager["attachGateway"]>[0], "registerGroup">;
    }
}
export declare function createTools(connection: SiYuanConnection): {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    output: import("@deepseek-ai/dsh-tools").ToolOutputDefinition;
    presentCall: (args: unknown) => {
        card: "generic";
        title: string;
        kind: "other";
        rawInput: unknown;
    };
    execute(args: unknown, exec?: import("./tool.js").ToolExecution): Promise<{
        summary: string;
    }>;
}[];
export declare function apply(ctx: Context, rawConfig: unknown): Promise<void>;
