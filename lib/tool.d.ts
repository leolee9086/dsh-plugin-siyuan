import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";
export interface ToolArgs {
    [key: string]: unknown;
}
export type ToolExecution = Partial<Pick<ToolRunContext, "signal" | "callId" | "name" | "agent">> & {
    /** 领域调用可直接传会话 ID；Host 调用从真实 Agent 取得身份。 */
    sessionId?: string;
};
export declare function requiredText(args: ToolArgs, key: string, allowEmpty?: boolean): string;
export declare function optionalText(args: ToolArgs, key: string): string | undefined;
export declare const ID: RegExp;
export declare function requiredId(args: ToolArgs, key: string): string;
export declare function contentType(args: ToolArgs): string;
export declare function dump(value: unknown): string;
/** 常规工具与网关工具共用真实 DSH 输出声明。
 * 显式引用公共类型，让声明生成器保留包名，避免泄漏 pnpm 的内部解析路径。 */
export declare const summaryOutput: ToolDefinition["output"];
export declare function toolDef(name: string, description: string, parameters: Record<string, unknown>, run: (args: ToolArgs, signal?: AbortSignal, exec?: ToolExecution) => Promise<unknown>): {
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
    execute(args: unknown, exec?: ToolExecution): Promise<{
        summary: string;
    }>;
};
