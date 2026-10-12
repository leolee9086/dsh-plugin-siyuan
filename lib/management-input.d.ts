/** 人工管理请求的数据边界。输入为普通值或字节流，不访问宿主上下文。 */
declare function required(value: unknown): string;
declare function query(params: URLSearchParams): {
    view: "state";
    kernelId?: undefined;
    filter?: undefined;
    sessionId?: undefined;
    offset?: undefined;
} | {
    view: "endpoints";
    kernelId: string;
    filter: {
        query: string;
        protocol: string;
        method: string;
        decision: string;
        offset: number;
        limit: number;
    };
    sessionId?: undefined;
    offset?: undefined;
} | {
    view: "activity";
    sessionId: string;
    offset: number;
    kernelId?: undefined;
    filter?: undefined;
};
declare function requireJson(contentType: string | undefined): void;
declare function body(chunks: AsyncIterable<Uint8Array | string>): Promise<Record<string, unknown>>;
export declare const ManagementInput: Readonly<{
    required: typeof required;
    query: typeof query;
    requireJson: typeof requireJson;
    body: typeof body;
}>;
export {};
