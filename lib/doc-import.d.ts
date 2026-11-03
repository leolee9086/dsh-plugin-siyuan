import type { ToolArgs } from "./tool.js";
export type ImportMode = "create" | "replace";
export interface ImportEntry {
    /** 相对 sourceDir 的 POSIX 路径 */
    rel: string;
    title: string;
    hpath: string;
}
export interface ImportPlan {
    kind: "create" | "update" | "skip";
    entry: ImportEntry;
    docId?: string;
}
/** 文档标题取文件名去掉扩展名；嵌套层级由目录给出。 */
export declare function docTitle(rel: string): string;
/** 目标前缀加相对路径拼成文档 hpath；空段与 "." 段不进入路径。 */
export declare function docHPath(targetPath: string, rel: string): string;
/** hpath 的逐级祖先，从根到最深，含自身。 */
export declare function ancestorsOf(hpath: string): string[];
/** 相对路径必须是 sourceDir 内的 markdown 文件，越界路径直接报错。 */
export declare function checkRelative(rel: string): string;
/** 按现有文档决定每个文件是新建、覆盖还是跳过。 */
export declare function planImport(relatives: readonly string[], targetPath: string, existing: ReadonlyMap<string, string>, mode: ImportMode): ImportPlan[];
/** 逆归收集 markdown 文件，返回排序后的相对路径。 */
export declare function markdownFiles(root: string, signal?: AbortSignal): Promise<string[]>;
type Kernel = (endpoint: string, payload: ToolArgs, signal?: AbortSignal) => Promise<unknown>;
/** 自动导入工具：把一个 markdown 目录树写成思源文档树，重复执行不重建已存在的文档。 */
export declare function docImportTool(kernel: Kernel): {
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
};
export {};
