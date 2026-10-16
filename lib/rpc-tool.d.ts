/** 通用 RPC 工具把连接服务投影为可序列化调用；不限制内核接口路径。 */
import { SiYuanConnection } from "./connection.js";
export declare function rpcTool(connection: SiYuanConnection): {
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
