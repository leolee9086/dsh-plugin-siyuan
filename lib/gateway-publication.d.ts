import type { Contract } from "./contract.js";
import type { State } from "./control-state.js";
import type { Execution } from "./manager.js";
import type { ToolArgs } from "./tool.js";
type Invoke = (name: string, args: ToolArgs, exec?: Execution) => Promise<{
    summary: string;
}>;
interface GroupSpec {
    id: string;
    title: string;
    origin: string;
    defaultEnabled: boolean;
}
export interface GatewayPort {
    registerGroup(spec: GroupSpec): {
        add(name: string): void;
        remove(name: string): void;
        dispose(): void;
    };
}
export interface PublicationPort extends GatewayPort {
    registerTool(tool: PublishedTool): () => void;
}
export interface GatewayHost {
    get(name: "toolGateway"): GatewayPort;
    get(name: "tools"): {
        register(tool: PublishedTool): () => void;
    };
    effect(effect: () => () => void, label: string): unknown;
}
export interface PublishedTool {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    output: {
        schema: object;
        render(args: unknown, result: {
            summary: string;
        }): {
            type: string;
            text: string;
        }[];
    };
    execute(args: ToolArgs, exec?: Execution): Promise<{
        summary: string;
    }>;
}
export declare class GatewayPublication {
    #private;
    private invoke;
    private port;
    constructor(contract: Contract, invoke: Invoke, port: PublicationPort);
    static inventory(contract: Contract, state: State): {
        http: number;
        mcp: number;
        missingSchemas: number;
    };
    private definitions;
    /** 先校验全部新定义，再按稳定名字更新；普通授权变化不重建工具，不覆盖网关会话开关。 */
    sync(state: State): void;
    get count(): number;
    private clear;
    dispose(): void;
}
export {};
