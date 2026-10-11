/** 本地协议夹具：真实 HTTP/WS/MCP 传输和隔离数据；不模拟 DSH ctx。 */
import http from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export const notebookId = "20261011180000-abcdefg";
export const docId = "20261011180001-abcdefg";
export const blockId = "20261011180002-abcdefg";

export async function fixture({ version = "3.8.6", beforeVersion } = {}) {
  const requests = [];
  const data = { document: undefined, block: undefined, deleted: [], notifications: [], mcpDeleted: 0 };
  const transports = new Map();
  const ws = new WebSocketServer({ noServer: true });
  const rpcResponse = request => {
    if (!Object.hasOwn(request, "id")) { data.notifications.push(request); return undefined; }
    if (request.method === "hang") return undefined;
    return request.method === "missing" ? { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "missing", data: "details" } }
      : { jsonrpc: "2.0", id: request.id, result: request.params ?? null };
  };
  const rpc = payload => Array.isArray(payload) ? payload.map(rpcResponse).filter(Boolean) : rpcResponse(payload);
  ws.on("connection", (socket, request) => {
    if (request.url.startsWith("/ws/plugin/rpc")) {
      socket.on("message", bytes => { const response = rpc(JSON.parse(bytes.toString())); if (response && (!Array.isArray(response) || response.length)) socket.send(JSON.stringify(response)); });
    } else if (request.url.startsWith("/ws/hang")) { /* 用于取消测试。 */ }
    else socket.on("message", (bytes, binary) => socket.send(bytes, { binary }));
  });
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://fixture");
      const bytes = Buffer.concat(await Array.fromAsync(request));
      requests.push({ path: url.pathname, search: url.search, method: request.method, headers: request.headers, bytes });
      const payload = /application\/json/.test(request.headers["content-type"] ?? "") && bytes.length ? JSON.parse(bytes.toString()) : undefined;
      const json = value => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(value)); };
      const kernel = value => json({ code: 0, msg: "", data: value });
      const transaction = [{ doOperations: [{ id: blockId }] }];
      if (url.pathname === "/mcp") {
        const sessionId = request.headers["mcp-session-id"];
        let transport = transports.get(sessionId);
        if (!transport && payload?.method === "initialize") {
          const mcp = new Server({ name: "fixture", version: "1.0" }, { capabilities: { tools: {}, resources: {} } });
          mcp.setRequestHandler(ListToolsRequestSchema, (req, extra) => req.params?.cursor === "hang"
            ? new Promise(resolve => extra.signal.addEventListener("abort", () => resolve({ tools: [] }), { once: true }))
            : { tools: [{ name: "echo", inputSchema: { type: "object", additionalProperties: true } }] });
          mcp.setRequestHandler(CallToolRequestSchema, req => ({ content: [{ type: "text", text: JSON.stringify(req.params.arguments) }] }));
          mcp.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [] }));
          transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true,
            onsessioninitialized: id => transports.set(id, transport) });
          transport.onclose = () => transports.delete(transport.sessionId);
          await mcp.connect(transport);
        }
        if (!transport) { response.writeHead(400); response.end(); return; }
        if (request.method === "DELETE") data.mcpDeleted++;
        await transport.handleRequest(request, response, payload);
        return;
      }
      if (url.pathname === "/api/plugin/rpc/fail") { response.writeHead(418); response.end(); return; }
      if (url.pathname === "/auth-echo") { json({ authorization: request.headers.authorization }); return; }
      if (url.pathname.startsWith("/api/plugin/rpc")) {
        const result = rpc(payload);
        if (result === undefined || (Array.isArray(result) && result.length === 0)) { response.writeHead(204); response.end(); }
        else json(result);
        return;
      }
      switch (url.pathname) {
        case "/api/system/version": await beforeVersion?.(); kernel(version); return;
        case "/api/notebook/lsNotebooks": kernel({ notebooks: [{ id: notebookId, name: "Fixture" }] }); return;
        case "/api/filetree/createDocWithMd": data.document = payload; kernel(docId); return;
        case "/api/block/insertBlock": case "/api/block/appendBlock": data.block = payload; kernel(transaction); return;
        case "/api/block/updateBlock": data.block = payload; kernel(transaction); return;
        case "/api/block/getBlockKramdown": kernel({ id: payload.id, kramdown: data.block?.data ?? data.document?.markdown }); return;
        case "/api/block/getChildBlocks": kernel([{ id: blockId }]); return;
        case "/api/query/sql": kernel([{ id: docId, content: data.document?.path }]); return;
        case "/api/search/fullTextSearchBlock": kernel({ blocks: [{ id: blockId }], matchedBlockCount: 1 }); return;
        case "/api/filetree/renameDocByID": data.document.title = payload.title; kernel(null); return;
        case "/api/block/deleteBlock": data.deleted.push(payload.id); kernel(transaction); return;
        case "/api/filetree/removeDocByID": data.deleted.push(payload.id); kernel(null); return;
        case "/error": kernel(null); return;
        case "/rejected": json({ code: -1, msg: "kernel rejected", data: null }); return;
        case "/redirect": response.writeHead(302, { location: "http://other.invalid/" }); response.end(); return;
        case "/fail": response.writeHead(418, { "content-type": "text/plain", "x-fixture": "preserved" }); response.end("rejected body"); return;
        case "/hang": request.on("close", () => response.destroy()); return;
        case "/slow-body": response.writeHead(200, { "content-type": "text/plain" }); response.flushHeaders(); return;
        case "/stream": response.writeHead(200, { "content-type": "application/octet-stream" }); response.write(Buffer.from([0, 1])); setTimeout(() => response.end(Buffer.from([254, 255])), 10); return;
        case "/binary": response.writeHead(200, { "content-type": "application/octet-stream" }); response.end(Buffer.from([0, 255, 128, 10])); return;
        default: response.setHeader("content-type", "application/octet-stream"); response.setHeader("x-fixture", "preserved"); response.end(bytes.length ? bytes : Buffer.from(request.method + url.search));
      }
    } catch (error) { response.writeHead(500); response.end(error.stack); }
  });
  server.on("upgrade", (request, socket, head) => ws.handleUpgrade(request, socket, head, client => ws.emit("connection", client, request)));
  server.on("connect", (_request, socket, head) => {
    if (_request.url === "/connect-body") {
      socket.write("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 4\r\n\r\n");
      socket.write(Buffer.from([0, 255]));
      setTimeout(() => socket.write(Buffer.from([42, 128])), 10);
      return;
    }
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) socket.write(head);
    socket.on("data", bytes => socket.write(bytes));
  });
  const connections = new Set();
  server.on("connection", socket => { connections.add(socket); socket.on("close", () => connections.delete(socket)); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { apiUrl: `http://127.0.0.1:${server.address().port}`, requests, data, ws,
    async close() {
      for (const transport of transports.values()) await transport.close();
      for (const socket of ws.clients) socket.terminate();
      for (const socket of connections) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      await new Promise(resolve => ws.close(resolve));
    },
  };
}
