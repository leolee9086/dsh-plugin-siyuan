/** 逐端点声明。目录可扩展；目录发现与授予权限是两个独立动作。 */
import type { ToolArgs } from "./tool.js";
declare const decisions: readonly ["deny", "ask", "ask-full-access", "allow"];
export type Decision = typeof decisions[number];
/** 缺省端点每次询问，完全权限下拒绝；显式设置只作用于所属核心和端点。 */
declare function decisionFor(grants: Grant[], kernelId: string, endpointKey: string): Decision;
/** 两种询问策略在完全权限下分别决定，其他模式交给宿主审批。 */
declare function approvalRoute(decision: Decision, mode: string | undefined): "unavailable" | "request" | "full-access-allowed" | "full-access-denied";
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
    inputSchema?: Record<string, unknown>;
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
        decision: "deny" | "ask" | "ask-full-access" | "allow";
        key: string;
        protocol: Protocol;
        method: string;
        path: string;
        detail: string;
        description: string;
        blocked?: string;
        discoveredFor?: string;
        inputSchema?: Record<string, unknown>;
    }[];
};
/** 逐项授权算法只认识端点和批准结果；审批设施由调用者参数化提供。 */
declare function authorize(items: Endpoint[], grants: Grant[], kernelId: string, approve?: (item: Endpoint, decision: Decision) => Promise<string>): Promise<void>;
/** 授权领域的唯一入口，内部识别和筛选实现不向外单独暴露。 */
export declare const EndpointPolicy: Readonly<{
    decisions: readonly ["deny", "ask", "ask-full-access", "allow"];
    defaultDecision: "ask";
    decisionFor: typeof decisionFor;
    approvalRoute: typeof approvalRoute;
    endpoint: typeof endpoint;
    blockedHttp: typeof blockedHttp;
    cleanPath: typeof cleanPath;
    identify: typeof identify;
    filterEndpoints: typeof filterEndpoints;
    authorize: typeof authorize;
}>;
export {};
