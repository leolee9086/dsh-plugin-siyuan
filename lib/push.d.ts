/** 一条事务操作的可观察摘要；消费者只看自己关心的动作与负载。 */
export interface PushOperation {
    readonly action: string;
    readonly data: unknown;
}
export type KernelPush = {
    kernelId: string;
} & ({
    kind: 'ready';
} | {
    kind: 'offline';
    message?: string;
} | {
    kind: 'change';
    roots?: string[];
    operations: readonly PushOperation[];
});
export type KernelWatch = (listener: (event: KernelPush) => void) => () => Promise<void>;
/** 把操作负载折成可搜索的文本；字符串原样，对象按 JSON。消费者拿它判断自己关心的标记。 */
export declare function textOf(value: unknown): string;
interface Stream {
    ended: Promise<void>;
    dispose(): Promise<void>;
}
interface Pause {
    reason: "authentication" | "permission" | "rate-limit" | "protocol";
    message: string;
    retryAfterSeconds?: number;
}
interface Port {
    kernels(): string[];
    open(kernelId: string, signal: AbortSignal, receive: (value: unknown) => void): Promise<Stream>;
    error(error: unknown): string;
    pause(error: unknown): Pause | undefined;
}
/** 每核心一条只读推送连接；消费者只收到失效通知，不接触 socket 或凭据。 */
export declare class KernelPushHub {
    private port;
    private listeners;
    private runs;
    private retiring;
    private paused;
    private closed;
    constructor(port: Port);
    private emit;
    watch: KernelWatch;
    private stop;
    /** 只有成功提交的连接绑定更新可以解除指定核心的暂停。 */
    reset(resumeFor?: string[]): void;
    pausedState(kernelId: string): {
        reason: "authentication" | "permission" | "rate-limit" | "protocol";
        message: string;
        retryAfterSeconds?: number;
    } | undefined;
    /** HTTP 快照与 WS 共用核心暂停；停止现有流，离线事件撤下已注册的规则。 */
    pause(kernelId: string, error: unknown): Pause | undefined;
    private sync;
    close(): Promise<void>;
}
export {};
