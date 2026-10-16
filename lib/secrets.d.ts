/** 工具输出、管理结果与错误共用的凭据投影。这个对象从不提供读取秘密的方法。 */
export declare class SecretFilter {
    #private;
    remember(secret: string): void;
    private replaceKnown;
    text(value: string): string;
    value(value: unknown): unknown;
    private projectRecord;
    /** 仅在 MCP 协议定义的内容位置省略媒体，structuredContent 和资源数据仍按业务值处理。 */
    mcp(value: unknown, method: string): unknown;
    error(error: unknown): Error;
}
