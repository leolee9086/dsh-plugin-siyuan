/** 单个插件实例拥有的完整连接能力。工具和其他 Cordis 消费者使用同一实例。 */
import { normalizeConfig } from "./api.js";
import { HttpConnection } from "./http.js";
import { SocketConnections } from "./websocket.js";
import { PluginRpc } from "./rpc.js";
import { McpConnections } from "./mcp.js";
export class SiYuanConnection {
    config;
    http;
    ws;
    rpc;
    mcp;
    closing;
    constructor(rawConfig) {
        this.config = normalizeConfig(rawConfig);
        this.http = new HttpConnection(this.config);
        this.ws = new SocketConnections(this.http);
        this.rpc = new PluginRpc(this.http, this.ws);
        this.mcp = new McpConnections(this.http);
    }
    get discovery() { return this.http.discovery; }
    json(endpoint, payload, signal) {
        return this.http.json(endpoint, payload, signal);
    }
    dispose() {
        this.closing ??= (async () => {
            this.ws.dispose();
            try {
                await this.mcp.dispose();
            }
            finally {
                this.http.dispose();
            }
        })();
        return this.closing;
    }
}
