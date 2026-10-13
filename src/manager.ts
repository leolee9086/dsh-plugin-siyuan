/** 宿主共享的核心管理器。公共服务开放受控 invoke，提醒来源使用内部专用读取。 */
import { randomUUID } from "node:crypto";
import Ajv from "ajv";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { SiYuanConnection } from "./connection.js";
import { ReminderPushHub, type ReminderWatch } from "./push.js";
import { normalizeConfig, KernelError, callKernel } from "./api.js";
import { loadContract } from "./contract.js";
import { SecretFilter } from "./secrets.js";
import { EndpointPolicy, type Endpoint, type Decision } from "./policy.js";
const { endpoint, blockedHttp, cleanPath, identify, filterEndpoints } = EndpointPolicy;
import type { ToolArgs } from "./tool.js";
import { GatewayPublication, type PublicationPort } from "./gateway-publication.js";
export type { GatewayHost } from "./gateway-publication.js";

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
  #push = new ReminderPushHub({
    kernels: () => this.reminderKernels(),
    error: error => this.#secrets.error(error).message,
    open: async (kernelId, signal, receive) => {
      await this.#writeChain;
      signal.throwIfAborted();
      const kernel = await this.bindConnection(kernelId, signal);
      const revision = this.#state.revision;
      const connection = await this.connect(kernel, signal);
      try {
        requireRevision(revision, this.#state.revision, this.#closed, "推送连接期间配置已变化");
        signal.throwIfAborted();
        const socket = await connection.ws.open(`/ws?app=dsh-reminders-${randomUUID()}&id=${randomUUID()}&type=main`, {
          signal, onMessage: (data, binary) => {
            if (binary) return;
            let value: unknown;
            try { value = JSON.parse(data.toString("utf8")); } catch { return; }
            receive(value);
          },
        });
        // close 可能在 await open 恢复前发生，先监听再检查状态。
        const ended = new Promise<void>(resolve => {
          socket.once("close", () => resolve());
          if (socket.readyState !== socket.OPEN) resolve();
        });
        return { ended, dispose: () => this.release(connection) };
      } catch (error) { await this.release(connection); throw error; }
    },
  });
  watchReminders: ReminderWatch = listener => this.#push.watch(listener);
  #publication?: GatewayPublication;
  #publicationError = "";
  /** 可选网关出现/消失时仅挂载/释放扩展工具，五个基础工具始终独立可用。 */
  attachGateway(port: PublicationPort) {
    if (this.#publication) throw new Error("思源工具箱已连接");
    const publication = new GatewayPublication(this.contract, this.invoke.bind(this), port);
    this.#publication = publication;
    this.syncGateway();
    return () => {
      publication.dispose();
      if (this.#publication === publication) { this.#publication = undefined; this.#publicationError = ""; }
    };
  }
  private syncGateway() {
    try { this.#publication?.sync(this.#state); this.#publicationError = ""; }
    catch (error) { this.#publicationError = this.#secrets.error(error).message; }
  }
  gatewayState() {
    return { available: !!this.#publication, requested: this.#state.gatewayTools === true,
      registered: this.#publication?.count ?? 0, error: this.#publicationError,
      ...GatewayPublication.inventory(this.contract, this.#state) };
  }
  async registerGateway(enabled: boolean) {
    return this.serial(async () => {
      if (enabled && !this.#publication) throw new Error("请先安装并启用工具箱插件 dsh-tool-gateway");
      await this.commit({ ...this.#state, gatewayTools: enabled });
      if (this.#publicationError) throw new Error(this.#publicationError);
      return this.gatewayState();
    });
  }
  #validators = new Map<string, (args: unknown) => boolean>();
  defineTool(name: string, validate: (args: unknown) => boolean) { this.#validators.set(name, validate); }
  #writeChain: Promise<unknown> = Promise.resolve();
  readonly contract = loadContract();
  constructor(private domain: Domain, private credentials: Credentials, private run: Runner,
    private approve?: (exec: Execution, reason: string, decision: Decision) => Promise<string>) {
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
    this.syncGateway();
    this.#push.reset();
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
      endpoint("connection", "status"), endpoint("ws", "connect", "/ws", "", "连接内核推送通道"),
      endpoint("http", "POST", "/api/sqlite/flushTransaction", "", "等待事务和索引队列完成")];
    const extended = this.#state.endpoints.filter(item => !item.discoveredFor || item.discoveredFor === kernelId);
    return [...new Map([...staticItems, ...common, ...extended].map(item => [item.key, item])).values()];
  }
  /** Discover rules from existing enabled connections; no separate rule-root configuration. */
  reminderKernels() {
    return this.#closed ? [] : this.#state.kernels.filter(kernel => kernel.enabled).map(kernel => kernel.id);
  }
  /** 插件内部固定读取提醒块；与模型工具的端点审批分开，也不发布到公共服务。 */
  async readReminderBlocks(kernelId: string, roots: string[] | undefined, signal: AbortSignal) {
    let connection: SiYuanConnection | undefined;
    try {
      await this.#writeChain;
      signal.throwIfAborted();
      await this.refreshSecrets();
      const kernel = await this.bindConnection(kernelId, signal);
      const revision = this.#state.revision;
      const current = async () => {
        await this.#writeChain;
        signal.throwIfAborted();
        requireRevision(revision, this.#state.revision, this.#closed, "提醒读取期间配置已变化");
      };
      // 这里只接受文档 ID，SQL 和端点由插件固定，调用方不能提交任意查询。
      if (roots?.some(id => !/^\d{14}-[a-z0-9]{7}$/.test(id))) throw new Error("提醒文档 ID 无效");
      const filter = roots === undefined ? "" : " AND root_id IN (" + roots.map(id => "'" + id + "'").join(",") + ")";
      connection = await this.connect(kernel, signal);
      await current();
      await callKernel(connection, "/api/sqlite/flushTransaction", {}, signal);
      await current();
      // LIMIT -1 避开思源 SQL 的隐式行数上限，每批先等事务和索引队列完成。
      const blocks = await callKernel(connection, "/api/query/sql", {
        stmt: "SELECT id,root_id,type,subtype,markdown FROM blocks WHERE type='callout' AND subtype='DSH-REMINDER'" + filter + " ORDER BY id LIMIT -1",
      }, signal);
      await current();
      if (!Array.isArray(blocks)) throw new Error("思源规则查询应返回块数组");
      return this.#secrets.value(blocks);
    } catch (error) { throw this.#secrets.error(error); }
    finally { if (connection) await this.release(connection); }
  }
  /** Rule sources follow the same session/core selection as ordinary tools. */
  acceptsReminder(kernelId: string, sessionId: string) {
    return !this.#closed && this.#state.kernels.some(kernel => kernel.id === kernelId && kernel.enabled)
      && ControlState.targetId(this.#state, undefined, sessionId) === kernelId;
  }
  async publicState() {
    return { revision: this.#state.revision, defaultKernelId: this.#state.defaultKernelId, gateway: this.gatewayState(),
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
    // 授权归属具体实例，首次绑定在写入端点决定前完成。
    const bound = decision !== "deny" ? await this.bindConnection(kernelId) : undefined;
    return this.serial(async () => {
      const kernel = this.kernel(kernelId);
      if (bound && bound !== kernel) throw new Error("授权前核心配置已变化，请重新选择端点权限");
      if (!EndpointPolicy.decisions.includes(decision)) throw new Error("未知授权决定");
      const item = this.catalog(kernelId).find(entry => entry.key === endpointKey);
      if (!item || item.blocked) throw new Error(item?.blocked ?? "请先声明此端点");
      const state = structuredClone(this.#state);
      state.grants = [...state.grants.filter(g => !(g.kernelId === kernelId && g.endpointKey === endpointKey)),
        { kernelId, endpointKey, decision }];
      await this.commit(state);
    });
  }
  /** 首次使用串行绑定唯一实例；并发检查共用落盘后的 PID，后续不会换到另一实例。 */
  private async bindConnection(kernelId: string, signal?: AbortSignal) {
    return this.serial(async () => {
      signal?.throwIfAborted();
      const kernel = this.kernel(kernelId);
      if (this.#closed || !kernel.enabled) throw new Error("思源核心已停用或管理器已卸载");
      if (kernel.apiUrl !== "auto" || kernel.kernelPid) return kernel;
      const probe = new SiYuanConnection({ ...kernel, token: "" });
      try {
        const instances = await probe.discovery.discover(signal);
        const state = structuredClone(this.#state);
        ControlState.bindDiscovered(state, kernelId, instances);
        signal?.throwIfAborted();
        if (this.#closed) throw new Error("思源管理器已卸载");
        await this.commit(state);
        return this.kernel(kernelId);
      } finally { await probe.dispose(); }
    });
  }
  async inspectConnection(kernelId: string, discoverMcp = false) {
    await this.refreshSecrets();
    const kernel = await this.bindConnection(kernelId);
    const revision = this.#state.revision;
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
          const list = ListToolsResultSchema.parse(await connection.mcp.request("tools/list", cursor ? { cursor } : undefined));
          for (const tool of list.tools) {
            // 保存协议提供的完整参数 schema，名称与 schema 都属于这一个核心。
            items.push({ ...endpoint("mcp", "tools/call", "", tool.name, String(tool.description ?? "").slice(0, 1000)),
              discoveredFor: kernelId, inputSchema: structuredClone(tool.inputSchema) });
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
      time: new Date().toISOString(), tool: exec?.name?.startsWith("siyuan_") ? exec.name : name, kernelId: String(kernelId ?? ""), kernelName: "", endpoints: [],
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
      const selected = selectKernel(this.#state, kernelId);
      // 在授权前完成首次绑定，授权快照对应已确定的实例。
      const kernel = args.channel === "connection" ? selected : await this.bindConnection(selected.id, exec?.signal);
      activity.kernelName = kernel.name;
      const revision = this.#state.revision;
      if (kernel !== this.kernel(kernel.id)) throw new Error("连接绑定期间核心配置已变化，请重新调用");
      if (this.#closed || !kernel.enabled) throw new Error("思源核心已停用或管理器已卸载");
      // 离线声明与校验不连接内核，拒绝调用不会先发送业务请求。
      const shape = new SiYuanConnection({ ...kernel, token: "" });
      try {
        activity.endpoints = await identify(name, args, (method, path) => shape.http.describe(method, path));
        // 完整参数已由注册模板离线校验，原工具在执行时仍会再次校验。
      } finally { await shape.dispose(); }
      requireRevision(revision, this.#state.revision, this.#closed, "端点识别期间配置已变化，请重新调用");
      activity.authorization = activity.endpoints.map(item => {
        const decision = EndpointPolicy.decisionFor(this.#state.grants, kernel.id, item.key);
        return { endpointKey: item.key, decision, outcome: decision === "allow" ? "endpoint-allowed" : decision === "deny" ? "endpoint-denied" : "pending" };
      });
      await EndpointPolicy.authorize(activity.endpoints, this.#state.grants, kernel.id, async (item, decision) => {
        activity.status = "awaiting-approval"; await this.#activity.put(activity.id, this.#secrets.value(activity));
        const outcome = exec?.agent && this.approve ? await this.approve(exec,
          this.#secrets.text(`思源核心「${kernel.name}」：${item.protocol} ${item.method} ${item.path} ${item.detail}`), decision) : "unavailable";
        const record = activity.authorization?.find(entry => entry.endpointKey === item.key);
        if (record) record.outcome = outcome;
        return outcome;
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
      const projected = name === "siyuan_rpc" && args.channel === "mcp"
        ? this.#secrets.mcp(parsed, String(args.method)) : parsed;
      const safe = this.#secrets.value(projected);
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
    this.#closed = true; this.#publication?.dispose(); this.#publication = undefined;
    await this.#writeChain;
    await this.#push.close();
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
      ? "思源受控通用调用：HTTP、离线契约发现、插件 JSON-RPC、MCP、WS 和连接状态。MCP tools/call 与插件批量需逐项授权；WS 发送需 JSON cmd。契约发现返回可选核心 ID。切换实例请使用思源连接管理界面。"
      : tool.description;
    return { ...tool, parameters, description: `${description} 端点默认每次询问、完全权限下拒绝；可在思源连接管理界面逐项设置；凭据由宿主注入。`,
      async execute(args: ToolArgs, exec?: Execution) {
        if (!validate(args)) throw new Error(`${tool.name} 参数不合法`);
        return manager.invoke(tool.name, args, exec);
      } };
  });
}
