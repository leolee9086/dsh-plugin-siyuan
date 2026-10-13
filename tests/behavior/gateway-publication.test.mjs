import test from "node:test";
import assert from "node:assert/strict";
import { GatewayPublication } from "../../lib/gateway-publication.js";
import { loadContract, Contract } from "../../lib/contract.js";
import { ControlState } from "../../lib/control-state.js";
import { EndpointPolicy } from "../../lib/policy.js";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClientUI } from "../../lib/client-ui.js";

const state = () => ({ revision: 1, kernels: [{ id: "local", name: "本机", apiUrl: "http://127.0.0.1:6806", timeoutMs: 1000, enabled: true }],
  defaultKernelId: "local", grants: [], endpoints: [], sessions: {}, gatewayTools: true });
const mcp = (kernelId, inputSchema = { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false }) => ({
  ...EndpointPolicy.endpoint("mcp", "tools/call", "", "same.name", "写入文本"), discoveredFor: kernelId, inputSchema });
function setup(t, contract = loadContract(), reply = async () => ({ summary: "ok" })) {
  // 只记录领域端口的注册/撤回效果，不模拟 Harness ctx、工具执行器或网关开关算法。
  const tools = new Map(), groups = new Map(), events = [], calls = [];
  const publication = new GatewayPublication(contract, async (...args) => { calls.push(args); return reply(...args); }, {
    registerGroup(spec) {
      // 与工具箱公开组ID约束一致，发布过程中就拒绝不兼容的声明。
      assert.match(spec.id, /^[a-z0-9][a-z0-9:_-]*$/i);
      assert.equal(groups.has(spec.id), false); groups.set(spec.id, spec); events.push(["group", spec]);
      return { add(name) { events.push(["add", name]); }, remove(name) { events.push(["remove", name]); },
        dispose() { events.push(["disposeGroup", spec.id]); groups.delete(spec.id); } };
    },
    registerTool(tool) {
      assert.equal(tools.has(tool.name), false); tools.set(tool.name, tool); events.push(["tool", tool.name]);
      return () => { tools.delete(tool.name); events.push(["stop", tool.name]); };
    },
  });
  t.after(() => publication.dispose());
  const find = path => [...tools.values()].find(tool => tool.description.includes(path));
  return { publication, tools, groups, events, calls, find };
}

test("697条HTTP契约合并同用途方法，工具按路径命名分组且再次同步不重注册", async t => {
  const { publication, tools, groups, events, find, calls } = setup(t);
  const data = state(); publication.sync(data);
  assert.equal(tools.size, 663);
  assert.equal(GatewayPublication.inventory(loadContract(), data).http, 663);
  assert.equal(groups.get("siyuan-http:query").title, "思源 · query");
  assert.equal(groups.get("siyuan-http:block").title, "思源 · block");
  assert.equal(groups.get("siyuan-http:_2e_well-known").title, "思源 · .well-known");
  for (const spec of groups.values()) assert.equal(spec.defaultEnabled, false);
  for (const name of tools.keys()) {
    assert.match(name, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.doesNotMatch(name, /^siyuan_http_|_[0-9a-f]{12}$/);
  }
  assert.equal(find("POST /api/query/sql；").name, "siyuan_sql");
  assert.equal(find("POST /api/block/getBlockInfo；").name, "siyuan_getBlockInfo");
  assert.equal(find("POST /api/setting/setSnippet；").name, "siyuan_setting_setSnippet");
  assert.equal(find("POST /api/snippet/setSnippet；").name, "siyuan_snippet_setSnippet");
  assert.equal(find("POST /api/ai/agent/chat；").name, "siyuan_agent_chat");
  assert.equal(find("POST /api/ai/editor/chat；").name, "siyuan_editor_chat");
  assert.equal(find("POST /api/network/echo；").name, "siyuan_echo");
  assert.equal(find("GET /api/network/echo；"), undefined);
  assert.equal(find("GET /api/system/version；"), undefined);
  assert.ok(find("POST /api/system/version；"));
  assert.equal(find("GET /api/plugin/rpc；").name, "siyuan_getLoadedPluginRPC");
  assert.equal(find("POST /api/plugin/rpc；").name, "siyuan_pluginJsonRpcHttp");
  assert.equal(find("GET /es/network/proxy；").name, "siyuan_es_network_proxy");
  const before = events.length; publication.sync({ ...data, revision: 2 }); assert.equal(events.length, before);
  const sql = find("POST /api/query/sql；"); const exec = { callId: "source", agent: { session: { id: "session" } } };
  await sql.execute({ body: { stmt: "select 1" }, kernelId: "local" }, exec);
  assert.deepEqual(calls[0], ["siyuan_rpc", { channel: "http", method: "POST", path: "/api/query/sql", validate: true,
    kernelId: "local", body: { stmt: "select 1" }, bodyType: "json" }, { ...exec, name: sql.name }]);
  await assert.rejects(sql.execute({ body: { stmt: 42 } }), /schema/);
  assert.equal(calls.length, 1);
  for (let i = 0; i < events.length; i++) if (events[i][0] === "tool") assert.deepEqual(events[i - 1], ["add", events[i][1]]);
});

test("HTTP映射保留路径参数、查询、二进制及表单文件，受控调用保持端点身份", async t => {
  const full = loadContract();
  const paths = ["/api/network/echo/*path", "/api/asset/upload", "/api/file/putFile", "/api/notebook/lsNotebooks"];
  const contract = new Contract({ siyuanVersion: full.version, endpointCount: 0, $defs: {}, endpoints: [] });
  // requestSchema从真实契约返回引用闭包，覆盖上传字段与递归引用解析。
  contract.endpoints.push(...full.endpoints.filter(spec => spec.method === "POST" && paths.includes(spec.path)));
  contract.requestSchema = spec => full.requestSchema(spec);
  const { publication, find, calls } = setup(t, contract); publication.sync(state());
  await find("/api/network/echo/*path；").execute({ pathParams: { path: "a/b" }, body: "aGk=", query: { q: ["中文", "a b"] } });
  assert.equal(calls.at(-1)[1].path, "/api/network/echo/a/b?q=%E4%B8%AD%E6%96%87&q=a+b");
  assert.equal(calls.at(-1)[1].bodyType, "base64");
  await assert.rejects(find("/api/network/echo/*path；").execute({ pathParams: { path: "../query/sql" } }), /歧义/);
  const files = [{ field: "file", name: "hello.txt", base64: "aGk=" }];
  await find("/api/file/putFile；").execute({ body: { path: "/data/hello.txt", file: "hello.txt" }, files });
  assert.deepEqual(calls.at(-1)[1].body, { path: "/data/hello.txt" });
  assert.deepEqual(calls.at(-1)[1].files, files); assert.equal(calls.at(-1)[1].bodyType, "multipart");
  await assert.rejects(find("/api/file/putFile；").execute({ body: { file: "wrong" }, files }), /不一致/);
  await find("/api/notebook/lsNotebooks；").execute({}); assert.equal(calls.at(-1)[1].body, undefined);
});

test("常规HTTP成功只返回data，失败保留状态；特殊响应与结算警告保留原样", async t => {
  const full = loadContract();
  const paths = ["/api/block/getBlockKramdown", "/api/file/getFile", "/api/plugin/rpc"];
  const contract = new Contract({ siyuanVersion: full.version, endpointCount: 0, $defs: {}, endpoints: [] });
  contract.endpoints.push(...full.endpoints.filter(spec => paths.includes(spec.path)));
  contract.requestSchema = spec => full.requestSchema(spec);
  let reply;
  const { publication, find, tools } = setup(t, contract, async () => reply);
  const data = state(); data.endpoints = [mcp("local")]; publication.sync(data);
  const read = find("POST /api/block/getBlockKramdown；");
  const args = { body: { id: "20261011180002-abcdefg" } };
  const response = (body, status = 200, encoding = "json") => ({ status, statusText: "fixture", encoding,
    headers: { "content-type": "application/json" }, size: 100, body });
  const set = value => { reply = { summary: JSON.stringify(value) }; };
  for (const value of [{ id: args.body.id, kramdown: "正文" }, [1, 2], null, false, 0, "", "文字"]) {
    set(response({ code: 0, msg: "", data: value }));
    const result = await read.execute(args);
    assert.deepEqual(JSON.parse(result.summary), value);
    assert.deepEqual(read.output.render(args, result), [{ type: "text", text: result.summary }]);
  }
  for (const [status, code] of [[200, -1], [403, -1], [503, 0]]) {
    set(response({ code, msg: "请求失败", data: { reason: "详情" } }, status));
    assert.deepEqual(JSON.parse((await read.execute(args)).summary), {
      isError: true, status, code, msg: "请求失败", data: { reason: "详情" },
    });
  }
  // 非标准JSON、显式文本/二进制、记录失败警告都保留原响应，不猜测data含义。
  for (const value of [response({ result: "直接JSON" }), response({ code: 0, msg: "无data" }),
    response("不可用", 503, "text"), response("AA==", 200, "base64"),
    { result: response({ code: 0, msg: "", data: null }), operationId: "operation-1", recordStatus: "结算记录失败，勿重复写入" }]) {
    set(value); assert.deepEqual(await read.execute(args), reply);
  }
  reply = { summary: "调用结果文本" }; assert.deepEqual(await read.execute(args), reply);
  set(response({ code: 0, msg: "", data: { nested: true } }));
  assert.deepEqual(await find("POST /api/file/getFile；").execute({ body: { path: "/data/test.json" } }), reply);
  assert.deepEqual(await find("POST /api/plugin/rpc；").execute({ body: { jsonrpc: "2.0", method: "echo" } }), reply);
  assert.deepEqual(await tools.get("siyuan_mcp_local_same_name").execute({ text: "测试" }), reply);
});

test("MCP完整schema跨核心独立，更新与删除撤回旧工具，旧持久数据要求重新发现", async t => {
  const { publication, tools, groups, calls } = setup(t, new Contract({ siyuanVersion: "test", endpointCount: 0, endpoints: [], $defs: {} }));
  const data = state(); data.kernels.push({ ...data.kernels[0], id: "other", name: "另一个" });
  data.endpoints = [mcp("local"), mcp("other")]; publication.sync(data);
  const [first, second] = [...tools.values()];
  assert.equal(first.name, "siyuan_mcp_local_same_name");
  assert.equal(second.name, "siyuan_mcp_other_same_name");
  assert.deepEqual(first.parameters, data.endpoints[0].inputSchema);
  await first.execute({ text: "你好" }); await second.execute({ text: "世界" });
  assert.equal(calls[0][1].kernelId, "local"); assert.equal(calls[1][1].kernelId, "other");
  assert.deepEqual(calls[0][1].params, { name: "same.name", arguments: { text: "你好" } });
  const recursive = { type: "object", properties: { next: { $ref: "#" } }, additionalProperties: false };
  data.endpoints = [mcp("local", recursive)]; publication.sync(data);
  assert.equal(tools.size, 1); assert.equal([...tools.keys()][0], first.name);
  await tools.get(first.name).execute({ next: {} });
  await assert.rejects(first.execute({ text: "旧参数" }), /撤回/);
  await assert.rejects(second.execute({ text: "已删除" }), /撤回/);
  data.kernels[0].name = "已改名"; publication.sync(data);
  assert.equal(groups.get("siyuan-mcp:local").title, "思源 MCP · 已改名");
  assert.equal([...tools.keys()][0], first.name);
  await tools.get(first.name).execute({ next: {} });
  const restored = ControlState.DOMAIN_SPEC.tables.config.valueSchema.parse(data);
  assert.deepEqual(restored.endpoints[0].inputSchema, recursive); assert.equal(restored.gatewayTools, true);
  delete restored.endpoints[0].inputSchema;
  assert.equal(GatewayPublication.inventory({ endpoints: [] }, restored).missingSchemas, 1);
  publication.sync(restored); assert.equal(tools.size, 0);
});

test("注册失败撤回已发布成员；停止发布先撤工具后撤组，网关重连恢复保存的选择", async t => {
  const contract = new Contract({ siyuanVersion: "test", endpointCount: 0, endpoints: [], $defs: {} });
  const view = setup(t, contract); const data = state(); data.endpoints = [mcp("local")];
  view.publication.sync(data); const old = [...view.tools.values()][0];
  data.endpoints[0].inputSchema = { type: "object", properties: { bad: { $ref: "#/$defs/missing" } } };
  assert.throws(() => view.publication.sync(data), /resolve reference/); assert.equal(view.tools.size, 0); assert.equal(view.groups.size, 0);
  await assert.rejects(old.execute({ text: "x" }), /撤回/);
  data.endpoints = [mcp("local")]; view.publication.sync(data); view.publication.sync({ ...data, gatewayTools: false });
  assert.deepEqual(view.events.slice(-3).map(event => event[0]), ["stop", "remove", "disposeGroup"]);
  view.publication.dispose();
  const restored = setup(t, contract); restored.publication.sync(data); assert.equal(restored.tools.size, 1);
});

test("管理界面显示全量注册、缺失schema与网关状态", () => {
  const { GatewayPanel } = createClientUI(React, {});
  const html = renderToStaticMarkup(React.createElement(GatewayPanel, { gateway: { available: true, requested: false,
    http: 663, mcp: 12, registered: 0, missingSchemas: 2 }, busy: false }));
  assert.match(html, /663 个 HTTP/); assert.match(html, /12 个 MCP/); assert.match(html, /注册全部 HTTP/);
  assert.match(html, /2 个旧 MCP/); assert.match(html, /新工具默认关闭/);
});
