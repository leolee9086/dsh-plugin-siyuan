/** 思源工具发布领域：契约生成、稳定身份和注册生命周期；宿主设施由端口注入。 */
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { EndpointPolicy } from "./policy.js";
const string = { type: "string" };
const scalar = { type: ["string", "number", "boolean"] };
const fileSchema = { type: "object", additionalProperties: false, required: ["field", "name", "base64"],
    properties: { field: string, name: string, base64: string, mimeType: string } };
function record(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("工具 schema 或参数必须为对象");
    return value;
}
function toolName(label) {
    const name = `siyuan_${label.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    if (name.length > 64)
        throw new Error(`思源工具名超过64字符：${name}`);
    return name;
}
/** 同一路径与处理函数只发布一次；不同处理函数仍保留各自的请求定义。 */
function httpCatalog(contract) {
    const selected = new Map();
    const priority = (method) => method === "POST" ? 0 : method === "GET" ? 1 : 2;
    for (const spec of contract.endpoints) {
        const key = `${spec.path}\n${spec.handler}`;
        const previous = selected.get(key);
        if (!previous || priority(spec.method) < priority(previous.method))
            selected.set(key, spec);
    }
    const endpoints = [...selected.values()];
    const pathCounts = new Map();
    for (const spec of endpoints)
        pathCounts.set(spec.path, (pathCounts.get(spec.path) ?? 0) + 1);
    const entries = endpoints.map(spec => {
        const parts = spec.path.split("/").filter(Boolean);
        const leaf = parts.at(-1);
        const parents = parts.slice(0, -1).filter(part => !/^[:*]/.test(part));
        // 动态路径以及同路径的不同操作使用处理函数名；普通接口直接使用路径末段。
        const label = /^[:*]/.test(leaf) || pathCounts.get(spec.path) > 1 ? spec.handler : leaf;
        return { spec, label, parents, depth: 0, category: parents.at(-1) ?? leaf };
    });
    const reserved = new Set(["siyuan_query", "siyuan_create", "siyuan_update", "siyuan_delete", "siyuan_rpc"]);
    for (;;) {
        const counts = new Map();
        for (const entry of entries) {
            const name = toolName(entry.label);
            counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        const conflicts = entries.filter(entry => reserved.has(toolName(entry.label)) || counts.get(toolName(entry.label)) > 1);
        if (!conflicts.length)
            return entries.map(({ spec, label, category }) => ({ spec, name: toolName(label), category }));
        // 只有重名项才逐级补上父路径，例如 setting_setSnippet 与 snippet_setSnippet。
        for (const entry of conflicts) {
            const parent = entry.parents[entry.parents.length - 1 - entry.depth++];
            if (!parent)
                throw new Error(`思源端点无法按路径区分：${entry.spec.path}`);
            entry.label = `${parent}_${entry.label}`;
        }
    }
}
function group(id, title) {
    return { id, title, origin: "dsh-plugin-siyuan", defaultEnabled: false };
}
/** 受控调用已完成授权、脱敏与活动结算，这里只精简常规工具给模型看的标准信封。 */
function standardHttpResult(result) {
    let response;
    try {
        response = JSON.parse(result.summary);
    }
    catch {
        return result;
    }
    if (!response || typeof response !== "object" || !("status" in response) || typeof response.status !== "number"
        || !("encoding" in response) || response.encoding !== "json" || !("body" in response))
        return result;
    const body = response.body;
    if (!body || typeof body !== "object" || Array.isArray(body)
        || !("code" in body) || typeof body.code !== "number" || !("msg" in body) || typeof body.msg !== "string"
        || !("data" in body))
        return result;
    // 非2xx即使内核code为0也保留失败；null、false、0和空字符串都是有效data。
    const value = response.status >= 200 && response.status < 300 && body.code === 0 ? body.data
        : { isError: true, status: response.status, code: body.code, msg: body.msg, data: body.data };
    return { summary: JSON.stringify(value, null, 2) };
}
function httpDefinition(contract, { spec, name, category }) {
    const request = record(contract.requestSchema(spec));
    // HTTP契约的引用统一指向根 $defs；把定义放在工具参数根，原指针保持有效。
    const { $defs, ...bodySchema } = request;
    const pathKeys = [...spec.path.matchAll(/([:*])([A-Za-z0-9_]+)/g)];
    const properties = {
        kernelId: { ...string, description: "思源核心ID；省略时使用会话选择或默认核心" },
        query: { type: "object", additionalProperties: { anyOf: [scalar, { type: "array", items: scalar }] } },
        headers: { type: "object", additionalProperties: string, description: "业务请求头；认证由已配置核心注入" },
        responseEncoding: { type: "string", enum: ["auto", "json", "text", "base64"] },
        maxBytes: { type: "integer", minimum: 1 }, timeoutMs: { type: "integer", minimum: 1 },
    };
    const required = [];
    if (spec.body !== "none") {
        properties.body = { ...bodySchema, description: spec.body === "raw" ? "原始请求字节的 base64 文本" : "按端点契约填写；表单文件字段填写文件名，文件内容放 files" };
        if (!["raw", "legacyOptional"].includes(spec.body))
            required.push("body");
    }
    if (["form", "multipart"].includes(spec.body))
        properties.files = { type: "array", items: fileSchema };
    if (pathKeys.length) {
        properties.pathParams = { type: "object", additionalProperties: false,
            properties: Object.fromEntries(pathKeys.map(([, kind, key]) => [key, { type: "string", minLength: 1,
                    pattern: kind === ":" ? "^[^/?#%\\\\]+$" : "^[^?#%\\\\]+$" }])), required: pathKeys.map(match => match[2]) };
        required.push("pathParams");
    }
    const blocked = EndpointPolicy.blockedHttp(spec.path);
    // 路径可含句点，网关组ID只接受字母、数字、冒号、下划线和连字符。
    // 下划线也转义，避免原路径里的转义文本与特殊字符生成同一个ID；显示标题保留原文。
    const categoryId = category.replace(/[^a-zA-Z0-9-]/gu, character => `_${character.codePointAt(0).toString(16)}_`);
    return { name, group: group(`siyuan-http:${categoryId}`, `思源 · ${category}`),
        description: `思源 HTTP ${spec.method} ${spec.path}；${spec.handler}。${blocked ? `${blocked}。` : ""}执行遵循所选核心的端点授权。`,
        parameters: { type: "object", properties, required, additionalProperties: false, $defs },
        // 文件、代理、直接JSON等有各自的返回约定；只给常规端点配标准信封投影。
        project: spec.output === null ? standardHttpResult : undefined,
        translate(args) {
            const pathParams = args.pathParams === undefined ? {} : record(args.pathParams);
            let path = spec.path.replace(/[:*]([A-Za-z0-9_]+)/g, (_, key) => String(pathParams[key]));
            EndpointPolicy.cleanPath(path);
            if (args.query) {
                const query = new URLSearchParams();
                for (const [key, value] of Object.entries(record(args.query))) {
                    for (const item of Array.isArray(value) ? value : [value])
                        query.append(key, String(item));
                }
                if (query.size)
                    path += `?${query}`;
            }
            const output = { channel: "http", method: spec.method, path, validate: true };
            for (const key of ["kernelId", "headers", "responseEncoding", "maxBytes", "timeoutMs"])
                if (args[key] !== undefined)
                    output[key] = args[key];
            if (args.body !== undefined) {
                output.body = args.body;
                output.bodyType = spec.body === "raw" ? "base64" : ["form", "multipart"].includes(spec.body) ? spec.body : "json";
            }
            if (args.files !== undefined) {
                output.files = args.files;
                output.bodyType = "multipart";
                const fields = { ...record(args.body ?? {}) };
                // 文件名仍在原契约中校验，线上只发送文件本身，避免同一字段既传文本又传文件。
                for (const file of args.files) {
                    const expected = fields[file.field];
                    if (expected !== undefined && !(Array.isArray(expected) ? expected.includes(file.name) : expected === file.name)) {
                        throw new Error(`文件 ${file.field} 的 name 与 body 文件名不一致`);
                    }
                }
                for (const file of args.files)
                    delete fields[file.field];
                output.body = fields;
            }
            return output;
        } };
}
export class GatewayPublication {
    invoke;
    port;
    #tools = new Map();
    #groups = new Map();
    #http;
    #closed = false;
    constructor(contract, invoke, port) {
        this.invoke = invoke;
        this.port = port;
        this.#http = httpCatalog(contract).map(entry => httpDefinition(contract, entry));
    }
    static inventory(contract, state) {
        const mcp = state.endpoints.filter(item => item.protocol === "mcp" && item.method === "tools/call" && item.discoveredFor);
        return { http: httpCatalog(contract).length, mcp: mcp.filter(item => item.inputSchema).length,
            missingSchemas: mcp.filter(item => !item.inputSchema).length };
    }
    definitions(state) {
        const definitions = [...this.#http];
        for (const item of state.endpoints) {
            if (item.protocol !== "mcp" || item.method !== "tools/call" || !item.discoveredFor || !item.inputSchema)
                continue;
            const kernelId = item.discoveredFor;
            const kernel = state.kernels.find(kernel => kernel.id === kernelId);
            if (!kernel)
                throw new Error("MCP 工具的核心已不存在");
            definitions.push({ name: toolName(`mcp_${kernelId}_${item.detail}`),
                group: group(`siyuan-mcp:${kernelId}`, `思源 MCP · ${kernel.name}`),
                description: `思源 MCP ${item.detail}（核心：${kernel.name}）。${item.description}`,
                parameters: item.inputSchema,
                translate: args => ({ kernelId, channel: "mcp", method: "tools/call", params: { name: item.detail, arguments: args } }) });
        }
        return definitions;
    }
    /** 先校验全部新定义，再按稳定名字更新；普通授权变化不重建工具，不覆盖网关会话开关。 */
    sync(state) {
        if (this.#closed)
            throw new Error("工具发布已卸载");
        try {
            const wanted = state.gatewayTools ? this.definitions(state) : [];
            const names = new Set();
            const httpValidator = new Ajv2020({ strict: false, validateFormats: false });
            const prepared = wanted.map(definition => {
                if (names.has(definition.name))
                    throw new Error(`思源工具名冲突：${definition.name}`);
                names.add(definition.name);
                const signature = JSON.stringify([definition.description, definition.parameters, definition.group]);
                if (this.#tools.get(definition.name)?.signature === signature)
                    return { definition, signature };
                const dialect = definition.parameters.$schema;
                const Validator = typeof dialect === "string" && dialect.includes("draft-07") ? Ajv : Ajv2020;
                const validator = definition.group.id.startsWith("siyuan-http:") ? httpValidator : new Validator({ strict: false, validateFormats: false });
                const validate = validator.compile(definition.parameters);
                const tool = { name: definition.name, description: definition.description, parameters: definition.parameters,
                    output: { schema: { type: "object", required: ["summary"], properties: { summary: string }, additionalProperties: false },
                        render: (_args, result) => [{ type: "text", text: result.summary }] },
                    execute: async (args, exec) => {
                        if (this.#closed || this.#tools.get(tool.name)?.tool !== tool)
                            throw new Error("此思源工具已撤回，请重新查询工具目录");
                        if (!validate(args))
                            throw new Error(`${tool.name} 参数不符合端点 schema`);
                        exec?.signal?.throwIfAborted();
                        const result = await this.invoke("siyuan_rpc", definition.translate(args), { ...exec, name: tool.name });
                        return definition.project ? definition.project(result) : result;
                    } };
                return { definition, signature, tool };
            });
            // 核心改名时更新组标题；组ID保持不变，网关保存的会话选择仍对应同一组。
            for (const definition of wanted) {
                const registered = this.#groups.get(definition.group.id);
                if (!registered || registered.title === definition.group.title)
                    continue;
                for (const [name, entry] of this.#tools)
                    if (entry.groupId === definition.group.id) {
                        entry.stop();
                        this.#tools.delete(name);
                    }
                registered.handle.dispose();
                this.#groups.delete(definition.group.id);
            }
            for (const { definition, signature, tool } of prepared) {
                if (!tool)
                    continue;
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
            for (const [name, registered] of this.#tools)
                if (!names.has(name)) {
                    registered.stop();
                    this.#tools.delete(name);
                    this.#groups.get(registered.groupId)?.handle.remove(name);
                }
            const activeGroups = new Set(wanted.map(item => item.group.id));
            for (const [id, registered] of this.#groups)
                if (!activeGroups.has(id)) {
                    registered.handle.dispose();
                    this.#groups.delete(id);
                }
        }
        catch (error) {
            this.clear();
            throw error;
        }
    }
    get count() { return this.#tools.size; }
    clear() {
        // 先撤工具后撤组，避免卸载期间工具短暂成为无组、默认开启的工具。
        for (const registered of this.#tools.values())
            registered.stop();
        this.#tools.clear();
        for (const registered of this.#groups.values())
            registered.handle.dispose();
        this.#groups.clear();
    }
    dispose() { this.#closed = true; this.clear(); }
}
