/** 第一批五个工具共享完整思源连接；数据原文在参数整理时保持不变。 */
import { callKernel } from "./api.js";
import { SiYuanConnection } from "./connection.js";
import { rpcTool } from "./rpc-tool.js";
import { KernelManager, managedTools, DOMAIN_SPEC } from "./manager.js";
import { createRoute, ROUTE } from "./route.js";
import { toolDef, requiredText as text, requiredId as id, optionalText, contentType } from "./tool.js";
export const name = "dsh-plugin-siyuan";
export const inject = ["tools", "storageDomain", "credentials"];
export const SERVICE = "siyuan";
const string = { type: "string" };
const blockId = { type: "string", pattern: "^\\d{14}-[0-9a-z]{7}$" };
const dataType = { type: "string", enum: ["markdown", "dom"] };
function parameters(properties, required = ["action"]) {
    return { type: "object", properties, required, additionalProperties: false };
}
function blockIds(data) {
    if (!Array.isArray(data))
        throw new Error("内核事务响应应为数组");
    return data.flatMap(tx => {
        if (!Array.isArray(tx.doOperations))
            throw new Error("内核事务缺少 doOperations");
        return tx.doOperations.flatMap((op) => op.id ? [op.id] : []);
    });
}
export function createTools(connection) {
    const kernel = (path, payload, signal) => callKernel(connection, path, payload, signal);
    return [
        toolDef("siyuan_query", "读取思源：notebooks 列笔记本；docs 按 notebook 列文档（默认最多64条，可用 limit/offset 分页）；search 全文搜索；sql 查询 SQL；read 读块 Kramdown；children 列子块。索引更新可能晚于写入成功。", parameters({
            action: { type: "string", enum: ["notebooks", "docs", "search", "sql", "read", "children"] },
            notebook: blockId, query: string, stmt: string, id: blockId,
            page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 },
            limit: { type: "integer", minimum: 1, maximum: 1000 }, offset: { type: "integer", minimum: 0 },
        }), async (args, signal) => {
            switch (args.action) {
                case "notebooks": return kernel("/api/notebook/lsNotebooks", {}, signal);
                case "docs": {
                    const notebook = id(args, "notebook");
                    const stmt = `SELECT id, content, hpath, created, updated FROM blocks WHERE type = 'd' AND box = '${notebook}' ORDER BY updated DESC LIMIT ${args.limit ?? 64} OFFSET ${args.offset ?? 0}`;
                    return kernel("/api/query/sql", { stmt }, signal);
                }
                case "sql": return kernel("/api/query/sql", { stmt: text(args, "stmt") }, signal);
                case "read": return kernel("/api/block/getBlockKramdown", { id: id(args, "id") }, signal);
                case "children": return kernel("/api/block/getChildBlocks", { id: id(args, "id") }, signal);
                case "search": {
                    const payload = { query: text(args, "query") };
                    for (const key of ["page", "pageSize", "notebook"])
                        if (args[key] !== undefined)
                            payload[key] = args[key];
                    return kernel("/api/search/fullTextSearchBlock", payload, signal);
                }
                default: throw new Error("未知查询 action");
            }
        }),
        toolDef("siyuan_create", "创建思源内容：doc 按 notebook/path 用 Markdown 建文档，重复路径不覆盖；block 在 nextID/previousID/parentID 锚点插块；append 往 parentID 追加子块。路径的 / 表示文档层级。返回新文档或块 ID。", parameters({
            action: { type: "string", enum: ["doc", "block", "append"] },
            notebook: blockId, path: string, markdown: string, data: string, dataType,
            parentID: blockId, previousID: blockId, nextID: blockId,
        }), async (args, signal) => {
            if (args.action === "doc") {
                const path = text(args, "path");
                if (!path.startsWith("/"))
                    throw new Error("path 必须以 / 开头");
                return { docId: await kernel("/api/filetree/createDocWithMd", {
                        notebook: id(args, "notebook"), path, markdown: optionalText(args, "markdown") ?? "",
                    }, signal) };
            }
            const payload = { dataType: contentType(args), data: text(args, "data", true) };
            if (args.action === "append") {
                payload.parentID = id(args, "parentID");
                return { blockIds: blockIds(await kernel("/api/block/appendBlock", payload, signal)) };
            }
            for (const key of ["nextID", "previousID", "parentID"])
                if (args[key] !== undefined)
                    payload[key] = id(args, key);
            if (!["nextID", "previousID", "parentID"].some(key => key in payload))
                throw new Error("block 需要至少一个锚点 ID");
            return { blockIds: blockIds(await kernel("/api/block/insertBlock", payload, signal)) };
        }),
        toolDef("siyuan_update", "修改思源：block 整块替换内容，先读出需要保留的内容；rename_doc 修改文档标题。支持 markdown/dom 和更新时的 lockType。", parameters({
            action: { type: "string", enum: ["block", "rename_doc"] }, id: blockId, data: string, dataType,
            lockType: { type: "boolean" }, title: string,
        }, ["action", "id"]), async (args, signal) => {
            const target = id(args, "id");
            if (args.action === "rename_doc") {
                const title = text(args, "title");
                await kernel("/api/filetree/renameDocByID", { id: target, title }, signal);
                return { id: target, title };
            }
            const payload = { id: target, dataType: contentType(args), data: text(args, "data", true) };
            if (args.lockType !== undefined)
                payload.lockType = args.lockType;
            return { blockIds: blockIds(await kernel("/api/block/updateBlock", payload, signal)) };
        }),
        toolDef("siyuan_delete", "删除思源：block 删除指定块；doc 按 ID 删除文档及子块。操作影响真实存储，调用前核对 ID。", parameters({
            action: { type: "string", enum: ["block", "doc"] }, id: blockId,
        }, ["action", "id"]), async (args, signal) => {
            const target = id(args, "id");
            if (args.action === "doc") {
                await kernel("/api/filetree/removeDocByID", { id: target }, signal);
                return { deletedDoc: target };
            }
            return { deleted: blockIds(await kernel("/api/block/deleteBlock", { id: target }, signal)) };
        }),
        rpcTool(connection),
    ];
}
export async function apply(ctx, rawConfig) {
    if (ctx.get(SERVICE) !== undefined)
        throw new Error("siyuan 服务已存在");
    const domain = await ctx.get("storageDomain").open(DOMAIN_SPEC);
    const manager = new KernelManager(domain, ctx.get("credentials"), async (connection, toolName, args, exec) => {
        const tool = createTools(connection).find(item => item.name === toolName);
        if (!tool)
            throw new Error("未知思源工具");
        return tool.execute(args, exec);
    }, async (exec, reason) => {
        const approval = ctx.get("approval");
        if (!approval || !exec.agent)
            return "unavailable";
        return approval.request({ agent: exec.agent, toolName: exec.name ?? "siyuan_rpc", callId: exec.callId,
            reason, displayReason: reason, signal: exec.signal });
    });
    try {
        await manager.initialize(rawConfig);
    }
    catch {
        await domain.close();
        throw new Error("思源配置或凭据初始化失败，请检查本机设置");
    }
    // 注册公共服务时只投影受控操作，不发布 config、HTTP、SDK client 或裸 socket。
    ctx.provide(SERVICE, Object.freeze({ invoke: manager.invoke.bind(manager) }));
    ctx.effect(() => () => manager.close(), `${name}: manager`);
    const template = new SiYuanConnection({});
    try {
        for (const tool of managedTools(manager, createTools(template))) {
            ctx.effect(() => ctx.get("tools").register(tool), `${name}: ${tool.name}`);
        }
    }
    finally {
        await template.dispose();
    }
    // 与 gateway 同样延迟挂载界面路由，headless 模式不依赖 webServer。
    ctx.inject(["webServer", "connection"], (scope) => {
        scope.effect(() => scope.get("webServer").register({ kind: "exact", path: ROUTE,
            handler: createRoute(scope, manager) }), `${name}: management`);
    });
}
