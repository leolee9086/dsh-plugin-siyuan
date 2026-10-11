import { type Router, type RouterContext } from "@leolee9086/sac-path-router";
export interface EndpointSpec {
    method: string;
    path: string;
    body: string;
    handler: string;
    output: string | null;
    request: unknown;
}
export interface ContractFile {
    siyuanVersion: string;
    endpointCount: number;
    endpoints: EndpointSpec[];
    $defs: Record<string, unknown>;
}
export declare class ContractError extends Error {
    readonly spec: EndpointSpec;
    readonly problems: string[];
    constructor(spec: EndpointSpec, problems: string[]);
}
export declare class Contract {
    readonly version: string;
    readonly endpoints: EndpointSpec[];
    private readonly defs;
    private readonly ajv;
    private readonly validators;
    constructor(file: ContractFile);
    /** Gin 的 *name 是带名字的剩余路径；转换成路由库的命名重复参数。 */
    router<C extends RouterContext>(handler: (ctx: C, spec: EndpointSpec) => Promise<void>): Router<C>;
    check(spec: EndpointSpec, payload: unknown): void;
    /** 返回端点请求 Schema 的引用闭包，调用方可以直接交给 JSON Schema 校验库。 */
    requestSchema(spec: EndpointSpec): unknown;
}
export declare function loadContract(): Contract;
