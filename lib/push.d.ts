export type ReminderPush = {
    kernelId: string;
} & ({
    kind: 'ready';
} | {
    kind: 'offline';
    message?: string;
} | {
    kind: 'change';
    roots?: string[];
    marker?: boolean;
});
export type ReminderWatch = (listener: (event: ReminderPush) => void) => () => Promise<void>;
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
export declare class ReminderPushHub {
    private port;
    private listeners;
    private runs;
    private retiring;
    private paused;
    private closed;
    constructor(port: Port);
    private emit;
    watch: ReminderWatch;
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
