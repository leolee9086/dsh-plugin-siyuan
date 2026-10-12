/** 工具输出、管理结果与错误共用的凭据投影。这个对象从不提供读取秘密的方法。 */
export declare class SecretFilter {
    #private;
    remember(secret: string): void;
    private replaceKnown;
    text(value: string): string;
    value(value: unknown): any;
    error(error: unknown): Error;
}
