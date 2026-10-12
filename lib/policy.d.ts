/** 逐端点声明。目录可扩展；目录发现与授予权限是两个独立动作。 */
import type { ToolArgs } from "./tool.js";
export type Decision = "deny" | "ask" | "allow";
export type Protocol = "http" | "mcp" | "plugin" | "ws" | "connection";
export interface Endpoint {
    key: string;
    protocol: Protocol;
    method: string;
    path: string;
    detail: string;
    description: string;
    blocked?: string;
    discoveredFor?: string;
}
export interface Grant {
    kernelId: string;
    endpointKey: string;
    decision: Decision;
}
declare function endpoint(protocol: Protocol, method: string, path?: string, detail?: string, description?: string): Endpoint;
/** 不能经任意 HTTP 包裹转发方法授权；执行/代理接口需要更细的效果声明后再开放。 */
declare function blockedHttp(path: string): string | undefined;
/** 不接收 URL 中的凭据；先规范化再匹配，拒绝有歧义的编码和路径折叠。 */
declare function cleanPath(value: unknown): string;
declare function identify(tool: string, args: ToolArgs, describe?: (method: string, path: string) => Promise<{
    spec?: {
        path: string;
    };
}>): Promise<Endpoint[]>;
/** 同一个搜索实现服务过滤、分页和测试；不对过滤结果自动授予权限。 */
declare function filterEndpoints(items: Endpoint[], grants: Grant[], kernelId: string, filter: {
    query?: string;
    protocol?: string;
    method?: string;
    decision?: string;
    offset?: number;
    limit?: number;
}): {
    total: number;
    offset: number;
    limit: number;
    items: {
        decision: Decision;
        key: string;
        protocol: Protocol;
        method: string;
        path: string;
        detail: string;
        description: string;
        blocked?: string;
        discoveredFor?: string;
    }[];
};
/** 逐项授权算法只认识端点和批准结果；审批设施由调用者参数化提供。 */
declare function authorize(items: Endpoint[], grants: Grant[], kernelId: string, approve?: (item: Endpoint) => Promise<string>): Promise<void>;
/** 授权领域的唯一入口，内部识别和筛选实现不向外单独暴露。 */
export declare const EndpointPolicy: Readonly<{
    endpoint: typeof endpoint;
    blockedHttp: typeof blockedHttp;
    cleanPath: typeof cleanPath;
    identify: typeof identify;
    filterEndpoints: typeof filterEndpoints;
    authorize: typeof authorize;
}>;
export {};
