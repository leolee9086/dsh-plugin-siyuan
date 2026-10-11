/** 真实内核只读烟测。凭据仅来自外部设置的环境变量，不读取任何配置文件。 */
import { randomUUID } from "node:crypto";
import { SiYuanConnection } from "../lib/connection.js";
import { createTools } from "../lib/host.js";

const apiUrl = process.argv[2] ?? process.env.SIYUAN_API_URL;
const token = process.env.SIYUAN_TOKEN ?? "";
const connection = new SiYuanConnection({ apiUrl, token, timeoutMs: 5000 });
const tools = createTools(connection);
const report = { apiUrl: connection.config.apiUrl, checks: [] };
const safeError = error => String(error?.message ?? error).split(token || "\u0000").join("[redacted]").slice(0, 500);
try {
  const query = tools.find(tool => tool.name === "siyuan_query");
  const rpc = tools.find(tool => tool.name === "siyuan_rpc");
  try {
    const output = await rpc.execute({ channel: "connection", action: "status" });
    const result = JSON.parse(output.summary);
    report.checks.push({ name: "connection/discovery", ok: result.mode === "explicit" || result.instances.length === 1, ...result });
  } catch (error) { report.checks.push({ name: "connection/discovery", ok: false, error: safeError(error) }); }
  try {
    const output = await rpc.execute({ channel: "http", path: "/api/system/version", method: "POST", body: {} });
    const response = JSON.parse(output.summary);
    const version = response.body?.data;
    report.checks.push({ name: "HTTP/version", ok: response.status === 200, status: response.status,
      ...(typeof version === "string" && /^[\d.]+$/.test(version) ? { version } : {}) });
  } catch (error) { report.checks.push({ name: "HTTP/version", ok: false, error: safeError(error) }); }
  try {
    const output = await query.execute({ action: "notebooks" });
    const result = JSON.parse(output.summary);
    report.checks.push({ name: "CRUD/read-notebooks", ok: true, count: result.notebooks.length });
  } catch (error) { report.checks.push({ name: "CRUD/read-notebooks", ok: false, error: safeError(error) }); }
  try {
    const session = await connection.mcp.open();
    try {
      const result = await session.client.listTools();
      report.checks.push({ name: "MCP/handshake-tools-list", ok: true, protocolVersion: session.transport.protocolVersion, count: result.tools.length });
    } finally { await session.close(); }
  } catch (error) { report.checks.push({ name: "MCP/handshake-tools-list", ok: false, error: safeError(error) }); }
  try {
    const result = await connection.ws.exchange(`/ws?app=dsh-readonly-smoke&id=${randomUUID()}&type=main`, {
      durationMs: 100, maxMessages: 1,
    });
    report.checks.push({ name: "WS/read-only", ok: true, count: result.messages.length, ended: result.ended });
  } catch (error) { report.checks.push({ name: "WS/read-only", ok: false, error: safeError(error) }); }
} finally { await connection.dispose(); }
console.log(JSON.stringify(report, null, 2));
if (report.checks.some(check => !check.ok)) process.exitCode = 1;
