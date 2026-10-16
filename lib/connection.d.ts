/** 单个插件实例拥有的完整连接能力。工具和其他 Cordis 消费者使用同一实例。 */
import { type ApiConfig } from "./api.js";
import { HttpConnection } from "./http.js";
import { SocketConnections } from "./websocket.js";
import { PluginRpc } from "./rpc.js";
import { McpConnections } from "./mcp.js";
export declare class SiYuanConnection {
    /** 管理器通过连接聚合入口取得安全分类，不依赖 WS 内部错误实现。 */
    static pushPause: (error: unknown) => import("./websocket.js").SocketPause | undefined;
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
