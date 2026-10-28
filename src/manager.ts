/** 宿主共享的核心管理器。公共服务开放受控 invoke，提醒来源使用内部专用读取。 */
import { randomUUID } from "node:crypto";
import Ajv from "ajv";
import type { CredentialProvider, CredentialRef } from "@deepseek-ai/dsh-credentials";
import type { Domain as StorageDomain, KvTable } from "@deepseek-ai/dsh-storage-domain";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { SiYuanConnection } from "./connection.js";
import { ReminderPushHub, type ReminderWatch } from "./push.js";
import { normalizeConfig, KernelError, KernelAccessError, callKernel } from "./api.js";
import { loadContract } from "./contract.js";
import { SecretFilter } from "./secrets.js";
import { EndpointPolicy, type Endpoint, type Decision } from "./policy.js";
const { endpoint, blockedHttp, cleanPath, identify, filterEndpoints } = EndpointPolicy;
import { toolDef, type ToolArgs, type ToolExecution } from "./tool.js";
import { GatewayPublication, type PublicationPort } from "./gateway-publication.js";

export type Execution = ToolExecution;
export type { Kernel } from "./control-state.js";
import { ControlState, type Kernel, type State, type Activity } from "./control-state.js";
const { DOMAIN_SPEC, revokeBinding, replaceDiscovered, recoverActivity, selectKernel, requireBoundKernel, requireRevision } = ControlState;
export { DOMAIN_SPEC };
type Table<T> = Pick<KvTable<string, T>, "get" | "entries"> & Pick<KvTable<string, unknown>, "put">;
// 领域只依赖实际使用的表操作；Host 的完整 Domain 可直接提供这些能力。
export type Domain = Pick<StorageDomain<typeof DOMAIN_SPEC>, "close"> & {
  table(name: keyof typeof DOMAIN_SPEC.tables): Table<unknown>;
};
/** 存储端口接收未知数据，领域 schema 同时约束读取和脱敏后的写入。 */
function checkedTable<T>(table: Table<unknown>, schema: { parse(value: unknown): T }): Table<T> {
  return {
    get(key) { const value = table.get(key); return value === undefined ? undefined : schema.parse(value); },
    async put(key, value) { await table.put(key, schema.parse(value)); },
    *entries() { for (const [key, value] of table.entries()) yield [key, schema.parse(value)]; },
  };
}
export type Credentials = Pick<CredentialProvider, "set" | "unset"> & {
  resolve(...args: Parameters<CredentialProvider["resolve"]>):
    Promise<Pick<NonNullable<Awaited<ReturnType<CredentialProvider["resolve"]>>>, "value"> | undefined>;
  describe(...args: Parameters<CredentialProvider["describe"]>):
    Promise<Pick<Awaited<ReturnType<CredentialProvider["describe"]>>, "configured" | "writable">>;
};
type Runner = (connection: SiYuanConnection, name: string, args: ToolArgs, exec?: Execution) => Promise<{ summary: string }>;
function refFor(id: string): CredentialRef {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("思源核心 ID 无效");
  // 已校验的核心 ID 经此固定转换满足凭据引用的 POSIX 标识符格式。
  return `DSH_SIYUAN_${id.replace(/-/g, "_").toUpperCase()}` as CredentialRef;
}
const ajv = new Ajv({ strict: false });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
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
    pause: error => {
      const pause = KernelAccessError.pauseFor(error) ?? SiYuanConnection.pushPause(error);
      return pause ? { ...pause, message: this.#secrets.text(pause.message) } : undefined;
    },
    open: async (kernelId, signal, receive) => {
      await this.#writeChain;
      signal.throwIfAborted();
      const kernel = await this.bindConnection(kernelId, signal);
      const revision = this.#state.revision;
      const connection = await this.connect(kernel, signal);
      try {
        requireRevision(revision, this.#state.revision, this.#closed, "推送连接期间配置已变化");
        signal.throwIfAborted();
        // 关闭结果先以已兑现的值保存，open 失败时也不会留下无人接管的 rejected Promise。
        let finish!: (error?: Error) => void;
        const closed = new Promise<Error | undefined>(resolve => { finish = resolve; });
        await connection.ws.open(`/ws?app=dsh-reminders-${randomUUID()}&id=${randomUUID()}&type=main`, {
          signal, onClose: finish, onMessage: (data, binary) => {
            if (binary) return;
            let value: unknown;
            try { value = JSON.parse(data.toString("utf8")); } catch { return; }
            receive(value);
          },
        });
        const ended = closed.then(error => { if (error) throw error; });
        // 调用方可能已经取消而不再 await ended；仍保留原 Promise 的拒绝供正常订阅读取。
        void ended.catch(() => {});
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
    this.#config = checkedTable(domain.table("config"), DOMAIN_SPEC.tables.config.valueSchema);
    this.#activity = checkedTable(domain.table("activity"), DOMAIN_SPEC.tables.activity.valueSchema);
  }
  async initialize(rawConfig: unknown) {
    const stored = this.#config.get("state");
    if (stored !== undefined) this.#state = stored;
    else {
      const config = normalizeConfig(rawConfig);
      this.#secrets.remember(config.token);
      if (config.token) await this.credentials.set(refFor("local"), config.token);
      const { token: _token, ...publicConfig } = config;
      this.#state = { revision: 1, kernels: [{ id: "local", name: "本机思源", enabled: true, ...publicConfig }],
        defaultKernelId: "local", grants: [], endpoints: [], sessions: {}, ruleSessions: {} };
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
  private async persist(state: State) {
    state.revision = this.#state.revision + 1;
    await this.#config.put("state", state); this.#state = state;
  }
  private async commit(state: State, resumePushFor: string[] = []) {
    await this.persist(state);
    this.syncGateway();
    this.#push.reset(resumePushFor);
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
    let revision: number | undefined;
    try {
      await this.#writeChain;
      signal.throwIfAborted();
      const paused = this.#push.pausedState(kernelId);
      if (paused) throw new Error(paused.message);
      await this.refreshSecrets();
      const kernel = await this.bindConnection(kernelId, signal);
      const expectedRevision = this.#state.revision;
      revision = expectedRevision;
      const current = async () => {
        await this.#writeChain;
        signal.throwIfAborted();
        requireRevision(expectedRevision, this.#state.revision, this.#closed, "提醒读取期间配置已变化");
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
        stmt: "SELECT id,root_id,type,subtype FROM blocks WHERE type='callout' AND subtype='DSH-REMINDER'" + filter + " ORDER BY id LIMIT -1",
      }, signal);
      await current();
      if (!Array.isArray(blocks)) throw new Error("思源规则查询应返回块数组");
      const result = [];
      for (const block of blocks) {
        if (!isRecord(block) || typeof block.id !== "string") throw new Error("思源提醒块缺少 ID");
        // SQL 只定位块，标准 Markdown 由内核导出；IAL 与代码字面量由原生语法树区分。
        await current();
        const exported = await callKernel(connection, "/api/export/exportMdContent", { id: block.id, addTitle: false, yfm: false }, signal);
        await current();
        if (!isRecord(exported) || typeof exported.content !== "string") throw new Error("思源标准 Markdown 响应缺少正文");
        result.push(this.#secrets.value({ ...block, markdown: exported.content }));
      }
      return result;
    } catch (error) {
      // 旧配置或已取消读取的迟到响应不能暂停新连接。
      if (!signal.aborted && revision === this.#state.revision) this.#push.pause(kernelId, error);
      throw this.#secrets.error(error);
    } finally { if (connection) await this.release(connection); }
  }
  /** 会话从独立选择的规则核心接收内容，规则自身再筛选适用会话。 */
  acceptsReminder(kernelId: string, sessionId: string) {
    return !this.#closed && this.#state.kernels.some(kernel => kernel.id === kernelId && kernel.enabled)
      && ControlState.ruleTargetId(this.#state, sessionId) === kernelId;
  }
  async publicState() {
    return { revision: this.#state.revision, defaultKernelId: this.#state.defaultKernelId, gateway: this.gatewayState(),
      kernels: await Promise.all(this.#state.kernels.map(async kernel => ({ ...kernel,
        credential: await this.credentials.describe(refFor(kernel.id)), reminderPause: this.#push.pausedState(kernel.id) }))) };
  }
  endpoints(kernelId: string, filter: Parameters<typeof filterEndpoints>[3]) {
    this.kernel(kernelId); return filterEndpoints(this.catalog(kernelId), this.#state.grants, kernelId, filter);
  }
  activities(sessionId: string, offset = 0, limit = 50) {
    const items = [...this.#activity.entries()].map(([, item]) => item).filter(item => item.sessionId === sessionId)
      .sort((a, b) => b.time.localeCompare(a.time));
    return this.#secrets.value({ total: items.length, items: items.slice(offset, offset + limit),
      sessionId, ...ControlState.sessionSelection(this.#state, sessionId) });
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
      let connectionChanged = !previous || previous.apiUrl !== kernel.apiUrl
        || previous.portFile !== kernel.portFile || previous.kernelPid !== kernel.kernelPid;
      if (previous && (previous.apiUrl !== kernel.apiUrl || previous.portFile !== kernel.portFile || previous.kernelPid !== kernel.kernelPid)) {
        // 地址重新绑定需要重新声明端点权限，旧授权不挪给另一个库。
        revokeBinding(state, kernelId);
      }
      state.kernels = [...state.kernels.filter(item => item.id !== kernelId), kernel];
      // 凭据服务和配置存储是两个端口；配置提交失败时恢复凭据，让相同更新可以重试。
      const ref = refFor(kernelId);
      let previousCredential: string | undefined;
      let credentialChanged = false, credentialWritten = false;
      if (input.token !== undefined && input.token !== "") {
        if (typeof input.token !== "string" || /[\r\n]/.test(input.token) || input.token.length > 8192) throw new Error("token 必须为单行文本");
        const token = input.token.trim();
        previousCredential = (await this.credentials.resolve(ref))?.value;
        credentialChanged = token !== (previousCredential?.trim() ?? "");
        if (credentialChanged) {
          this.#secrets.remember(token); await this.credentials.set(ref, token); credentialWritten = true;
        }
      } else if (input.clearToken === true) {
        previousCredential = (await this.credentials.resolve(ref))?.value;
        credentialChanged = !!previousCredential?.trim();
        if (previousCredential !== undefined) { await this.credentials.unset(ref); credentialWritten = true; }
      }
      connectionChanged ||= credentialChanged;
      // 仅补偿持久写入失败；提交后的订阅通知失败不能把凭据撤回旧版本。
      try { await this.persist(state); }
      catch (error) {
        if (credentialWritten) {
          try {
            if (previousCredential === undefined) await this.credentials.unset(ref);
            else await this.credentials.set(ref, previousCredential);
          } catch { throw new Error("核心配置保存失败，且凭据未能恢复；请在编辑页重新核对并保存凭据"); }
        }
        throw this.#secrets.error(error);
      }
      this.syncGateway();
      this.#push.reset(kernel.enabled && connectionChanged ? [kernelId] : []);
      return { id: kernelId };
    });
  }
  async removeKernel(id: string) {
    return this.serial(async () => {
      this.kernel(id); const state = structuredClone(this.#state);
      state.kernels = state.kernels.filter(item => item.id !== id);
      revokeBinding(state, id);
      if (state.defaultKernelId === id) state.defaultKernelId = null;
      for (const selections of [state.sessions, state.ruleSessions]) {
        for (const [sessionId, value] of Object.entries(selections)) if (value === id) delete selections[sessionId];
      }
      // 先撤去连接和授权，再清理秘密；清理失败不会让已删除核心继续使用。
      await this.commit(state); await this.credentials.unset(refFor(id));
    });
  }
  async select(kernelId: string | null, sessionId?: string) {
    return this.serial(async () => {
      if (kernelId !== null) this.kernel(kernelId);
      const state = structuredClone(this.#state);
      if (sessionId) ControlState.setSessionKernel(state, sessionId, kernelId, 'operation');
      else state.defaultKernelId = kernelId;
      await this.commit(state);
    });
  }
  async selectRuleSource(kernelId: string | null, sessionId: string) {
    return this.serial(async () => {
      const state = structuredClone(this.#state);
      ControlState.setSessionKernel(state, sessionId, kernelId, 'rules');
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
  /** 候选探针不携带凭据，也不依赖旧 PID 是否仍可连接。 */
  async connectionInstances(kernelId: string) {
    await this.#writeChain;
    const probe = new SiYuanConnection({ ...this.kernel(kernelId), token: "" });
    try { return await probe.discovery.status(); }
    finally { await probe.dispose(); }
  }
  async selectInstance(kernelId: string, pid: unknown) {
    if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) throw new Error("pid 必须为正整数");
    const kernel = await this.bindConnection(kernelId, undefined, pid);
    return { kernelId, selectedPid: kernel.kernelPid };
  }
  /** 每次派发前重新发现，串行保存恢复结果；进行中的业务请求固定原目标。 */
  private async bindConnection(kernelId: string, signal?: AbortSignal, selectedPid?: number) {
    return this.serial(async () => {
      signal?.throwIfAborted();
      const kernel = this.kernel(kernelId);
      if (this.#closed || !kernel.enabled) throw new Error("思源核心已停用或管理器已卸载");
      if (kernel.apiUrl !== "auto") {
        if (selectedPid !== undefined) throw new Error("显式地址无需选择本机实例");
        return kernel;
      }
      const probe = new SiYuanConnection({ ...kernel, token: "" });
      try {
        const instances = await probe.discovery.discover(signal);
        const state = structuredClone(this.#state);
        if (!ControlState.reconcileBinding(state, kernelId, instances, selectedPid)) return kernel;
        signal?.throwIfAborted();
        if (this.#closed) throw new Error("思源管理器已卸载");
        await this.commit(state, [kernelId]);
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
      const version = await callKernel(connection, "/api/system/version");
      if (typeof version !== "string") throw new Error("内核版本响应无效");
      // version 是公开端点；受保护的只读接口确认访问能力，不能单凭成功响应证明代理透传了 token。
      const auth = await connection.json("/api/notebook/lsNotebooks", {});
      if (revision === this.#state.revision && (auth.status === 401 || auth.status === 403 || auth.status === 429)) {
        this.#push.pause(kernelId, new KernelAccessError(auth.status, auth.headers.get("retry-after")));
      }
      if (auth.status === 401) {
        const failure: unknown = await auth.json().catch(() => undefined);
        if (connection.config.token && failure && typeof failure === "object" && "msg" in failure
          && failure.msg === "Auth failed [header: Authorization]") {
          throw new Error("思源服务可达，但 API token 可能不匹配（HTTP 401）；请检查核心 token、代理请求头及访问策略，更新配置后再检查");
        }
        throw new Error("思源服务可达，但只读接口拒绝访问（HTTP 401）；请检查登录认证、代理及核心访问策略");
      }
      if (auth.status === 403) {
        await auth.body?.cancel();
        throw new Error("思源服务可达，但当前身份没有访问权限（HTTP 403）；请检查角色权限和核心访问策略");
      }
      if (auth.status === 429) {
        const header = auth.headers.get("retry-after");
        const wait = header && /^\d{1,6}$/.test(header) ? `Retry-After ${Number(header)} 秒` : header ? "请按 Retry-After 等待" : "请稍后再检查";
        await auth.body?.cancel();
        throw new Error(`思源服务可达，但访问受到限流（HTTP 429，${wait}）；本次检查未自动重试`);
      }
      if (!auth.ok) { await auth.body?.cancel(); throw new Error(`访问检查 HTTP ${auth.status}`); }
      const checked: unknown = await auth.json();
      if (!checked || typeof checked !== "object" || !("code" in checked) || checked.code !== 0) {
        throw new Error("思源服务可达，但只读接口拒绝访问，请检查认证和核心状态");
      }
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
      return { apiUrl: this.#secrets.text(connection.config.apiUrl), version: this.#secrets.text(version), accessAvailable: true,
        credentialSent: !!connection.config.token, mcpTools: count };
    } catch (error) {
      if (revision === this.#state.revision) this.#push.pause(kernelId, error);
      throw this.#secrets.error(error);
    } finally { await this.release(connection); }
  }
  /** 宿主工具和公共服务消费者均走这个方法，外部拿不到带 token 的原始连接。 */
  async invoke(name: string, input: ToolArgs, exec?: Execution): Promise<{ summary: string }> {
    await this.#writeChain;
    // 目录只读本地配置：无默认核心、核心停用或断线时仍可供调用方选择。
    if (name === "siyuan_kernels") {
      if (!this.#validators.get(name)?.(input)) throw new Error(`${name} 参数不合法`);
      exec?.signal?.throwIfAborted();
      if (this.#closed) throw new Error("思源管理器已卸载");
      const directory = ControlState.kernelDirectory(this.#state, exec?.agent?.session.id ?? exec?.sessionId);
      return { summary: JSON.stringify(this.#secrets.value(directory), null, 2) };
    }
    await this.refreshSecrets();
    const args = { ...input }; const sessionId = exec?.agent?.session.id ?? exec?.sessionId;
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
      if (isRecord(safe) && ((typeof safe.status === "number" && safe.status >= 400)
        || safe.isError === true || isRecord(safe.body) && typeof safe.body.code === "number" && safe.body.code !== 0)) activity.status = "failed";
      if (Array.isArray(safe) && safe.some((item: unknown) => isRecord(item) && item.error)) {
        activity.status = safe.some((item: unknown) => isRecord(item) && !item.error) ? "partial" : "failed";
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

/** 五个业务工具增加目标选择参数，核心目录独立注册并沿用同一个管理器入口。 */
export function managedTools(manager: KernelManager, templates: ReturnType<typeof toolDef>[]) {
  const tools = templates.map(tool => {
    const properties = tool.parameters.properties;
    if (!isRecord(properties)) throw new Error(`${tool.name} 参数 schema 缺少 properties 对象`);
    const parameters = { ...tool.parameters, properties: { ...properties,
      ...(tool.name === "siyuan_rpc" ? { action: { type: "string", enum: ["status"] } } : {}),
      kernelId: { type: "string", description: "本次操作的思源核心 ID；省略时使用会话默认操作核心，再回退全局默认核心" } } };
    const validate = ajv.compile<ToolArgs>(parameters);
    manager.defineTool(tool.name, validate);
    const description = tool.name === "siyuan_rpc"
      ? "思源受控通用调用：HTTP、离线契约发现、插件 JSON-RPC、MCP、WS 和连接状态。MCP tools/call 与插件批量需逐项授权；WS 发送需 JSON cmd。契约发现返回可选核心 ID。切换实例请使用思源连接管理界面。"
      : tool.description;
    return { ...tool, parameters, description: `${description} 端点默认每次询问、完全权限下允许；可在思源连接管理界面逐项设置；凭据由宿主注入。`,
      async execute(args: unknown, exec?: Execution) {
        if (!validate(args)) throw new Error(`${tool.name} 参数不合法`);
        return manager.invoke(tool.name, args, exec);
      } };
  });
  const directory = toolDef("siyuan_kernels",
    "列出所有已配置的思源核心：ID、名称、启用状态、API 地址、绑定 PID、全局默认核心、会话默认操作核心及会话规则来源核心。sessionKernelId/selectedKernelId 是操作选择，sessionRuleKernelId/selectedRuleKernelId 是规则来源选择；两者未设置均使用全局默认核心。enabled 表示配置启用状态；此工具不探测在线状态。无需参数，返回的 ID 可用于业务工具的 kernelId。",
    { type: "object", properties: {}, additionalProperties: false },
    async (args, _signal, exec) => (await manager.invoke("siyuan_kernels", args, exec)).summary);
  manager.defineTool(directory.name, ajv.compile(directory.parameters));
  return [...tools, directory];
}
