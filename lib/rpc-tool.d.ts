/** 通用 RPC 工具把连接服务投影为可序列化调用；不限制内核接口路径。 */
import { SiYuanConnection } from "./connection.js";
import { type ToolArgs } from "./tool.js";
export declare function rpcTool(connection: SiYuanConnection): {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    output: {
        schema: {
            type: string;
            properties: {
                summary: {
                    type: string;
                };
            };
            required: string[];
            additionalProperties: boolean;
        };
        render: (_args: unknown, result: {
            summary: string;
        }) => {
            type: string;
            text: string;
        }[];
    };
    presentCall: (args: unknown) => {
        card: string;
        title: string;
        kind: string;
        rawInput: unknown;
    };
    execute(args: ToolArgs, exec?: {
        signal?: AbortSignal;
    }): Promise<{
        summary: string;
    }>;
};
