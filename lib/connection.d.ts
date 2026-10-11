/** 单个插件实例拥有的完整连接能力。工具和其他 Cordis 消费者使用同一实例。 */
import { type ApiConfig } from "./api.js";
import { HttpConnection } from "./http.js";
import { SocketConnections } from "./websocket.js";
import { PluginRpc } from "./rpc.js";
import { McpConnections } from "./mcp.js";
export declare class SiYuanConnection {
    readonly config: ApiConfig;
    readonly http: HttpConnection;
    readonly ws: SocketConnections;
    readonly rpc: PluginRpc;
    readonly mcp: McpConnections;
    private closing?;
    constructor(rawConfig: unknown);
    get discovery(): import("./discovery.js").KernelDiscovery;
    json(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<Response>;
    dispose(): Promise<void>;
}
