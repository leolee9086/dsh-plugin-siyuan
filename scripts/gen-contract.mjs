/**
 * 从思源内核契约生成 RPC 客户端要用的端点表。
 *
 * 输入：siyuan 仓库的 kernel/apicontract/schema.json —— 由内核的 apigen 从
 *       kernel/apicontract/*.go 生成，是端点、请求/响应类型、body 编码方式的权威来源。
 * 输出：src/generated/contract.json —— 端点表 + 请求类型定义（$defs）闭包。
 *
 * 生成物要提交进仓库：插件不该依赖本机有一份思源源码 checkout。
 * 契约更新时重跑：node scripts/gen-contract.mjs <schema.json 路径> <思源版本号>
 */
import fs from "node:fs";
import path from "node:path";

const srcPath = process.argv[2];
const version = process.argv[3];
if (!srcPath || !version) throw new Error("用法：node scripts/gen-contract.mjs <思源schema.json路径> <思源版本号>");
const outPath = path.resolve(process.cwd(), "src/generated/contract.json");

const schema = JSON.parse(fs.readFileSync(srcPath, "utf8"));
const defs = schema.$defs ?? {};
const endpoints = schema.endpoints ?? [];

/** 收集一份 schema 片段引用到的全部 $defs（含传递闭包）。 */
function collectClosure(root, allDefs, into) {
  const stack = [root];
  const seenDefs = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    const ref = node["$ref"];
    if (typeof ref === "string" && ref.startsWith("#/$defs/")) {
      const name = ref.slice("#/$defs/".length);
      const target = allDefs[name];
      if (target === undefined) throw new Error("契约里引用了不存在的定义：" + name);
      if (!seenDefs.has(name)) {
        seenDefs.add(name);
        into[name] = target;
        stack.push(target);
      }
    }
    for (const value of Object.values(node)) stack.push(value);
  }
}

// 端点表：只留调用方需要的信息，丢掉几百 KB 的响应类型。
const table = endpoints.map((e) => ({
  method: e.method,
  path: e.path,
  body: e.body,
  handler: e.handler,
  // 非 JSON 响应（二进制、代理、SSE、WebSocket 等）要单独标出来，客户端不能一律当 JSON 解析。
  output: e.output ?? null,
  request: e.request ?? null,
}));

// 请求类型闭包：校验 payload 要用，按 $ref 传递收集。
const requestDefs = {};
for (const e of endpoints) {
  if (e.request) collectClosure(e.request, defs, requestDefs);
}

const doc = {
  $comment: "由 scripts/gen-contract.mjs 生成，不要手改。来源：思源内核 kernel/apicontract/schema.json",
  siyuanVersion: version,
  generatedFrom: path.basename(srcPath),
  endpointCount: table.length,
  endpoints: table,
  $defs: requestDefs,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(doc), "utf8");

const bodyTally = {};
for (const e of table) bodyTally[e.body] = (bodyTally[e.body] ?? 0) + 1;
console.log("写出 " + outPath);
console.log("  思源版本: " + version);
console.log("  端点: " + table.length + "  请求类型定义: " + Object.keys(requestDefs).length);
console.log("  body 分布: " + JSON.stringify(bodyTally));
console.log("  文件大小: " + (fs.statSync(outPath).size / 1024).toFixed(1) + " KB");
