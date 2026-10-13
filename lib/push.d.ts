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
interface Port {
    kernels(): string[];
    open(kernelId: string, signal: AbortSignal, receive: (value: unknown) => void): Promise<Stream>;
    error(error: unknown): string;
}
/** 每核心一条只读推送连接；消费者只收到失效通知，不接触 socket 或凭据。 */
export declare class ReminderPushHub {
    private port;
    private listeners;
    private runs;
    private retiring;
    private closed;
    constructor(port: Port);
    private emit;
    watch: ReminderWatch;
    private stop;
    /** 持久配置 ACK 后重建连接快照；旧连接事件由 controller 隔离。 */
    reset(): void;
    private sync;
    close(): Promise<void>;
}
export {};
