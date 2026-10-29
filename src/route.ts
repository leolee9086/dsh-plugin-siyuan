/** 人工管理界面的同源路由。鉴权服务缺席时拒绝；请求体、凭据和异常对象不进入日志。 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { KernelManager } from "./manager.js";
import type { Decision } from "./policy.js";
export const ROUTE = "/api/siyuan-control";
function json(response: ServerResponse, status: number, value: unknown) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}
import { ManagementInput } from "./management-input.js";
const { required } = ManagementInput;
export function createRoute(requestRejection: (request: IncomingMessage) => 401 | 403 | 503 | undefined, manager: KernelManager) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      // 宿主统一校验来源和身份；桌面转发已验证页面来源，送达此处时不携带 Origin。
      const rejection = requestRejection(request);
      if (rejection === 503) { json(response, 503, { error: "鉴权服务不可用" }); return; }
      if (rejection !== undefined) { json(response, rejection, { error: "未通过管理界面身份验证" }); return; }
      const url = new URL(request.url ?? ROUTE, "http://localhost");
      if (request.method === "GET") {
        const input = ManagementInput.query(url.searchParams);
        switch (input.view) {
          case "state": json(response, 200, manager.safe(await manager.publicState())); return;
          case "endpoints": json(response, 200, manager.safe(manager.endpoints(input.kernelId, input.filter))); return;
          case "activity": json(response, 200, manager.activities(input.sessionId, input.offset)); return;
        }
      }
      if (request.method !== "POST") { json(response, 405, { error: "仅支持 GET/POST" }); return; }
      ManagementInput.requireJson(request.headers["content-type"]);
      const input = await ManagementInput.body(request);
      let result: unknown = { ok: true };
      switch (input.action) {
        case "saveKernel": result = await manager.saveKernel(input); break;
        case "removeKernel": await manager.removeKernel(required(input.kernelId)); break;
        case "defaultKernel": await manager.select(input.kernelId === null ? null : required(input.kernelId)); break;
        case "sessionKernel": await manager.select(input.kernelId === null ? null : required(input.kernelId), required(input.sessionId)); break;
        case "sessionRuleKernel": await manager.selectRuleSource(input.kernelId === null ? null : required(input.kernelId), required(input.sessionId)); break;
        case "grant": await manager.grant(required(input.kernelId), required(input.endpointKey), input.decision as Decision); break;
        case "declare": result = await manager.declare(input); break;
        case "instances": result = await manager.connectionInstances(required(input.kernelId)); break;
        case "selectInstance": result = await manager.selectInstance(required(input.kernelId), input.pid); break;
        case "test": result = await manager.inspectConnection(required(input.kernelId)); break;
        case "discoverMcp": result = await manager.inspectConnection(required(input.kernelId), true); break;
        case "registerGateway":
          if (typeof input.enabled !== "boolean") throw new Error("工具箱注册选择必须为布尔值");
          result = await manager.registerGateway(input.enabled); break;
        default: throw new Error("未知管理操作");
      }
      json(response, 200, manager.safe(result));
    } catch (error) { json(response, 400, { error: manager.error(error).message, diagnostic: manager.errorText(error) }); }
  };
}
