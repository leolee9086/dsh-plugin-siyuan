/** 思源插件 JSON-RPC：ID 匹配和批量响应交给 json-rpc-2.0，HTTP/WS 只承担传输。 */
import { JSONRPCClient, createJSONRPCRequest, createJSONRPCNotification, isJSONRPCResponse } from "json-rpc-2.0";
export class PluginRpc {
    http;
    sockets;
    constructor(http, sockets) {
        this.http = http;
        this.sockets = sockets;
    }
    /** 单次调用返回 result；内核 JSON-RPC error 保留 code 和 data。 */
    async request(method, params, options = {}) {
        return this.run(options, client => client.request(method, params));
    }
    async notify(method, params, options = {}) {
        // notify() 会吞掉发送错误；显式等待 send()，发送失败必须能看见。
        await this.run(options, client => client.send(createJSONRPCNotification(method, params)));
    }
    async batch(calls, options = {}) {
        if (!calls.length)
            throw new Error("JSON-RPC batch 不能为空");
        return this.run(options, client => client.requestAdvanced(calls.map((call, index) => call.notification ? createJSONRPCNotification(call.method, call.params) : createJSONRPCRequest(index + 1, call.method, call.params))));
    }
    async run(options, action) {
        const signal = this.http.signal(options.signal, options.timeoutMs);
        signal.throwIfAborted();
        const suffix = options.plugin === undefined ? "" : `/${encodeURIComponent(options.plugin)}`;
        let socket;
        let transportError;
        let client;
        const receive = (payload) => {
            const responses = Array.isArray(payload) ? payload : [payload];
            // WS 也可能收到服务端通知，它们交由原始 WS 消费者读取，不当成响应。
            const replies = responses.filter(isJSONRPCResponse);
            if (replies.length)
                client.receive(replies);
            if (!replies.length && (options.transport ?? "http") === "http")
                throw new Error("插件 RPC 未返回有效的 JSON-RPC 响应");
        };
        client = new JSONRPCClient(async (payload) => {
            try {
                if (socket) {
                    await new Promise((resolve, reject) => socket.send(JSON.stringify(payload), error => error ? reject(error) : resolve()));
                }
                else {
                    const response = await this.http.request(`/api/plugin/rpc${suffix}`, {
                        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal, timeoutMs: 0,
                    });
                    if (!response.ok) {
                        await response.body?.cancel();
                        throw new Error(`插件 RPC HTTP ${response.status}`);
                    }
                    const text = await response.text();
                    if (text)
                        receive(JSON.parse(text));
                    else if ((Array.isArray(payload) ? payload : [payload]).some(item => item.id !== undefined)) {
                        throw new Error("插件 RPC 有 ID 的请求收到空响应");
                    }
                }
            }
            catch (error) {
                transportError = error;
                throw error;
            }
        });
        const abort = () => client.rejectAllPendingRequests("插件 RPC 已取消");
        signal.addEventListener("abort", abort, { once: true });
        try {
            if (options.transport === "ws") {
                socket = await this.sockets.open(`/ws/plugin/rpc${suffix}`, { signal,
                    onMessage: (data, binary) => {
                        try {
                            if (binary)
                                throw new Error("插件 JSON-RPC 收到二进制帧");
                            receive(JSON.parse(data.toString("utf8")));
                        }
                        catch (error) {
                            transportError = error;
                            client.rejectAllPendingRequests("无效插件 RPC 响应");
                        }
                    },
                });
                socket.on("close", () => client.rejectAllPendingRequests("插件 RPC 连接关闭"));
                socket.on("error", error => { transportError = error; client.rejectAllPendingRequests(error.message); });
            }
            const result = await action(client);
            signal.throwIfAborted();
            if (transportError)
                throw transportError;
            return result;
        }
        catch (error) {
            // request() 会把发送失败转换为 JSON-RPC error；保留原始取消/传输原因。
            signal.throwIfAborted();
            throw transportError ?? error;
        }
        finally {
            signal.removeEventListener("abort", abort);
            client.rejectAllPendingRequests("插件 RPC 调用结束");
            socket?.terminate();
        }
    }
}
