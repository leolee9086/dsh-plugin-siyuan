import type { CredentialProvider } from "@deepseek-ai/dsh-credentials";
import type { Domain as StorageDomain, KvTable } from "@deepseek-ai/dsh-storage-domain";
import { SiYuanConnection } from "./connection.js";
import { type KernelWatch } from "./push.js";
import { type SkillBody, type SkillDocument } from "./skills.js";
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
        decision: "deny" | "ask" | "ask-full-access" | "allow";
        key: string;
        protocol: import("./policy.js").Protocol;
        method: string;
        path: string;
        detail: string;
        description: string;
        blocked?: string;
        discoveredFor?: string;
        inputSchema?: Record<string, unknown>;
    }[];
};
import { toolDef, type ToolArgs, type ToolExecution } from "./tool.js";
import { type PublicationPort } from "./gateway-publication.js";
export type Execution = ToolExecution;
export type { Kernel } from "./control-state.js";
import { type State, type Activity } from "./control-state.js";
declare const DOMAIN_SPEC: {
    name: string;
    version: number;
    layout: "per-record";
    tables: {
        config: {
            valueSchema: import("zod").ZodPipe<import("zod").ZodPreprocess<import("zod").ZodCustom<State, State>, unknown>, import("zod").ZodTransform<State, State>>;
        };
        activity: {
            valueSchema: import("zod").ZodPipe<import("zod").ZodPreprocess<import("zod").ZodCustom<Activity, Activity>, unknown>, import("zod").ZodTransform<Activity, Activity>>;
        };
    };
};
export { DOMAIN_SPEC };
type Table<T> = Pick<KvTable<string, T>, "get" | "entries"> & Pick<KvTable<string, unknown>, "put">;
export type Domain = Pick<StorageDomain<typeof DOMAIN_SPEC>, "close"> & {
    table(name: keyof typeof DOMAIN_SPEC.tables): Table<unknown>;
};
export type Credentials = Pick<CredentialProvider, "set" | "unset"> & {
    resolve(...args: Parameters<CredentialProvider["resolve"]>): Promise<Pick<NonNullable<Awaited<ReturnType<CredentialProvider["resolve"]>>>, "value"> | undefined>;
    describe(...args: Parameters<CredentialProvider["describe"]>): Promise<Pick<Awaited<ReturnType<CredentialProvider["describe"]>>, "configured" | "writable">>;
};
type Runner = (connection: SiYuanConnection, name: string, args: ToolArgs, exec?: Execution) => Promise<{
    summary: string;
}>;
export declare class KernelManager {
    #private;
    private domain;
    private credentials;
    private run;
    private approve?;
    watchKernels: KernelWatch;
    /** 可选网关出现/消失时仅挂载/释放扩展工具，五个基础工具始终独立可用。 */
    attachGateway(port: PublicationPort): () => void;
    private syncGateway;
    gatewayState(): {
        http: number;
        mcp: number;
        missingSchemas: number;
        available: boolean;
        requested: boolean;
        registered: number;
        error: string;
    };
    registerGateway(enabled: boolean): Promise<{
        http: number;
        mcp: number;
        missingSchemas: number;
        available: boolean;
        requested: boolean;
        registered: number;
        error: string;
    }>;
    defineTool(name: string, validate: (args: unknown) => boolean): void;
    readonly contract: import("./contract.js").Contract;
    constructor(domain: Domain, credentials: Credentials, run: Runner, approve?: ((exec: Execution, reason: string, decision: Decision) => Promise<string>) | undefined);
    initialize(rawConfig: unknown): Promise<void>;
    private refreshSecrets;
    private kernel;
    private serial;
    private persist;
    private commit;
    private connect;
    private release;
    private catalog;
    /** Discover rules from existing enabled connections; no separate rule-root configuration. */
    reminderKernels(): string[];
    /** 插件内部固定读取提醒块；与模型工具的端点审批分开，也不发布到公共服务。 */
    readReminderBlocks(kernelId: string, roots: string[] | undefined, signal: AbortSignal): Promise<unknown[]>;
    /** 技能只有一个来源核心：当前默认核心。没有可用核心时提供方给空目录。 */
    skillKernel(): string | undefined;
    /**
     * 只读技能访问：SQL 与导出参数都在这里写死，不经过端点授权，也不发布到公共服务。
     * 读之前先等事务与索引队列落盘，保证刚打的标签、刚写的内容查得到。
     */
    private readKernel;
    /**
     * 发现：带技能标签的文档，声明是它的第一条子块。
     *
     * SQL 只负责找文档——块的 sort 不反映文档顺序，位置只能读实时接口。
     */
    listSkills(kernelId: string, signal?: AbortSignal): Promise<SkillDocument[]>;
    /** 加载：整篇导出，再列出同目录的文档作为附件。 */
    readSkill(kernelId: string, docId: string, signal?: AbortSignal): Promise<SkillBody>;
    /** 会话从独立选择的规则核心接收内容，规则自身再筛选适用会话。 */
    acceptsReminder(kernelId: string, sessionId: string): boolean;
    publicState(): Promise<{
        revision: number;
        defaultKernelId: string | null;
        gateway: {
            http: number;
            mcp: number;
            missingSchemas: number;
            available: boolean;
            requested: boolean;
            registered: number;
            error: string;
        };
        kernels: {
            credential: Pick<import("@deepseek-ai/dsh-credentials").CredentialInfo, "configured" | "writable">;
            reminderPause: {
                reason: "authentication" | "permission" | "rate-limit" | "protocol";
                message: string;
                retryAfterSeconds?: number;
            } | undefined;
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
            decision: "deny" | "ask" | "ask-full-access" | "allow";
            key: string;
            protocol: import("./policy.js").Protocol;
            method: string;
            path: string;
            detail: string;
            description: string;
            blocked?: string;
            discoveredFor?: string;
            inputSchema?: Record<string, unknown>;
        }[];
    };
    activities(sessionId: string, offset?: number, limit?: number): unknown;
    saveKernel(input: Record<string, unknown>): Promise<{
        id: string;
    }>;
    removeKernel(id: string): Promise<void>;
    select(kernelId: string | null, sessionId?: string): Promise<void>;
    selectRuleSource(kernelId: string | null, sessionId: string): Promise<void>;
    declare(input: Record<string, unknown>): Promise<Endpoint>;
    grant(kernelId: string, endpointKey: string, decision: Decision): Promise<void>;
    /** 候选探针不携带凭据，也不依赖旧 PID 是否仍可连接。 */
    connectionInstances(kernelId: string): Promise<{
        mode: string;
        apiUrl: string;
        portFile?: undefined;
        selectedPid?: undefined;
        instances?: undefined;
    } | {
        mode: string;
        portFile: string;
        selectedPid: number | null;
        instances: import("./discovery.js").KernelInstance[];
        apiUrl?: undefined;
    }>;
    selectInstance(kernelId: string, pid: unknown): Promise<{
        kernelId: string;
        selectedPid: number | undefined;
    }>;
    /** 每次派发前重新发现，串行保存恢复结果；进行中的业务请求固定原目标。 */
    private bindConnection;
    inspectConnection(kernelId: string, discoverMcp?: boolean): Promise<{
        apiUrl: string;
        version: string;
        accessAvailable: boolean;
        credentialSent: boolean;
        mcpTools: number;
    }>;
    /** 宿主工具和公共服务消费者均走这个方法，外部拿不到带 token 的原始连接。 */
    invoke(name: string, input: ToolArgs, exec?: Execution): Promise<{
        summary: string;
    }>;
    /** 为管理 HTTP 接口提供安全投影，任何异常都不携带原始请求或凭据。 */
    safe(value: unknown): unknown;
    error(error: unknown): Error;
    errorText(error: unknown): string;
    close(): Promise<void>;
}
/** 五个业务工具增加目标选择参数，核心目录独立注册并沿用同一个管理器入口。 */
export declare function managedTools(manager: KernelManager, templates: ReturnType<typeof toolDef>[]): ({
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    output: import("@deepseek-ai/dsh-tools").ToolOutputDefinition;
    presentCall: (args: unknown) => {
        card: "generic";
        title: string;
        kind: "other";
        rawInput: unknown;
    };
    execute(args: unknown, exec?: ToolExecution): Promise<{
        summary: string;
    }>;
} | {
    parameters: {
        properties: {
            kernelId: {
                type: string;
                description: string;
            };
            action?: {
                type: string;
                enum: string[];
            } | undefined;
        };
    };
    description: string;
    execute(args: unknown, exec?: Execution): Promise<{
        summary: string;
    }>;
    name: string;
    output: import("@deepseek-ai/dsh-tools").ToolOutputDefinition;
    presentCall: (args: unknown) => {
        card: "generic";
        title: string;
        kind: "other";
        rawInput: unknown;
    };
})[];
