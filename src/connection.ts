/** 单个插件实例拥有的完整连接能力。工具和其他 Cordis 消费者使用同一实例。 */
import { normalizeConfig, type ApiConfig } from "./api.js";
import { HttpConnection } from "./http.js";
import { SocketConnections } from "./websocket.js";
import { PluginRpc } from "./rpc.js";
import { McpConnections } from "./mcp.js";

export class SiYuanConnection {
  readonly config: ApiConfig;
  readonly http: HttpConnection;
  readonly ws: SocketConnections;
  readonly rpc: PluginRpc;
  readonly mcp: McpConnections;
  private closing?: Promise<void>;

  constructor(rawConfig: unknown) {
    this.config = normalizeConfig(rawConfig);
    this.http = new HttpConnection(this.config);
    this.ws = new SocketConnections(this.http);
    this.rpc = new PluginRpc(this.http, this.ws);
    this.mcp = new McpConnections(this.http);
  }
  get discovery() { return this.http.discovery; }

  json(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<Response> {
    return this.http.json(endpoint, payload, signal);
  }
  dispose(): Promise<void> {
    this.closing ??= (async () => {
      this.ws.dispose();
      try { await this.mcp.dispose(); }
      finally { this.http.dispose(); }
    })();
    return this.closing;
  }
}
