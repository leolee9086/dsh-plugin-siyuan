/** 人工管理界面的同源路由。鉴权服务缺席时拒绝；请求体、凭据和异常对象不进入日志。 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { KernelManager } from "./manager.js";
export declare const ROUTE = "/api/siyuan-control";
export declare function createRoute(requestRejection: (request: IncomingMessage) => 401 | 403 | 503 | undefined, manager: KernelManager): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
