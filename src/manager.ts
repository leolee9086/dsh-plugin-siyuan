/** 宿主共享的核心管理器。持久配置不含凭据值，对消费者只开放受控 invoke。 */
import { randomUUID } from "node:crypto";
import Ajv from "ajv";
import { SiYuanConnection } from "./connection.js";
import { normalizeConfig, KernelError } from "./api.js";
import { loadContract } from "./contract.js";
import { SecretFilter } from "./secrets.js";
import { EndpointPolicy, type Endpoint, type Decision } from "./policy.js";
const { endpoint, blockedHttp, cleanPath, identify, filterEndpoints } = EndpointPolicy;
import type { ToolArgs } from "./tool.js";

export interface Execution { signal?: AbortSignal; callId?: string; name?: string; agent?: { session: { id: string } } }
export type { Kernel } from "./control-state.js";
import { ControlState, type Kernel, type State, type Activity } from "./control-state.js";
const { DOMAIN_SPEC, revokeBinding, replaceDiscovered, recoverActivity, selectKernel, requireBoundKernel, requireRevision } = ControlState;
export { DOMAIN_SPEC };
interface Table<T> { get(key: string): T | undefined; put(key: string, value: T): Promise<void>; entries(): IterableIterator<[string, T]> }
export interface Domain { table(name: string): Table<any>; close(): Promise<void> }
export interface Credentials {
  resolve(ref: string): Promise<{ value: string } | undefined>;
  describe(ref: string): Promise<{ configured: boolean; writable: boolean }>;
  set(ref: string, value: string): Promise<void>; unset(ref: string): Promise<void>;
}
type Runner = (connection: SiYuanConnection, name: string, args: ToolArgs, exec?: Execution) => Promise<{ summary: string }>;
const refFor = (id: string) => `DSH_SIYUAN_${id.replace(/-/g, "_").toUpperCase()}`;
const ajv = new Ajv({ strict: false });
function resourceIds(value: unknown, result = new Set<string>()): string[] {
  if (typeof value === "string" && /^\d{14}-[0-9a-z]{7}$/.test(value)) result.add(value);
  else if (Array.isArray(value)) value.forEach(item => resourceIds(item, result));
  else if (value && typeof value === "object") Object.values(value).forEach(item => resourceIds(item, result));
  return [...result];
}

export class KernelManager {
  #state!: State;
  #config: Table<State>;
  #activity: Table<Activity>;
  #secrets = new SecretFilter();
  #connections = new Set<SiYuanConnection>();
  #closed = false;
  #validators = new Map<string, (args: unknown) => boolean>();
  defineTool(name: string, validate: (args: unknown) => boolean) { this.#validators.set(name, validate); }
  #writeChain: Promise<unknown> = Promise.resolve();
  readonly contract = loadContract();
  constructor(private domain: Domain, private credentials: Credentials, private run: Runner,
    private approve?: (exec: Execution, reason: string) => Promise<string>) {
    this.#config = domain.table("config"); this.#activity = domain.table("activity");
  }
  async initialize(rawConfig: unknown) {
    const stored = this.#config.get("state");
    if (stored) this.#state = DOMAIN_SPEC.tables.config.valueSchema.parse(stored);
    else {
      const config = normalizeConfig(rawConfig);
      this.#secrets.remember(config.token);
      if (config.token) await this.credentials.set(refFor("local"), config.token);
      const { token: _token, ...publicConfig } = config;
      this.#state = { revision: 1, kernels: [{ id: "local", name: "本机思源", enabled: true, ...publicConfig }],
        defaultKernelId: "local", grants: [], endpoints: [], sessions: {} };
      await this.#config.put("state", this.#state);
    }
    // 所有核心的秘密同时遮罩，避免某个核心回显另一个核心的配置。
    await this.refreshSecrets();
    for (const [, item] of this.#activity.entries()) {
      const recovered = recoverActivity(item);
      if (recovered !== item) await this.#activity.put(item.id, recovered);
    }
  }
  private async refreshSecrets() {
    try {
      for (const kernel of this.#state.kernels) {
        const resolved = await this.credentials.resolve(refFor(kernel.id));
        if (resolved) this.#secrets.remember(resolved.value);
      }
    } catch { throw new Error("思源凭据服务不可用"); }
  }
  private kernel(id: string): Kernel {
    const kernel = this.#state.kernels.find(item => item.id === id);
    if (!kernel) throw new Error("所选思源核心不存在");
    return kernel;
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#writeChain.then(fn); this.#writeChain = next.catch(() => {}); return next;
  }
  private async commit(state: State) {
    state.revision = this.#state.revision + 1;
    await this.#config.put("state", state); this.#state = state;
  }
  private async connect(kernel: Kernel, signal?: AbortSignal): Promise<SiYuanConnection> {
    if (this.#closed) throw new Error("思源管理器已卸载");
    requireBoundKernel(kernel);
    const resolved = await this.credentials.resolve(refFor(kernel.id));
    const token = resolved?.value ?? ""; this.#secrets.remember(token);
    let connection = new SiYuanConnection({ ...kernel, token });
    this.#connections.add(connection);
    try {
      if (kernel.apiUrl === "auto") {
        // 一次操作只发现一次，随后的所有协议请求固定此目标，不跨核心重试。
        const apiUrl = await connection.http.endpoint(signal);
        await connection.dispose(); this.#connections.delete(connection);
        connection = new SiYuanConnection({ ...kernel, token, apiUrl }); this.#connections.add(connection);
      }
      return connection;
    } catch (error) { await this.release(connection); throw this.#secrets.error(error); }
  }
  private async release(connection: SiYuanConnection) {
    try { await connection.dispose(); } finally { this.#connections.delete(connection); }
  }
  private catalog(kernelId?: string): Endpoint[] {
    const staticItems = this.contract.endpoints.map(spec => ({ ...endpoint("http", spec.method, spec.path, "", spec.handler),
      ...(blockedHttp(spec.path) ? { blocked: blockedHttp(spec.path) } : {}) }));
    const common = [endpoint("mcp", "tools/list"), endpoint("mcp", "tools/call"), endpoint("mcp", "resources/list"),
      endpoint("mcp", "resources/read"), endpoint("mcp", "prompts/list"), endpoint("mcp", "prompts/get"),
      endpoint("connection", "status")];
    const extended = this.#state.endpoints.filter(item => !item.discoveredFor || item.discoveredFor === kernelId);
    return [...new Map([...staticItems, ...common, ...extended].map(item => [item.key, item])).values()];
  }
  async publicState() {
    return { revision: this.#state.revision, defaultKernelId: this.#state.defaultKernelId,
      kernels: await Promise.all(this.#state.kernels.map(async kernel => ({ ...kernel,
        credential: await this.credentials.describe(refFor(kernel.id)) }))) };
  }
  endpoints(kernelId: string, filter: Parameters<typeof filterEndpoints>[3]) {
    this.kernel(kernelId); return filterEndpoints(this.catalog(kernelId), this.#state.grants, kernelId, filter);
  }
  activities(sessionId: string, offset = 0, limit = 50) {
    const items = [...this.#activity.entries()].map(([, item]) => item).filter(item => item.sessionId === sessionId)
      .sort((a, b) => b.time.localeCompare(a.time));
    return this.#secrets.value({ total: items.length, items: items.slice(offset, offset + limit),
      sessionId, sessionKernelId: this.#state.sessions[sessionId] ?? null,
      selectedKernelId: this.#state.sessions[sessionId] ?? this.#state.defaultKernelId });
  }
  async saveKernel(input: Record<string, unknown>) {
    return this.serial(async () => {
      const state = structuredClone(this.#state);
      const kernelId = input.id === undefined ? `kernel-${randomUUID()}` : String(input.id);
      if (input.id !== undefined) this.kernel(kernelId);
      if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 100) throw new Error("请输入核心名称");
      const config = normalizeConfig({ apiUrl: input.apiUrl, timeoutMs: input.timeoutMs,
        portFile: input.portFile || undefined, kernelPid: input.kernelPid || undefined });
      const { token: _token, ...publicConfig } = config;
      const kernel: Kernel = { id: kernelId, name: input.name.trim(), enabled: input.enabled !== false, ...publicConfig };
      const previous = state.kernels.find(item => item.id === kernelId);
      if (previous && (previous.apiUrl !== kernel.apiUrl || previous.portFile !== kernel.portFile || previous.kernelPid !== kernel.kernelPid)) {
        // 地址重新绑定需要重新声明端点权限，旧授权不挪给另一个库。
        revokeBinding(state, kernelId);
      }
      state.kernels = [...state.kernels.filter(item => item.id !== kernelId), kernel];
      // token 只作为人工 POST 的写入字段存在，不出现在 State、活动或返回值。
      if (input.token !== undefined && input.token !== "") {
        if (typeof input.token !== "string" || /[\r\n]/.test(input.token) || input.token.length > 8192) throw new Error("token 必须为单行文本");
        this.#secrets.remember(input.token); await this.credentials.set(refFor(kernelId), input.token);
      } else if (input.clearToken === true) await this.credentials.unset(refFor(kernelId));
      await this.commit(state); return { id: kernelId };
    });
  }
  async removeKernel(id: string) {
    return this.serial(async () => {
      this.kernel(id); const state = structuredClone(this.#state);
      state.kernels = state.kernels.filter(item => item.id !== id);
      revokeBinding(state, id);
      if (state.defaultKernelId === id) state.defaultKernelId = null;
      for (const [sessionId, value] of Object.entries(state.sessions)) if (value === id) delete state.sessions[sessionId];
      // 先撤去连接和授权，再清理秘密；清理失败不会让已删除核心继续使用。
      await this.commit(state); await this.credentials.unset(refFor(id));
    });
  }
  async select(kernelId: string | null, sessionId?: string) {
    return this.serial(async () => {
      if (kernelId !== null) this.kernel(kernelId);
      const state = structuredClone(this.#state);
      if (sessionId) {
        if (kernelId === null) delete state.sessions[sessionId]; else state.sessions[sessionId] = kernelId;
      } else state.defaultKernelId = kernelId;
      await this.commit(state);
    });
  }
  async declare(input: Record<string, unknown>) {
    return this.serial(async () => {
      const protocol = input.protocol;
      if (!["http", "mcp", "plugin", "ws"].includes(String(protocol))) throw new Error("未知协议");
      const method = String(input.method ?? "").trim();
      if (!method || method.length > 200) throw new Error("请输入具体方法");
      const path = String(input.path ?? ""); const detail = String(input.detail ?? "");
      if (path.length > 2048 || detail.length > 200) throw new Error("目标名称过长");
      if (protocol === "http" || protocol === "ws") cleanPath(path);
      if (protocol === "http" && /[:*]/.test(path)) throw new Error("扩展 HTTP 声明需要具体路径，不接受通配");
      const item = endpoint(protocol as Endpoint["protocol"], protocol === "http" ? method.toUpperCase() : method,
        path, detail, String(input.description ?? "人工声明的扩展端点").slice(0, 1000));
      if (protocol === "http" && blockedHttp(path)) throw new Error(blockedHttp(path));
      const state = structuredClone(this.#state);
      if (!this.catalog().some(entry => entry.key === item.key)) state.endpoints.push(item);
      await this.commit(state); return item;
    });
  }
  async grant(kernelId: string, endpointKey: string, decision: Decision) {
    return this.serial(async () => {
      this.kernel(kernelId);
      if (!["allow", "ask", "deny"].includes(decision)) throw new Error("未知授权决定");
      const item = this.catalog(kernelId).find(entry => entry.key === endpointKey);
      if (!item || item.blocked) throw new Error(item?.blocked ?? "请先声明此端点");
      const state = structuredClone(this.#state);
      state.grants = [...state.grants.filter(g => !(g.kernelId === kernelId && g.endpointKey === endpointKey)),
        { kernelId, endpointKey, decision }];
      await this.commit(state);
    });
  }
  async inspectConnection(kernelId: string, discoverMcp = false) {
    await this.refreshSecrets();
    let kernel = this.kernel(kernelId);
    let revision = this.#state.revision;
    if (kernel.apiUrl === "auto" && !kernel.kernelPid) {
      const probe = new SiYuanConnection({ ...kernel, token: "" });
      try {
        const instances = await probe.discovery.discover();
        if (instances.length !== 1) throw new Error(instances.length ? "发现多个思源实例，请填写明确的 PID" : "未发现有效的思源实例");
        // 探测期间若人工修改了配置，旧实例结果不能覆盖新地址或权限。
        await this.serial(async () => {
          requireRevision(revision, this.#state.revision, this.#closed, "连接检查期间配置已变化，请重新检查");
          const state = structuredClone(this.#state);
          state.kernels = state.kernels.map(item => item.id === kernelId ? { ...item, kernelPid: instances[0]!.pid } : item);
          revokeBinding(state, kernelId);
          await this.commit(state);
          revision = this.#state.revision;
          kernel = this.kernel(kernelId);
        });
      } finally { await probe.dispose(); }
    }
    const connection = await this.connect(kernel);
    try {
      const response = await connection.http.request("/api/system/version", { method: "POST" });
      if (!response.ok) throw new Error(`连接检查 HTTP ${response.status}`);
      const version = await response.json() as any;
      if (version.code !== 0) throw new Error("内核拒绝连接检查，请检查凭据");
      let count = 0;
      if (discoverMcp) {
        const items: Endpoint[] = [];
        let cursor: string | undefined; const seen = new Set<string>();
        do {
          const list = await connection.mcp.request("tools/list", cursor ? { cursor } : undefined) as any;
          if (!Array.isArray(list.tools)) throw new Error("MCP 工具目录无效");
          for (const tool of list.tools) if (typeof tool.name === "string") {
            // 描述为远端内容，仅展示；不能改变任何权限。
            items.push({ ...endpoint("mcp", "tools/call", "", tool.name, String(tool.description ?? "").slice(0, 1000)), discoveredFor: kernelId });
          }
          cursor = typeof list.nextCursor === "string" ? list.nextCursor : undefined;
          if (cursor) { if (seen.has(cursor) || seen.size >= 100) throw new Error("MCP 分页游标重复或超限"); seen.add(cursor); }
        } while (cursor);
        count = items.length;
        await this.serial(async () => {
          requireRevision(revision, this.#state.revision, this.#closed, "MCP 发现期间配置已变化，请重新发现");
          const state = structuredClone(this.#state);
          replaceDiscovered(state, kernelId, this.#secrets.value(items));
          await this.commit(state);
        });
      }
      return this.#secrets.value({ apiUrl: connection.config.apiUrl, version: version.data, mcpTools: count });
    } catch (error) { throw this.#secrets.error(error); }
    finally { await this.release(connection); }
  }
  /** 宿主工具和公共服务消费者均走这个方法，外部拿不到带 token 的原始连接。 */
  async invoke(name: string, input: ToolArgs, exec?: Execution): Promise<{ summary: string }> {
    await this.#writeChain;
    await this.refreshSecrets();
    const args = { ...input }; const sessionId = exec?.agent?.session?.id;
    const kernelId = ControlState.targetId(this.#state, args.kernelId, sessionId);
    delete args.kernelId;
    const started = Date.now();
    const activity: Activity = { id: randomUUID(), sessionId: sessionId ?? "service", callId: exec?.callId ?? "",
      time: new Date().toISOString(), tool: name, kernelId: String(kernelId ?? ""), kernelName: "", endpoints: [],
      resources: resourceIds(args), status: "checking" };
    let connection: SiYuanConnection | undefined; let sent = false;
    try {
      if (!this.#validators.get(name)?.(input)) throw new Error(`${name} 参数不合法`);
      if (name === "siyuan_rpc" && args.channel === "contract") {
        const offline = new SiYuanConnection({});
        try {
          const output = await this.run(offline, name, args, exec);
          const result = { ...JSON.parse(output.summary), kernels: this.#state.kernels.map(({ id, name, enabled }) => ({ id, name, enabled })) };
          activity.status = "succeeded"; activity.elapsedMs = Date.now() - started;
          await this.#activity.put(activity.id, this.#secrets.value(activity));
          return { summary: JSON.stringify(this.#secrets.value(result)) };
        } finally { await offline.dispose(); }
      }
      const kernel = selectKernel(this.#state, kernelId); activity.kernelName = kernel.name;
      if (this.#closed || !kernel.enabled) throw new Error("思源核心已停用或管理器已卸载");
      // 离线声明与校验不连接内核，拒绝调用不会先发送业务请求。
      const shape = new SiYuanConnection({ ...kernel, token: "" });
      try {
        activity.endpoints = await identify(name, args, (method, path) => shape.http.describe(method, path));
        // 完整参数已由注册模板离线校验，原工具在执行时仍会再次校验。
      } finally { await shape.dispose(); }
      const revision = this.#state.revision;
      await EndpointPolicy.authorize(activity.endpoints, this.#state.grants, kernel.id, async item => {
        activity.status = "awaiting-approval"; await this.#activity.put(activity.id, this.#secrets.value(activity));
        return exec?.agent && this.approve ? this.approve(exec,
          this.#secrets.text(`思源核心「${kernel.name}」：${item.protocol} ${item.method} ${item.path} ${item.detail}`)) : "unavailable";
      });
      exec?.signal?.throwIfAborted();
      requireRevision(revision, this.#state.revision, this.#closed, "批准期间核心或授权配置已变化，请重新调用");
      if (args.channel === "connection") {
        connection = new SiYuanConnection({ ...kernel, token: "" }); this.#connections.add(connection);
      } else connection = await this.connect(kernel, exec?.signal);
      requireRevision(revision, this.#state.revision, this.#closed, "连接期间核心或授权配置已变化，请重新调用");
      activity.target = connection.config.apiUrl;
      activity.status = "running"; await this.#activity.put(activity.id, this.#secrets.value(activity));
      exec?.signal?.throwIfAborted();
      await this.#writeChain;
      requireRevision(revision, this.#state.revision, this.#closed, "执行前授权配置已变化，请重新调用");
      sent = true;
      const output = await this.run(connection, name, args, exec);
      let parsed: unknown;
      try { parsed = JSON.parse(output.summary); } catch { parsed = output.summary; }
      const safe = this.#secrets.value(parsed);
      activity.resources = [...new Set([...activity.resources, ...resourceIds(safe)])];
      const notificationOnly = args.notification || (args.channel === "plugin" && Array.isArray(args.calls)
        && args.calls.length > 0 && args.calls.every(call => call.notification === true));
      activity.status = args.channel === "ws" || notificationOnly ? "sent" : "succeeded";
      if (safe && typeof safe === "object" && ((typeof safe.status === "number" && safe.status >= 400)
        || safe.isError === true || typeof safe.body?.code === "number" && safe.body.code !== 0)) activity.status = "failed";
      if (Array.isArray(safe) && safe.some(item => item?.error)) {
        activity.status = safe.some(item => item && !item.error) ? "partial" : "failed";
      }
      activity.elapsedMs = Date.now() - started;
      try { await this.#activity.put(activity.id, this.#secrets.value(activity)); }
      catch { return { summary: JSON.stringify({ result: safe, operationId: activity.id, recordStatus: "结算记录失败，勿重复写入" }) }; }
      return { summary: typeof safe === "string" ? safe : JSON.stringify(safe, null, 2) };
    } catch (error) {
      activity.status = error instanceof KernelError ? "failed" : sent ? "uncertain" : "denied";
      activity.error = this.#secrets.error(error).message; activity.elapsedMs = Date.now() - started;
      try { await this.#activity.put(activity.id, this.#secrets.value(activity)); } catch { /* 不覆盖原始拒绝结果。 */ }
      throw this.#secrets.error(error);
    } finally {
      if (connection) try { await this.release(connection); } catch { /* 已结算操作不因清理失败变成失败，禁止重放。 */ }
    }
  }
  /** 为管理 HTTP 接口提供安全投影，任何异常都不携带原始请求或凭据。 */
  safe(value: unknown) { return this.#secrets.value(value); }
  error(error: unknown) { return this.#secrets.error(error); }
  async close() {
    this.#closed = true; await this.#writeChain;
    await Promise.allSettled([...this.#connections].map(connection => this.release(connection)));
    await this.domain.close();
  }
}

/** 工具注册时只增加目标选择参数，工具数量仍为五个，配置写入不成为模型工具。 */
export function managedTools(manager: KernelManager, templates: any[]) {
  return templates.map(tool => {
    const parameters = { ...tool.parameters, properties: { ...tool.parameters.properties,
      ...(tool.name === "siyuan_rpc" ? { action: { type: "string", enum: ["status"] } } : {}),
      kernelId: { type: "string", description: "明确指定思源核心 ID；省略时使用会话选择或配置的默认核心" } } };
    const validate = ajv.compile(parameters);
    manager.defineTool(tool.name, validate);
    const description = tool.name === "siyuan_rpc"
      ? "思源受控通用调用：HTTP、离线契约发现、插件 JSON-RPC、MCP、WS 和连接状态。MCP tools/call 与插件批量需逐项授权；WS 发送需 JSON cmd。契约发现返回可选核心 ID。切换实例请使用人工配置页。"
      : tool.description;
    return { ...tool, parameters, description: `${description} 每个实际端点需要在思源界面显式授权；凭据由宿主注入。`,
      async execute(args: ToolArgs, exec?: Execution) {
        if (!validate(args)) throw new Error(`${tool.name} 参数不合法`);
        return manager.invoke(tool.name, args, exec);
      } };
  });
}
