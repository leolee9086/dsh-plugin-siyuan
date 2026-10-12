# dsh-plugin-siyuan

思源笔记的 DSH 插件：多核心连接配置、逐端点授权、左侧思源入口和右侧会话活动记录，保留恰好五个模型工具。

`main` 分支包含 **0.2.0 开发版本**：多核心配置、端点授权及界面实现。构建与独立行为测试已通过，宿主接口集成和真实软件运行尚未验收。公开标签 v0.1.3 仍是旧连接层版本，不包含本页描述的新授权界面；0.2.0 尚无版本标签、安装包或 GitHub Release。

## 连接与凭据

插件加载后，从插件市场附近的思源图标进入主面板。核心连接页支持添加、编辑、停用和删除核心，设置默认核心，检查连接。右侧「思源活动」页可以为当前会话选择核心。调用时的目标顺序为工具参数 `kernelId`、会话选择、明确配置的默认核心；找不到目标或目标失效时拒绝，不挑另一核心。

每个核心可以配置本机 `auto` 或明确的 HTTP(S) 地址、超时、可选端口登记文件与 PID。远程地址支持代理路径前缀，禁止 URL 凭据、查询和片段。自动模式读取思源维护的账户主目录 `.config/siyuan/port.json`，不扫描端口。先在界面「检查连接」：只有一个有效实例时绑定并保存 PID；多实例需要人工填写 PID。模型调用不会自动绑定新实例，已绑定实例退出后不会切到另一实例。更换地址、PID 或登记文件会撤销该核心的旧授权。

API token 只由人工在密码框写入 DSH 的本机 `credentials` 服务，持久配置与活动记录不保存 token 值。凭据的存储与保护由 DSH 负责；本插件负责人工只写、宿主取用及模型输出过滤，不另建凭据存储层。编辑时只显示已配置状态，不回填原值；留空保留，填写新值替换，也可明确清除。工具参数不接受 token 或认证头，宿主向固定核心注入 `Authorization: Token ...`，不转发到重定向地址。

所有核心的已配置凭据共用输出过滤：CRUD、HTTP、插件 RPC、MCP、WS、管理返回和错误都经过安全投影，覆盖原值、JSON 字符串、URL 编码、base64/hex 及含凭据的整体编码响应。敏感配置字段被遮罩；MCP 图片和音频字节只保留说明。错误不转发原始异常对象、stack、cause 或请求配置。过滤作用于本插件的返回接口；本机文件访问和浏览器权限由宿主管理。

DSH 需要提供 `tools`、`storageDomain` 和 `credentials` 服务。管理路由通过 `connection.requestRejection` 鉴权；变更另要求同源 Origin 与 JSON。持久化或凭据服务不可用时失败关闭，不降级为允许。旧组合里的非空 `token` 在首次初始化时导入 credentials；应由人工清除旧组合中的明文配置，不要将其内容发送到会话。

## 端点授权

端点页提供 697 条来自思源 v3.8.6 的 HTTP 契约，支持按核心、协议、方法、授权状态筛选，搜索路径、方法、工具名和说明，并分页。MCP 工具通过人工点击「发现 MCP 工具」获取，仅进入该核心目录，不获得权限。扩展 HTTP、插件 RPC、MCP 方法和 WS 操作可人工声明入目录。

每个端点单独选择「未授权」「每次批准」或「允许」，并确认具体核心与具体端点。默认全部未授权；发现、声明和新增方法都不会继承权限。「每次批准」通过 DSH 审批服务请求一次性批准，无会话、无审批服务、被拒绝或取消都不执行。批准期间配置改变则停止派发。

授权键分别为：

- HTTP：方法与契约路径；未知路径使用具体路径。四个 CRUD 与同路径的原始 HTTP 共用授权。
- MCP：方法；`tools/call` 还需具体工具名的独立授权。
- 插件 RPC：插件名与方法；批量调用另需 `$batch`，且先检查所有内部方法。
- WS：连接路径的 `connect`，发送操作另需该路径与具体 JSON `cmd` 的 `send` 权限。
- 连接状态：`connection/status`。PID 切换只在人工配置页完成。

原始 HTTP 的 MCP、插件 RPC 和 WS 包裹路径不能代替具体方法授权。代理、事务等尚未解析内部效果的委托接口本阶段不开放。WS 二进制发送和无 `cmd` 的不透明消息不开放。编码或折叠等有歧义的端点路径拒绝执行。

本阶段是端点授权：允许覆盖该端点的全部可操作资源。文档、笔记本、文件路径等资源范围授权，以及内容来源、差异追踪和思源侧徽标尚未实现。

## 会话记录

右侧「思源活动」显示当前会话的实际调用：时间、核心、具体端点、callId、operationId、解析出的文档或块 ID、耗时与结果。可过滤当前页、分页和刷新，核心选择与记录由宿主持久化。

操作意图先持久化，再派发业务请求；不保存笔记正文或凭据。成功、失败、拒绝、已发送与结果不确定分别显示。通知和 WS 发送完成不等于内容效果已确认；网络中断后的写入不自动重发。已执行但结算记录失败时，工具结果明确提示勿重复写入。重载打断的运行记录标为结果不确定。

只有本机明确目标的资源 ID 才提供 `siyuan://blocks/...` 快速打开；远程核心只显示 ID，避免在本机打开另一个库的同名资源。没有解析出位置时如实显示未知，不推断完整影响范围。

## 五个工具

| 工具 | action / channel | 用途 |
| --- | --- | --- |
| `siyuan_query` | notebooks、docs、search、sql、read、children | 笔记本、文档、全文搜索、SQL、块内容与子块 |
| `siyuan_create` | doc、block、append | 创建 Markdown 文档、插块、追加 |
| `siyuan_update` | block、rename_doc | 整块替换、改文档标题 |
| `siyuan_delete` | block、doc | 删除块或文档 |
| `siyuan_rpc` | http、contract、plugin、mcp、ws、connection | 通用连接操作与离线契约发现 |

每个工具可附带 `kernelId`。`contract` 可离线发现契约和配置核心 ID，不连接内核，也不获得执行授权。示例中的 ID 需要替换为真实目标。

```json
{"action":"notebooks","kernelId":"local"}
{"action":"docs","notebook":"20261011180000-abcdefg","limit":64,"offset":0}
{"action":"read","id":"20261011180001-abcdefg"}
{"action":"doc","notebook":"20261011180000-abcdefg","path":"/验收","markdown":"# 验收\n"}
{"action":"append","parentID":"20261011180001-abcdefg","data":"正文\n"}
{"action":"block","id":"20261011180002-abcdefg","data":"替换内容\n"}
{"action":"rename_doc","id":"20261011180001-abcdefg","title":"新标题"}
```

创建文档返回 `docId`，插块、追加和更新返回 `blockIds`。内容空白保留，更新接受空字符串。插块至少需要 `nextID`、`previousID` 或 `parentID`；追加需要 `parentID`。CRUD 检查 HTTP 与内核 `{code,msg,data}` 信封，索引或同步可能稍后更新，不因查询暂时无结果重发写入。

```json
{"channel":"contract","path":"/api/block/","limit":20,"includeSchema":true}
{"channel":"http","path":"/api/block/getBlockKramdown","method":"POST","body":{"id":"20261011180001-abcdefg"},"validate":true}
{"channel":"plugin","plugin":"my-plugin","method":"example.echo","params":{"text":"你好"}}
{"channel":"mcp","method":"tools/list"}
{"channel":"mcp","method":"tools/call","params":{"name":"实际发现的工具名","arguments":{}}}
{"channel":"ws","path":"/ws?app=my-app&id=my-session&type=main","messages":[],"durationMs":1000,"maxMessages":20}
{"channel":"connection","action":"status"}
```

HTTP 支持 JSON、text、base64、form、multipart 请求与文件上传，保留状态、响应头和信封，默认响应上限16MiB。`validate` 仅校验已知契约；未收录路径需先声明并授权。MCP 使用官方 SDK 1.32.1，协议上限2025-11-25。每个调用结束后释放临时 WS、RPC、MCP 连接。

## 公共服务与独立连接库

共享服务 `siyuan` 只提供经过授权和凭据投影的 `invoke(toolName, arguments, execution?)`：

```js
export const inject = ["siyuan"];
export async function apply(ctx) {
  const service = ctx.get("siyuan");
  const result = await service.invoke("siyuan_query", { action: "notebooks", kernelId: "local" });
  // 公共服务调用也需要端点授权；无 agent 时「每次批准」拒绝执行。
}
```

`execution` 来自真实 DSH 工具执行上下文，用于关联会话、callId、取消与批准；模型工具不接收自填会话身份。公共服务不发布带 token 的 config、裸 HTTP/WS/RPC、SDK client 或流。

`import { SiYuanConnection } from "dsh-plugin-siyuan/connection"` 仍可用于独立传输库：完整 HTTP、WS、JSON-RPC、MCP 和流由调用者管理，最终 `await connection.dispose()`。独立库的权限策略和原始响应过滤由调用者负责；需要宿主端点授权与凭据过滤时，使用共享受控服务。

## 安装与开发

需要 Node.js >=22.19.0，包管理器 pnpm。宿主安装补丁不包含 token：

```yaml
- id: dsh-plugin-siyuan
  name: dsh-plugin-siyuan
  config:
    apiUrl: auto
    timeoutMs: 15000
```

本次新增客户端出口 `./client` 和 `dsh.client` 声明。构建将官方思源 SVG 嵌入客户端，与宿主 JS、类型声明、契约一起放入 `lib/`。安装和正在运行的 DSH 界面验收由人工进行；源码检查通过不代表已安装或运行界面已更新。

```sh
pnpm install
pnpm run check
node scripts/gen-contract.mjs /path/to/siyuan/kernel/apicontract/schema.json 3.8.6
```

`test:behavior` 运行 22 项独立行为测试，`test:protocol` 运行 25 项协议与工具行为测试；后者使用隔离 HTTP/WS/MCP 夹具，凭据过滤只使用测试字符串，不读取实际 token。测试不手写模拟 Harness 上下文或宿主服务，详细范围和未验证的集成事项见 [测试说明](./tests/README.md)。`release:pack` 可执行全部检查并生成包，当前未生成 0.2.0 发布包。代码可从 [main 分支](https://github.com/leolee9086/dsh-plugin-siyuan/tree/main) 获取；[v0.1.3](https://github.com/leolee9086/dsh-plugin-siyuan/tree/v0.1.3) 不包含本次授权功能。

## 许可证与来源

Copyright (c) 2026 leolee9086。GNU AGPL 第 3 版或任何后续版本，`AGPL-3.0-or-later`，条款见 [LICENSE](./LICENSE)。接口契约源自 [SiYuan v3.8.6](https://github.com/siyuan-note/siyuan/tree/v3.8.6) 的 `kernel/apicontract/schema.json`，由 [生成脚本](./scripts/gen-contract.mjs) 提取转换。官方图标从思源 `app/stage/icon.svg` 原样复制，来源和版权见 [NOTICE](./NOTICE)。
