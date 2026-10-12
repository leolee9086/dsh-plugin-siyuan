import { SiYuanConnection } from "./connection.js";
import { type ToolArgs } from "./tool.js";
export declare const name = "dsh-plugin-siyuan";
export declare const inject: string[];
export declare const SERVICE = "siyuan";
export declare function createTools(connection: SiYuanConnection): {
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
}[];
export declare function apply(ctx: any, rawConfig: unknown): Promise<void>;
