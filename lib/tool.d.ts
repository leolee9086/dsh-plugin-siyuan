export interface ToolArgs {
    [key: string]: unknown;
}
export declare function requiredText(args: ToolArgs, key: string, allowEmpty?: boolean): string;
export declare function optionalText(args: ToolArgs, key: string): string | undefined;
export declare const ID: RegExp;
export declare function requiredId(args: ToolArgs, key: string): string;
export declare function contentType(args: ToolArgs): string;
export declare function dump(value: unknown): string;
export declare function toolDef(name: string, description: string, parameters: Record<string, unknown>, run: (args: ToolArgs, signal?: AbortSignal) => Promise<unknown>): {
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
