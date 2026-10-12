/** 思源工具发布领域：契约生成、稳定身份和注册生命周期；宿主设施由端口注入。 */
import { createHash } from "node:crypto";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import type { Contract, EndpointSpec } from "./contract.js";
import type { State } from "./control-state.js";
import type { Execution } from "./manager.js";
import type { ToolArgs } from "./tool.js";
import { EndpointPolicy } from "./policy.js";

const string = { type: "string" };
const scalar = { type: ["string", "number", "boolean"] };
const fileSchema = { type: "object", additionalProperties: false, required: ["field", "name", "base64"],
  properties: { field: string, name: string, base64: string, mimeType: string } };
type Invoke = (name: string, args: ToolArgs, exec?: Execution) => Promise<{ summary: string }>;
interface GroupSpec { id: string; title: string; origin: string; defaultEnabled: boolean }
export interface GatewayPort {
  registerGroup(spec: GroupSpec): { add(name: string): void; remove(name: string): void; dispose(): void };
}
export interface PublicationPort extends GatewayPort { registerTool(tool: PublishedTool): () => void }
export interface GatewayHost {
  get(name: "toolGateway"): GatewayPort;
  get(name: "tools"): { register(tool: PublishedTool): () => void };
  effect(effect: () => () => void, label: string): unknown;
}
interface Definition { name: string; description: string; parameters: Record<string, unknown>; group: GroupSpec;
  translate(args: ToolArgs): ToolArgs }
export interface PublishedTool {
  name: string; description: string; parameters: Record<string, unknown>;
  output: { schema: object; render(args: unknown, result: { summary: string }): { type: string; text: string }[] };
  execute(args: ToolArgs, exec?: Execution): Promise<{ summary: string }>;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工具 schema 或参数必须为对象");
  return value as Record<string, unknown>;
}
function toolName(protocol: string, label: string, identity: string) {
  // 截断可读部分后用身份摘要区分同名 handler、不同方法和不同核心，名称保持在64字符内。
  const suffix = createHash("sha256").update(identity).digest("hex").slice(0, 12);
  return `siyuan_${protocol}_${label.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 35)}_${suffix}`;
}
function group(id: string, title: string): GroupSpec {
  return { id, title, origin: "dsh-plugin-siyuan", defaultEnabled: false };
}
function httpDefinition(contract: Contract, spec: EndpointSpec): Definition {
  const name = toolName("http", `${spec.method}_${spec.handler}`, `${spec.method} ${spec.path}`);
  const request = record(contract.requestSchema(spec));
  // HTTP契约的引用统一指向根 $defs；把定义放在工具参数根，原指针保持有效。
  const { $defs, ...bodySchema } = request;
  const pathKeys = [...spec.path.matchAll(/([:*])([A-Za-z0-9_]+)/g)];
  const properties: Record<string, unknown> = {
    kernelId: { ...string, description: "思源核心ID；省略时使用会话选择或默认核心" },
    query: { type: "object", additionalProperties: { anyOf: [scalar, { type: "array", items: scalar }] } },
    headers: { type: "object", additionalProperties: string, description: "业务请求头；认证由已配置核心注入" },
    responseEncoding: { type: "string", enum: ["auto", "json", "text", "base64"] },
    maxBytes: { type: "integer", minimum: 1 }, timeoutMs: { type: "integer", minimum: 1 },
  };
  const required: string[] = [];
  if (spec.body !== "none") {
    properties.body = { ...bodySchema, description: spec.body === "raw" ? "原始请求字节的 base64 文本" : "按端点契约填写；表单文件字段填写文件名，文件内容放 files" };
    if (!["raw", "legacyOptional"].includes(spec.body)) required.push("body");
  }
  if (["form", "multipart"].includes(spec.body)) properties.files = { type: "array", items: fileSchema };
  if (pathKeys.length) {
    properties.pathParams = { type: "object", additionalProperties: false,
      properties: Object.fromEntries(pathKeys.map(([, kind, key]) => [key, { type: "string", minLength: 1,
        pattern: kind === ":" ? "^[^/?#%\\\\]+$" : "^[^?#%\\\\]+$" }])), required: pathKeys.map(match => match[2]) };
    required.push("pathParams");
  }
  const blocked = EndpointPolicy.blockedHttp(spec.path);
  return { name, group: group("siyuan-http", "思源 HTTP 端点"),
    description: `思源 HTTP ${spec.method} ${spec.path}；${spec.handler}。${blocked ? `${blocked}。` : ""}执行遵循所选核心的端点授权。`,
    parameters: { type: "object", properties, required, additionalProperties: false, $defs },
    translate(args) {
      const pathParams = args.pathParams === undefined ? {} : record(args.pathParams);
      let path = spec.path.replace(/[:*]([A-Za-z0-9_]+)/g, (_, key: string) => String(pathParams[key]));
      EndpointPolicy.cleanPath(path);
      if (args.query) {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(record(args.query))) {
          for (const item of Array.isArray(value) ? value : [value]) query.append(key, String(item));
        }
        if (query.size) path += `?${query}`;
      }
      const output: ToolArgs = { channel: "http", method: spec.method, path, validate: true };
      for (const key of ["kernelId", "headers", "responseEncoding", "maxBytes", "timeoutMs"]) if (args[key] !== undefined) output[key] = args[key];
      if (args.body !== undefined) {
        output.body = args.body;
        output.bodyType = spec.body === "raw" ? "base64" : ["form", "multipart"].includes(spec.body) ? spec.body : "json";
      }
      if (args.files !== undefined) {
        output.files = args.files; output.bodyType = "multipart";
        const fields = { ...record(args.body ?? {}) };
        // 文件名仍在原契约中校验，线上只发送文件本身，避免同一字段既传文本又传文件。
        for (const file of args.files as { field: string; name: string }[]) {
          const expected = fields[file.field];
          if (expected !== undefined && !(Array.isArray(expected) ? expected.includes(file.name) : expected === file.name)) {
            throw new Error(`文件 ${file.field} 的 name 与 body 文件名不一致`);
          }
        }
        for (const file of args.files as { field: string }[]) delete fields[file.field];
        output.body = fields;
      }
      return output;
    } };
}

export class GatewayPublication {
  #tools = new Map<string, { signature: string; tool: PublishedTool; stop: () => void; groupId: string }>();
  #groups = new Map<string, { title: string; handle: ReturnType<GatewayPort["registerGroup"]> }>();
  #http: Definition[];
  #closed = false;
  constructor(contract: Contract, private invoke: Invoke, private port: PublicationPort) {
    this.#http = contract.endpoints.map(spec => httpDefinition(contract, spec));
  }
  static inventory(contract: Contract, state: State) {
    const mcp = state.endpoints.filter(item => item.protocol === "mcp" && item.method === "tools/call" && item.discoveredFor);
    return { http: contract.endpoints.length, mcp: mcp.filter(item => item.inputSchema).length,
      missingSchemas: mcp.filter(item => !item.inputSchema).length };
  }
  private definitions(state: State) {
    const definitions = [...this.#http];
    for (const item of state.endpoints) {
      if (item.protocol !== "mcp" || item.method !== "tools/call" || !item.discoveredFor || !item.inputSchema) continue;
      const kernelId = item.discoveredFor;
      const kernel = state.kernels.find(kernel => kernel.id === kernelId);
      if (!kernel) throw new Error("MCP 工具的核心已不存在");
      definitions.push({ name: toolName("mcp", item.detail, JSON.stringify([kernelId, item.detail])),
        group: group(`siyuan-mcp:${kernelId}`, `思源 MCP · ${kernel.name}`),
        description: `思源 MCP ${item.detail}（核心：${kernel.name}）。${item.description}`,
        parameters: item.inputSchema,
        translate: args => ({ kernelId, channel: "mcp", method: "tools/call", params: { name: item.detail, arguments: args } }) });
    }
    return definitions;
  }
  /** 先校验全部新定义，再按稳定名字更新；普通授权变化不重建工具，不覆盖网关会话开关。 */
  sync(state: State) {
    if (this.#closed) throw new Error("工具发布已卸载");
    try {
      const wanted = state.gatewayTools ? this.definitions(state) : [];
      const names = new Set<string>();
      const httpValidator = new Ajv2020({ strict: false, validateFormats: false });
      const prepared = wanted.map(definition => {
        if (names.has(definition.name)) throw new Error(`思源工具名冲突：${definition.name}`);
        names.add(definition.name);
        const signature = JSON.stringify([definition.description, definition.parameters, definition.group]);
        if (this.#tools.get(definition.name)?.signature === signature) return { definition, signature };
        const dialect = definition.parameters.$schema;
        const Validator = typeof dialect === "string" && dialect.includes("draft-07") ? Ajv : Ajv2020;
        const validator = definition.group.id === "siyuan-http" ? httpValidator : new Validator({ strict: false, validateFormats: false });
        const validate = validator.compile(definition.parameters);
        const tool: PublishedTool = { name: definition.name, description: definition.description, parameters: definition.parameters,
          output: { schema: { type: "object", required: ["summary"], properties: { summary: string }, additionalProperties: false },
            render: (_args, result) => [{ type: "text", text: result.summary }] },
          execute: async (args, exec) => {
            if (this.#closed || this.#tools.get(tool.name)?.tool !== tool) throw new Error("此思源工具已撤回，请重新查询工具目录");
            if (!validate(args)) throw new Error(`${tool.name} 参数不符合端点 schema`);
            exec?.signal?.throwIfAborted();
            return this.invoke("siyuan_rpc", definition.translate(args), { ...exec, name: tool.name });
          } };
        return { definition, signature, tool };
      });
      // 核心改名时更新组标题；组ID保持不变，网关保存的会话选择仍对应同一组。
      for (const definition of wanted) {
        const registered = this.#groups.get(definition.group.id);
        if (!registered || registered.title === definition.group.title) continue;
        for (const [name, entry] of this.#tools) if (entry.groupId === definition.group.id) {
          entry.stop(); this.#tools.delete(name);
        }
        registered.handle.dispose(); this.#groups.delete(definition.group.id);
      }
      for (const { definition, signature, tool } of prepared) {
        if (!tool) continue;
        let ownedGroup = this.#groups.get(definition.group.id);
        if (!ownedGroup) {
          ownedGroup = { title: definition.group.title, handle: this.port.registerGroup(definition.group) };
          this.#groups.set(definition.group.id, ownedGroup);
        }
        this.#tools.get(tool.name)?.stop();
        this.#tools.delete(tool.name);
        // 先加入默认关闭的组再注册工具，注册通知发出时目录即可得到正确的开关状态。
        ownedGroup.handle.add(tool.name);
        const stop = this.port.registerTool(tool);
        this.#tools.set(tool.name, { tool, signature, stop, groupId: definition.group.id });
      }
      for (const [name, registered] of this.#tools) if (!names.has(name)) {
        registered.stop(); this.#tools.delete(name); this.#groups.get(registered.groupId)?.handle.remove(name);
      }
      const activeGroups = new Set(wanted.map(item => item.group.id));
      for (const [id, registered] of this.#groups) if (!activeGroups.has(id)) { registered.handle.dispose(); this.#groups.delete(id); }
    } catch (error) { this.clear(); throw error; }
  }
  get count() { return this.#tools.size; }
  private clear() {
    // 先撤工具后撤组，避免卸载期间工具短暂成为无组、默认开启的工具。
    for (const registered of this.#tools.values()) registered.stop();
    this.#tools.clear();
    for (const registered of this.#groups.values()) registered.handle.dispose();
    this.#groups.clear();
  }
  dispose() { this.#closed = true; this.clear(); }
}
