import { SiYuanConnection } from "./connection.js";
import { type Endpoint, type Decision } from "./policy.js";
declare const filterEndpoints: (items: Endpoint[], grants: import("./policy.js").Grant[], kernelId: string, filter: {
    query?: string;
    protocol?: string;
    method?: string;
    decision?: string;
    offset?: number;
    limit?: number;
}) => {
    total: number;
    offset: number;
    limit: number;
    items: {
        decision: Decision;
        key: string;
        protocol: import("./policy.js").Protocol;
        method: string;
        path: string;
        detail: string;
        description: string;
        blocked?: string;
        discoveredFor?: string;
    }[];
};
import type { ToolArgs } from "./tool.js";
export interface Execution {
    signal?: AbortSignal;
    callId?: string;
    name?: string;
    agent?: {
        session: {
            id: string;
        };
    };
}
export type { Kernel } from "./control-state.js";
declare const DOMAIN_SPEC: {
    name: string;
    version: number;
    layout: string;
    tables: {
        config: {
            valueSchema: {
                parse(value: any): any;
            };
        };
        activity: {
            valueSchema: {
                parse(value: any): any;
            };
        };
    };
};
export { DOMAIN_SPEC };
interface Table<T> {
    get(key: string): T | undefined;
    put(key: string, value: T): Promise<void>;
    entries(): IterableIterator<[string, T]>;
}
export interface Domain {
    table(name: string): Table<any>;
    close(): Promise<void>;
}
export interface Credentials {
    resolve(ref: string): Promise<{
        value: string;
    } | undefined>;
    describe(ref: string): Promise<{
        configured: boolean;
        writable: boolean;
    }>;
    set(ref: string, value: string): Promise<void>;
    unset(ref: string): Promise<void>;
}
type Runner = (connection: SiYuanConnection, name: string, args: ToolArgs, exec?: Execution) => Promise<{
    summary: string;
}>;
export declare class KernelManager {
    #private;
    private domain;
    private credentials;
    private run;
    private approve?;
    defineTool(name: string, validate: (args: unknown) => boolean): void;
    readonly contract: import("./contract.js").Contract;
    constructor(domain: Domain, credentials: Credentials, run: Runner, approve?: ((exec: Execution, reason: string) => Promise<string>) | undefined);
    initialize(rawConfig: unknown): Promise<void>;
    private refreshSecrets;
    private kernel;
    private serial;
    private commit;
    private connect;
    private release;
    private catalog;
    publicState(): Promise<{
        revision: number;
        defaultKernelId: string | null;
        kernels: {
            credential: {
                configured: boolean;
                writable: boolean;
            };
            id: string;
            name: string;
            apiUrl: string;
            timeoutMs: number;
            portFile?: string;
            kernelPid?: number;
            enabled: boolean;
        }[];
    }>;
    endpoints(kernelId: string, filter: Parameters<typeof filterEndpoints>[3]): {
        total: number;
        offset: number;
        limit: number;
        items: {
            decision: Decision;
            key: string;
            protocol: import("./policy.js").Protocol;
            method: string;
            path: string;
            detail: string;
            description: string;
            blocked?: string;
            discoveredFor?: string;
        }[];
    };
    activities(sessionId: string, offset?: number, limit?: number): any;
    saveKernel(input: Record<string, unknown>): Promise<{
        id: string;
    }>;
    removeKernel(id: string): Promise<void>;
    select(kernelId: string | null, sessionId?: string): Promise<void>;
    declare(input: Record<string, unknown>): Promise<Endpoint>;
    grant(kernelId: string, endpointKey: string, decision: Decision): Promise<void>;
    inspectConnection(kernelId: string, discoverMcp?: boolean): Promise<any>;
    /** 宿主工具和公共服务消费者均走这个方法，外部拿不到带 token 的原始连接。 */
    invoke(name: string, input: ToolArgs, exec?: Execution): Promise<{
        summary: string;
    }>;
    /** 为管理 HTTP 接口提供安全投影，任何异常都不携带原始请求或凭据。 */
    safe(value: unknown): any;
    error(error: unknown): Error;
    close(): Promise<void>;
}
/** 工具注册时只增加目标选择参数，工具数量仍为五个，配置写入不成为模型工具。 */
export declare function managedTools(manager: KernelManager, templates: any[]): any[];
