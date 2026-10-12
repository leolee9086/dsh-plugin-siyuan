/** 逐端点声明。目录可扩展；目录发现与授予权限是两个独立动作。 */
import type { ToolArgs } from "./tool.js";

export type Decision = "deny" | "ask" | "allow";
export type Protocol = "http" | "mcp" | "plugin" | "ws" | "connection";
export interface Endpoint {
  key: string; protocol: Protocol; method: string; path: string; detail: string;
  description: string; blocked?: string; discoveredFor?: string;
}
export interface Grant { kernelId: string; endpointKey: string; decision: Decision }
function endpoint(protocol: Protocol, method: string, path = "", detail = "", description = ""): Endpoint {
  return { key: JSON.stringify([protocol, method, path, detail]), protocol, method, path, detail, description };
}

/** 不能经任意 HTTP 包裹转发方法授权；执行/代理接口需要更细的效果声明后再开放。 */
function blockedHttp(path: string): string | undefined {
  if (/^\/(?:mcp(?:\/|$)|api\/plugin\/rpc(?:\/|$)|ws(?:\/|$))/.test(path)) {
    return "请使用对应的 MCP、插件 RPC 或 WS 通道，分别授权具体方法";
  }
  if (/^\/api\/(?:network\/(?:forwardProxy|proxy)(?:\/|$)|transactions$|system\/(?:exit|bootProgress|setAPIToken)|system\/setNetworkProxy)/.test(path)) {
    return "此代理、事务或系统操作尚无内部效果解析，本阶段不开放";
  }
  return undefined;
}

/** 不接收 URL 中的凭据；先规范化再匹配，拒绝有歧义的编码和路径折叠。 */
function cleanPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\#\r\n]/.test(value)) {
    throw new Error("端点必须为内核内的绝对路径");
  }
  const url = new URL(value, "http://siyuan.invalid");
  const raw = value.split("?")[0]!;
  if (url.pathname !== raw || raw.includes("%")) throw new Error("端点路径存在歧义");
  return url.pathname;
}
const CRUD: Record<string, Record<string, string>> = {
  siyuan_query: { notebooks: "/api/notebook/lsNotebooks", docs: "/api/query/sql", sql: "/api/query/sql",
    read: "/api/block/getBlockKramdown", children: "/api/block/getChildBlocks", search: "/api/search/fullTextSearchBlock" },
  siyuan_create: { doc: "/api/filetree/createDocWithMd", append: "/api/block/appendBlock", block: "/api/block/insertBlock" },
  siyuan_update: { rename_doc: "/api/filetree/renameDocByID", block: "/api/block/updateBlock" },
  siyuan_delete: { doc: "/api/filetree/removeDocByID", block: "/api/block/deleteBlock" },
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("方法参数必须为对象");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) throw new Error("缺少有效方法或目标名称");
  return value;
}
async function identify(tool: string, args: ToolArgs,
  describe?: (method: string, path: string) => Promise<{ spec?: { path: string } }>): Promise<Endpoint[]> {
  if (tool !== "siyuan_rpc") {
    const path = CRUD[tool]?.[String(args.action)];
    if (!path) throw new Error("未知思源操作");
    return [endpoint("http", "POST", path)];
  }
  // 请求头只允许业务头；认证值在宿主从 credentials 注入。
  if (args.headers && Object.keys(object(args.headers)).some(key => /authorization|cookie|token|api[-_]?key|proxy/i.test(key))) {
    throw new Error("工具不能指定认证头，请在思源核心配置中设置凭据");
  }
  switch (args.channel) {
    case "contract": return [];
    case "connection": {
      if (args.action !== "status") throw new Error("实例切换请在思源界面修改 PID，修改后重新授权");
      return [endpoint("connection", "status")];
    }
    case "http": {
      const path = cleanPath(args.path);
      const blocked = blockedHttp(path);
      if (blocked) throw new Error(blocked);
      const method = String(args.method ?? "POST").toUpperCase();
      if (!describe) throw new Error("HTTP 端点识别缺少契约查询能力");
      const { spec } = await describe(method, path);
      return [endpoint("http", method, spec?.path ?? path)];
    }
    case "mcp": {
      const method = text(args.method);
      // 外层 tools/call 的授权只代表使用该操作，不代表所有 MCP 工具都获准。
      const result = [endpoint("mcp", method)];
      if (method === "tools/call") result.push(endpoint("mcp", method, "", text(object(args.params).name)));
      // 含身份与会话初始化的通知由 SDK 管理，不接受模型构造替代握手。
      if (/^(?:initialize|notifications\/initialized|notifications\/cancelled)$/.test(method)) {
        throw new Error("MCP 生命周期由连接管理器维护");
      }
      return result;
    }
    case "plugin": {
      const plugin = args.plugin === undefined ? "" : text(args.plugin);
      const calls = args.calls === undefined ? [{ method: args.method }] : args.calls as ToolArgs[];
      if (!Array.isArray(calls) || !calls.length) throw new Error("批量调用必须非空");
      const result = calls.map(call => endpoint("plugin", text(call.method), plugin));
      if (args.calls !== undefined) result.unshift(endpoint("plugin", "$batch", plugin));
      return result;
    }
    case "ws": {
      const path = cleanPath(args.path);
      if (/^\/ws\/plugin\/rpc(?:\/|$)/.test(path)) throw new Error("插件 WS RPC 请使用 plugin 通道");
      const result = [endpoint("ws", "connect", path)];
      for (const message of (args.messages ?? []) as unknown[]) {
        if (typeof message !== "string") throw new Error("二进制 WS 消息尚无法声明效果，本阶段不发送");
        let value: unknown;
        try { value = JSON.parse(message); } catch { throw new Error("WS 发送需要含 cmd 的 JSON 对象"); }
        result.push(endpoint("ws", "send", path, text(object(value).cmd)));
      }
      return result;
    }
    default: throw new Error("未知思源通道");
  }
}

/** 同一个搜索实现服务过滤、分页和测试；不对过滤结果自动授予权限。 */
function filterEndpoints(items: Endpoint[], grants: Grant[], kernelId: string,
  filter: { query?: string; protocol?: string; method?: string; decision?: string; offset?: number; limit?: number }) {
  const decisions = new Map(grants.filter(g => g.kernelId === kernelId).map(g => [g.endpointKey, g.decision]));
  const words = (filter.query ?? "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matched = items.map(item => ({ ...item, decision: decisions.get(item.key) ?? "deny" })).filter(item => {
    const haystack = `${item.protocol} ${item.method} ${item.path} ${item.detail} ${item.description}`.toLocaleLowerCase();
    return (!filter.protocol || item.protocol === filter.protocol) && (!filter.method || item.method === filter.method)
      && (!filter.decision || item.decision === filter.decision) && words.every(word => haystack.includes(word));
  });
  const offset = Math.max(0, filter.offset ?? 0), limit = Math.min(100, Math.max(1, filter.limit ?? 40));
  return { total: matched.length, offset, limit, items: matched.slice(offset, offset + limit) };
}

/** 逐项授权算法只认识端点和批准结果；审批设施由调用者参数化提供。 */
async function authorize(items: Endpoint[], grants: Grant[], kernelId: string,
  approve?: (item: Endpoint) => Promise<string>): Promise<void> {
  for (const item of items) {
    const decision = grants.find(g => g.kernelId === kernelId && g.endpointKey === item.key)?.decision ?? "deny";
    if (decision === "deny") throw new Error(`端点未授权：${item.protocol} ${item.method} ${item.path} ${item.detail}`);
    if (decision === "ask") {
      const outcome = approve ? await approve(item) : "unavailable";
      if (outcome !== "allowed-once") throw new Error(`思源端点批准未获得：${outcome}`);
    }
  }
}

/** 授权领域的唯一入口，内部识别和筛选实现不向外单独暴露。 */
export const EndpointPolicy = Object.freeze({ endpoint, blockedHttp, cleanPath, identify, filterEndpoints, authorize });
