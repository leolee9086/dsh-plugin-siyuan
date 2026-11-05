/** 思源 HTTP 转发。标准方法用 fetch，受 Fetch 规范限制的方法用 Node HTTP。 */
import * as http from "node:http";
import * as https from "node:https";
import { Readable } from "node:stream";
import { createFetchEntry, RouterContext } from "@leolee9086/sac-path-router";
import { KernelLoginError } from "./api.js";
import { Contract, loadContract } from "./contract.js";
import { KernelDiscovery } from "./discovery.js";
import { sendRequest } from "./http-recovery.js";
export class HttpConnection {
    config;
    contract;
    discovery;
    resolvedEndpoint;
    sessionCookie;
    sessionPromise;
    lifetime = new AbortController();
    router;
    tunnels = new Set();
    constructor(config, contract = loadContract()) {
        this.config = config;
        this.contract = contract;
        this.discovery = new KernelDiscovery(config);
        this.router = contract.router(async (ctx, spec) => {
            // GET 自动附带的 HEAD 处理器不应覆盖契约明确声明的 HEAD。
            if (spec.method !== ctx.method)
                return;
            if (ctx.state.describe) {
                ctx.state.spec = spec;
                ctx.response = new Response(null, { status: 204 });
                return;
            }
            if (ctx.scope?.validate)
                await this.validate(spec, ctx.request);
            ctx.response = await this.send(ctx.request);
        });
    }
    /** 同步组合路径；auto 的新网络操作使用 resolveUrl 或 bindFetch 重新发现。 */
    url(path, endpoint = this.config.apiUrl === "auto" ? this.resolvedEndpoint : this.config.apiUrl) {
        if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
            throw new Error("思源路径必须以单个 / 开头");
        }
        if (!endpoint)
            throw new Error("自动发现尚未解析，请先调用 resolveUrl 或 bindFetch");
        const base = new URL(endpoint);
        const target = new URL(`${base.pathname.replace(/\/$/, "")}${path}`, base.origin);
        if (target.origin !== base.origin)
            throw new Error("请求路径改变了内核地址");
        return target;
    }
    async endpoint(signal) {
        const bounded = this.signal(signal);
        const endpoint = await this.discovery.resolve(bounded);
        bounded.throwIfAborted();
        this.resolvedEndpoint = endpoint;
        return endpoint;
    }
    async resolveUrl(path, signal) {
        return this.url(path, await this.endpoint(signal));
    }
    /** MCP 等会话在初始化时捕获目标，后续请求和清理都不能迁移到另一个内核。 */
    async bindFetch(signal) {
        const endpoint = await this.endpoint(signal);
        return {
            url: (path) => this.url(path, endpoint),
            fetch: (input, init, options = {}) => this.fetchAt(endpoint, input, init, options),
        };
    }
    /** 为当前连接登录一次；HTTP 和 WS 共用 Cookie，认证拒绝交给管理器暂停。 */
    async ensureSession(signal) {
        if (!this.config.authCode)
            return undefined;
        return this.ensureSessionAt(await this.endpoint(signal), signal);
    }
    async ensureSessionAt(endpoint, signal) {
        if (!this.config.authCode)
            return undefined;
        if (this.sessionCookie)
            return this.sessionCookie;
        if (this.sessionPromise)
            return this.sessionPromise;
        const bounded = this.signal(signal);
        this.sessionPromise = (async () => {
            const url = this.url("/api/system/loginAuth", endpoint);
            const response = await this.send(new Request(url, {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ authCode: this.config.authCode }), signal: bounded, redirect: "manual",
            }));
            if (!response.ok) {
                await response.body?.cancel();
                if (response.status === 401 || response.status === 403 || response.status === 429) {
                    throw new KernelLoginError("思源访问码登录失败（HTTP " + response.status + "）", response.status, response.headers.get("retry-after"));
                }
                throw new Error("/api/system/loginAuth 响应 HTTP " + response.status);
            }
            const envelope = await response.json().catch(() => { bounded.throwIfAborted(); return undefined; });
            if (!envelope || typeof envelope !== "object" || !("code" in envelope) || typeof envelope.code !== "number") {
                throw new KernelLoginError("思源访问码登录响应无效，请检查内核或代理");
            }
            if (envelope.code !== 0) {
                throw new KernelLoginError(envelope.code === 1
                    ? "思源登录需要验证码或会话未能建立，请先在思源中完成登录，再人工重新检查连接"
                    : "思源访问授权码校验失败，请核对访问码后人工重新检查连接");
            }
            // 只取思源会话，代理附加的其他 Cookie 不能冒充登录成功。
            const cookie = response.headers.getSetCookie().map(value => value.split(";")[0].trim())
                .find(value => /^siyuan=.+$/.test(value));
            if (!cookie)
                throw new KernelLoginError("思源登录未返回有效的 siyuan 会话 Cookie，请检查内核或代理");
            bounded.throwIfAborted();
            this.sessionCookie = cookie;
            return cookie;
        })();
        try {
            return await this.sessionPromise;
        }
        finally {
            this.sessionPromise = undefined;
        }
    }
    headers(input) {
        const headers = new Headers(input);
        // 固定配置的 token 只发送到固定内核，不转发到重定向地址。
        if (this.config.token)
            headers.set("authorization", `Token ${this.config.token}`);
        if (this.sessionCookie && !headers.has("cookie"))
            headers.set("cookie", this.sessionCookie);
        return headers;
    }
    signal(signal, timeoutMs = this.config.timeoutMs) {
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0)
            throw new Error("timeoutMs 必须为非负整数");
        const parts = [this.lifetime.signal];
        if (signal)
            parts.push(signal);
        if (timeoutMs > 0)
            parts.push(AbortSignal.timeout(timeoutMs));
        return AbortSignal.any(parts);
    }
    /** 原始 fetch 的 URL 必须属于这次解析的内核；会话消费者使用 bindFetch 固定目标。 */
    fetch = async (input, init, options = {}) => {
        const signal = this.signal(options.signal ?? init?.signal ?? (input instanceof Request ? input.signal : undefined), options.timeoutMs);
        const endpoint = await this.endpoint(signal);
        return this.fetchAt(endpoint, input, init, { ...options, signal, timeoutMs: 0 });
    };
    async fetchAt(endpoint, input, init, options = {}) {
        const incoming = input instanceof Request ? input : new Request(input, init);
        const merged = input instanceof Request && init ? new Request(input, init) : incoming;
        const target = new URL(merged.url);
        const base = new URL(endpoint);
        if (target.origin !== base.origin)
            throw new Error("连接层只接受已配置或已发现内核的地址");
        const signal = this.signal(options.signal ?? merged.signal, options.timeoutMs);
        if (target.pathname !== this.url("/api/system/loginAuth", endpoint).pathname)
            await this.ensureSessionAt(endpoint, signal);
        const request = new Request(merged, {
            headers: this.headers(merged.headers),
            signal,
            redirect: "manual",
        });
        // 每次调用的选项留在独立闭包，避免并发请求交换校验状态。
        const entry = createFetchEntry({
            router: { routes: () => this.router.routes(), claims: () => false },
            network: (input, init) => this.send(new Request(input, init)),
            scope: () => ({ validate: options.validate }),
        });
        // 传入 init 防止路由库为读取 body 描述提前把上传流转成文本。
        return entry(request, {});
    }
    async request(path, options = {}) {
        const method = (options.method ?? "GET").toUpperCase();
        const headers = this.headers(options.headers);
        const signal = this.signal(options.signal, options.timeoutMs);
        const endpoint = await this.endpoint(signal);
        const url = this.url(path, endpoint);
        if (["CONNECT", "TRACE", "TRACK"].includes(method) || (["GET", "HEAD"].includes(method) && options.body != null)) {
            // 虚拟 POST 只负责 BodyInit 编码；真实线上方法由 node:http 原样发送。
            await this.ensureSessionAt(endpoint, signal);
            const encoded = new Request(url, { method: "POST", headers: this.headers(headers), body: options.body, signal, duplex: "half" });
            if (options.validate)
                await this.validateRaw(method, url, encoded);
            return this.nodeRequest(url, method, encoded.headers, encoded.body, signal);
        }
        return this.fetchAt(endpoint, url, {
            method, headers, body: options.body, signal, duplex: "half",
        }, { ...options, timeoutMs: 0, signal });
    }
    json(path, payload, signal) {
        return this.request(path, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify(payload), signal, validate: true,
        });
    }
    /** 契约发现复用同一组路由闭包；不会维护另一份路径表。 */
    async describe(method, path) {
        // 契约只匹配路径；使用虚拟 origin 保证离线发现不依赖本机思源是否启动。
        const ctx = new RouterContext(new Request(this.url(path, "http://siyuan.invalid")));
        ctx.method = method.toUpperCase();
        ctx.state.describe = true;
        await this.router.routes()(ctx);
        return { spec: ctx.state.spec, params: ctx.params };
    }
    async validateRaw(method, url, encoded) {
        const { spec } = await this.describe(method, url.pathname + url.search);
        if (spec)
            await this.validate(spec, encoded);
    }
    async validate(spec, request) {
        // GET 所带的查询由内核单独解析，不把查询字符串冒充成 JSON 请求体。
        if (request.body === null && ["GET", "HEAD"].includes(request.method))
            return;
        let payload;
        switch (spec.body) {
            case "json":
            case "structJSON":
            case "legacyOptional": {
                const text = await request.clone().text();
                payload = text === "" && spec.body === "legacyOptional" ? {} : JSON.parse(text);
                break;
            }
            case "none":
                payload = {};
                break;
            case "multipart":
            case "form": {
                const form = await request.clone().formData();
                const schema = this.contract.requestSchema(spec);
                const properties = (schema.$ref ? schema.$defs[schema.$ref.slice(8)]?.properties : schema.properties) ?? {};
                const record = {};
                for (const key of new Set(form.keys())) {
                    const values = form.getAll(key).map(value => typeof value === "string" ? value : value.name);
                    record[key] = properties[key]?.type === "array" || values.length > 1 ? values : values[0];
                }
                payload = record;
                break;
            }
            // binary format 只检查传输形状，不读入或修改上传字节。
            case "raw":
                payload = "";
                break;
            default: throw new Error(`未知契约 body 类型：${spec.body}`);
        }
        this.contract.check(spec, payload);
    }
    send(request) {
        return sendRequest(request);
    }
    nodeRequest(url, method, headers, body, signal) {
        return new Promise((resolve, reject) => {
            const client = url.protocol === "https:" ? https : http;
            const outgoingHeaders = new Headers(headers);
            // Node 默认不给 GET/TRACE 使用 chunked；有流式请求体时必须明确声明传输编码。
            if (body && !outgoingHeaders.has("content-length") && !outgoingHeaders.has("transfer-encoding")) {
                outgoingHeaders.set("transfer-encoding", "chunked");
            }
            const req = client.request(url, { method, headers: Object.fromEntries(outgoingHeaders), signal }, response => {
                const responseHeaders = new Headers();
                for (let i = 0; i < response.rawHeaders.length; i += 2)
                    responseHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
                const status = response.statusCode;
                const empty = method === "HEAD" || [204, 205, 304].includes(status);
                if (empty)
                    response.resume();
                resolve(new Response(empty ? null : Readable.toWeb(response), {
                    status, statusText: response.statusMessage, headers: responseHeaders,
                }));
            });
            req.on("error", reject);
            // Node 把成功 CONNECT 一律当作升级。保留首段和后续字节，内核的有界 HTTP
            // 内容按 Content-Length 完成；未声明长度时交付原始隧道流，双向通信用 openTunnel。
            req.on("connect", (response, socket, head) => {
                this.tunnels.add(socket);
                const abort = () => socket.destroy(signal.reason instanceof Error ? signal.reason : new Error("CONNECT 已取消"));
                socket.on("error", () => { });
                signal.addEventListener("abort", abort, { once: true });
                socket.once("close", () => { this.tunnels.delete(socket); signal.removeEventListener("abort", abort); });
                if (signal.aborted)
                    abort();
                const length = response.headers["content-length"];
                const expected = length === undefined ? Infinity : Number(length);
                async function* bytes() {
                    let received = 0;
                    try {
                        if (head.length && expected > 0) {
                            const chunk = head.subarray(0, expected);
                            received += chunk.length;
                            yield chunk;
                        }
                        if (received >= expected)
                            return;
                        for await (const value of socket) {
                            const chunk = value.subarray(0, expected - received);
                            received += chunk.length;
                            yield chunk;
                            if (received >= expected)
                                return;
                        }
                        if (Number.isFinite(expected) && received !== expected)
                            throw new Error("CONNECT 响应体提前结束");
                    }
                    finally {
                        socket.destroy();
                    }
                }
                const responseHeaders = new Headers();
                for (let i = 0; i < response.rawHeaders.length; i += 2)
                    responseHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
                resolve(new Response(Readable.toWeb(Readable.from(bytes())), {
                    status: response.statusCode, statusText: response.statusMessage, headers: responseHeaders,
                }));
            });
            if (body) {
                const source = Readable.fromWeb(body);
                source.on("error", error => req.destroy(error));
                req.on("close", () => source.destroy());
                source.pipe(req);
            }
            else
                req.end();
        });
    }
    /** 真正的 CONNECT 返回套接字和已收到的首段字节，不伪装成 fetch Response。 */
    async openTunnel(path, options = {}) {
        const signal = this.signal(options.signal, options.timeoutMs);
        const endpoint = await this.endpoint(signal);
        await this.ensureSessionAt(endpoint, signal);
        const url = this.url(path, endpoint);
        return new Promise((resolve, reject) => {
            const req = (url.protocol === "https:" ? https : http).request(url, {
                method: "CONNECT", headers: Object.fromEntries(this.headers(options.headers)), signal,
            });
            req.on("error", reject);
            req.on("connect", (response, socket, head) => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    socket.destroy();
                    reject(new Error(`CONNECT HTTP ${response.statusCode}`));
                    return;
                }
                this.tunnels.add(socket);
                const abort = () => socket.destroy();
                socket.on("error", () => { });
                signal.addEventListener("abort", abort, { once: true });
                socket.once("close", () => { this.tunnels.delete(socket); signal.removeEventListener("abort", abort); });
                if (signal.aborted)
                    abort();
                resolve({ socket, head, status: response.statusCode, headers: response.headers });
            });
            req.on("response", response => { response.resume(); reject(new Error(`CONNECT 未升级（HTTP ${response.statusCode}）`)); });
            req.end();
        });
    }
    dispose() {
        this.lifetime.abort(new Error("思源连接已卸载"));
        for (const socket of this.tunnels)
            socket.destroy();
        this.tunnels.clear();
    }
}
