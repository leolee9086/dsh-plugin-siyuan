/** 通用 RPC 工具把连接服务投影为可序列化调用；不限制内核接口路径。 */
import { SiYuanConnection } from "./connection.js";
import { toolDef, requiredText as text, optionalText, type ToolArgs } from "./tool.js";
import type { JSONRPCParams } from "json-rpc-2.0";
import type { RpcCall } from "./rpc.js";

const string = { type: "string" };
const object = { type: "object", additionalProperties: true };
const rpcParams = { anyOf: [object, { type: "array", items: {} }] };
const schema: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["channel"],
  allOf: [
    { if: { properties: { channel: { const: "connection" } } }, then: { required: ["action"] } },
    { if: { properties: { channel: { const: "connection" }, action: { const: "select" } }, required: ["action"] }, then: { required: ["pid"] } },
    { if: { properties: { channel: { enum: ["http", "ws"] } } }, then: { required: ["path"] } },
    { if: { properties: { channel: { const: "mcp" } } }, then: { required: ["method"] } },
    { if: { properties: { channel: { const: "plugin" } }, not: { required: ["calls"] } }, then: { required: ["method"] } },
    { if: { required: ["files"] }, then: { properties: { channel: { const: "http" }, bodyType: { const: "multipart" } }, required: ["bodyType"] } },
    { if: { required: ["calls"] }, then: { properties: { channel: { const: "plugin" } }, not: { anyOf: [{ required: ["method"] }, { required: ["params"] }, { required: ["notification"] }] } } },
  ],
  properties: {
    channel: { type: "string", enum: ["http", "contract", "plugin", "mcp", "ws", "connection"] },
    action: { type: "string", enum: ["status", "select"] },
    pid: { type: "integer", minimum: 1, maximum: 2147483647 },
    path: { ...string, description: "内核路径，可带查询；HTTP/WS 必填，contract 可用于过滤" },
    method: { ...string, description: "HTTP 方法或 JSON-RPC/MCP 方法" },
    headers: { type: "object", additionalProperties: string },
    bodyType: { type: "string", enum: ["json", "text", "base64", "form", "multipart"] },
    body: { description: "对应 bodyType 的 JSON 值、文本、base64 或表单字段对象" },
    files: { type: "array", items: { type: "object", additionalProperties: false,
      properties: { field: string, name: string, base64: string, mimeType: string }, required: ["field", "name", "base64"] } },
    validate: { type: "boolean", description: "已知接口按契约校验；默认 false，原始转发保留内核兼容性" },
    responseEncoding: { type: "string", enum: ["auto", "json", "text", "base64"] },
    timeoutMs: { type: "integer", minimum: 1 },
    maxBytes: { type: "integer", minimum: 1, description: "工具响应大小上限，默认 16 MiB；超限报错，不截断" },
    plugin: { ...string, minLength: 1 },
    transport: { type: "string", enum: ["http", "ws"] },
    params: rpcParams, notification: { type: "boolean" },
    calls: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false,
      properties: { method: { ...string, minLength: 1 }, params: rpcParams, notification: { type: "boolean" } }, required: ["method"] } },
    messages: { type: "array", items: { anyOf: [string, { type: "object", additionalProperties: false,
      properties: { base64: string }, required: ["base64"] }] } },
    durationMs: { type: "integer", minimum: 1, description: "WS 最长收集时间，默认1000毫秒" },
    maxMessages: { type: "integer", minimum: 1, description: "WS 最多收集条数，默认20" },
    limit: { type: "integer", minimum: 1, maximum: 697 }, offset: { type: "integer", minimum: 0 },
    includeSchema: { type: "boolean", description: "契约发现结果附带请求 Schema 和其引用定义" },
  },
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须为对象`);
  return value as Record<string, unknown>;
}
function base64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("无效 base64");
  return Buffer.from(value, "base64");
}
function encodeBody(args: ToolArgs, headers: Headers): BodyInit | undefined {
  if (args.files !== undefined && args.bodyType !== "multipart") throw new Error("files 需要 bodyType=multipart");
  if (args.body === undefined && args.files === undefined) return undefined;
  switch (args.bodyType ?? "json") {
    case "json": headers.set("content-type", "application/json"); return JSON.stringify(args.body);
    case "text": return text(args, "body", true);
    case "base64": return new Uint8Array(base64(text(args, "body", true)));
    case "form": case "multipart": {
      const form = args.bodyType === "multipart" ? new FormData() : new URLSearchParams();
      for (const [key, field] of Object.entries(args.body === undefined ? {} : record(args.body, "body"))) {
        for (const value of Array.isArray(field) ? field : [field]) {
          if (typeof value !== "string") throw new Error("表单字段必须为字符串或字符串数组");
          form.append(key, value);
        }
      }
      if (args.files !== undefined) {
        if (!(form instanceof FormData)) throw new Error("files 需要 bodyType=multipart");
        for (const file of args.files as ToolArgs[]) {
          form.append(text(file, "field"), new Blob([new Uint8Array(base64(text(file, "base64", true)))], {
            type: optionalText(file, "mimeType") ?? "application/octet-stream",
          }), text(file, "name"));
        }
      }
      // 由 Request 产生与内容一致的 boundary，避免复用调用方错误的 multipart 头。
      headers.delete("content-type");
      return form;
    }
    default: throw new Error("未知 bodyType");
  }
}

async function readResponse(response: Response, args: ToolArgs): Promise<unknown> {
  const maxBytes = (args.maxBytes ?? 16 * 1024 * 1024) as number;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  try {
    if (reader) for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`响应超过 maxBytes=${maxBytes}，可提高 maxBytes 上限`);
      chunks.push(value);
    }
  } catch (error) { await reader?.cancel(); throw error; }
  finally { reader?.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  const mime = response.headers.get("content-type") ?? "";
  const auto = /(?:application\/(?:[\w.+-]*\+)?json)/i.test(mime) ? "json"
    : /^(?:text\/)|(?:xml|javascript|svg)/i.test(mime) ? "text" : "base64";
  const encoding = args.responseEncoding === "auto" || args.responseEncoding === undefined ? auto : args.responseEncoding;
  const body = bytes.length === 0 ? null : encoding === "json" ? JSON.parse(bytes.toString("utf8"))
    : bytes.toString(encoding === "base64" ? "base64" : "utf8");
  return { status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers),
    encoding, size, body };
}

export function rpcTool(connection: SiYuanConnection) {
  return toolDef("siyuan_rpc", "思源通用调用：channel=http 原样调用任何内核路径（JSON/表单/文件/二进制）；contract 发现697条接口契约；plugin 调思源插件 JSON-RPC，支持 HTTP/WS、通知和批量；mcp 调思源自身 MCP 方法，如 tools/list、tools/call；ws 有界收发原始 WS 消息；connection/status 查看本机实例，connection/select 用 pid 明确选择。HTTP 非2xx和内核信封原样返回，由调用方判断。长流和持久套接字也可通过 Cordis siyuan 服务取得。", schema, async (args, signal) => {
    let result: unknown;
    switch (args.channel) {
      case "connection": {
        const bounded = connection.http.signal(signal, args.timeoutMs as number | undefined);
        result = args.action === "select" ? await connection.discovery.select(args.pid as number, bounded)
          : await connection.discovery.status(bounded);
        break;
      }
      case "http": {
        const headers = new Headers(args.headers as Record<string, string> | undefined);
        const body = encodeBody(args, headers);
        const response = await connection.http.request(text(args, "path"), {
          method: optionalText(args, "method") ?? "POST", headers, body, signal,
          timeoutMs: args.timeoutMs as number | undefined, validate: args.validate === true,
        });
        result = await readResponse(response, args);
        break;
      }
      case "contract": {
        const path = optionalText(args, "path");
        const method = optionalText(args, "method")?.toUpperCase();
        const matches = connection.http.contract.endpoints.filter(spec => (!path || spec.path.includes(path)) && (!method || spec.method === method));
        const endpoints = matches.slice((args.offset ?? 0) as number, ((args.offset ?? 0) as number) + ((args.limit ?? 50) as number));
        result = { version: connection.http.contract.version, total: matches.length, endpoints: endpoints.map(spec =>
          args.includeSchema ? { ...spec, schema: connection.http.contract.requestSchema(spec) }
            : { method: spec.method, path: spec.path, body: spec.body, output: spec.output, handler: spec.handler }) };
        break;
      }
      case "plugin": {
        const options = { plugin: optionalText(args, "plugin"), transport: args.transport as "http" | "ws" | undefined,
          signal, timeoutMs: args.timeoutMs as number | undefined };
        const params = args.params as JSONRPCParams | undefined;
        if (args.calls !== undefined) result = await connection.rpc.batch(args.calls as RpcCall[], options);
        else if (args.notification) {
          await connection.rpc.notify(text(args, "method"), params, options); result = { sent: true };
        } else result = await connection.rpc.request(text(args, "method"), params, options);
        break;
      }
      case "mcp": {
        const method = text(args, "method");
        const params = args.params === undefined ? undefined : record(args.params, "params");
        if (args.notification) { await connection.mcp.notify(method, params, signal, args.timeoutMs as number | undefined); result = { sent: true }; }
        else result = await connection.mcp.request(method, params, signal, args.timeoutMs as number | undefined);
        break;
      }
      case "ws": {
        const messages = (args.messages as (string | { base64: string })[] | undefined)?.map(message =>
          typeof message === "string" ? message : base64(message.base64));
        result = await connection.ws.exchange(text(args, "path"), { signal, headers: args.headers as Record<string, string> | undefined,
          messages, durationMs: (args.durationMs ?? 1000) as number, maxMessages: (args.maxMessages ?? 20) as number });
        break;
      }
      default: throw new Error("未知 RPC channel");
    }
    // 原始连接响应保持原样，工具文本避免把服务端 echo 回来的配置凭据带入会话。
    if (connection.config.token) {
      return JSON.stringify(result, (_key, value) => typeof value === "string"
        ? value.split(connection.config.token!).join("[redacted]") : value);
    }
    return result;
  });
}
