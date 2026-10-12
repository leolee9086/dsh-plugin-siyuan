import { type Endpoint, type Grant } from "./policy.js";
export interface Kernel {
    id: string;
    name: string;
    apiUrl: string;
    timeoutMs: number;
    portFile?: string;
    kernelPid?: number;
    enabled: boolean;
}
export interface State {
    revision: number;
    kernels: Kernel[];
    defaultKernelId: string | null;
    grants: Grant[];
    endpoints: Endpoint[];
    sessions: Record<string, string>;
    gatewayTools?: boolean;
}
export interface Activity {
    id: string;
    sessionId: string;
    callId: string;
    time: string;
    tool: string;
    kernelId: string;
    kernelName: string;
    target?: string;
    endpoints: Endpoint[];
    resources: string[];
    status: string;
    elapsedMs?: number;
    error?: string;
    authorization?: {
        endpointKey: string;
        decision: string;
        outcome: string;
    }[];
}
/** 换绑撤权与目录隔离属于数据变换，不需要模拟存储服务才能验证。 */
declare function revokeBinding(state: State, kernelId: string): void;
declare function replaceDiscovered(state: State, kernelId: string, items: Endpoint[]): void;
declare function recoverActivity(item: Activity): Activity;
declare function targetId(state: State, explicit: unknown, sessionId?: string): unknown;
declare function selectKernel(state: State, explicit: unknown, sessionId?: string): Kernel;
/** 首次发现只接受唯一实例；已绑定配置和重新指定地址的撤权由各自入口处理。 */
declare function bindDiscovered(state: State, kernelId: string, instances: {
    pid: number;
}[]): void;
declare function requireBoundKernel(kernel: Kernel): void;
declare function requireRevision(expected: number, current: number, closed: boolean, message: string): void;
/** 状态领域唯一入口；宿主适配器和行为测试均通过此入口使用数据规则。 */
export declare const ControlState: Readonly<{
    DOMAIN_SPEC: {
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
    revokeBinding: typeof revokeBinding;
    replaceDiscovered: typeof replaceDiscovered;
    recoverActivity: typeof recoverActivity;
    targetId: typeof targetId;
    selectKernel: typeof selectKernel;
    bindDiscovered: typeof bindDiscovered;
    requireBoundKernel: typeof requireBoundKernel;
    requireRevision: typeof requireRevision;
}>;
export {};
