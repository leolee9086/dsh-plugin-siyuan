# dsh-plugin-siyuan

思源笔记的 DSH 插件：多核心连接配置、逐端点授权、左侧思源入口和右侧会话活动记录，保留恰好五个模型工具。

**0.2.4** 点击会话中的思源工具卡片打开右侧「思源活动」；侧栏「定位工具调用」自动加载来源历史、展开折叠组并跳到对应调用，支持 PTC 子调用。卡片参数与结果可独立展开。保留 0.2.3 的凭据脱敏及历史活动记录修复。

## 连接与凭据

插件加载后，从插件市场附近的思源图标进入主面板。核心连接页支持添加、编辑、停用和删除核心，设置默认核心，检查连接。右侧「思源活动」页可以为当前会话选择核心。调用时的目标顺序为工具参数 `kernelId`、会话选择、明确配置的默认核心；找不到目标或目标失效时拒绝，不挑另一核心。

每个核心可以配置本机 `auto` 或明确的 HTTP(S) 地址、超时、可选端口登记文件与 PID。远程地址支持代理路径前缀，禁止 URL 凭据、查询和片段。自动模式读取思源维护的账户主目录 `.config/siyuan/port.json`，不扫描端口。进入思源连接管理界面、首次工具调用或首次授权时自动检查并绑定唯一实例的 PID；多实例需要人工填写 PID。已绑定实例退出后需要在管理界面重新选择。首次绑定会清除旧版未绑定配置的授权；更换地址、PID 或登记文件也会撤销该核心的旧授权，新的授权在绑定后保存。

API token 只由人工在密码框写入 DSH 的本机 `credentials` 服务，持久配置与活动记录不保存 token 值。凭据的存储与保护由 DSH 负责；本插件负责人工只写、宿主取用及模型输出过滤，不另建凭据存储层。编辑时只显示已配置状态，不回填原值；留空保留，填写新值替换，也可明确清除。工具参数不接受 token 或认证头，宿主向固定核心注入 `Authorization: Token ...`，不转发到重定向地址。

所有核心的已配置凭据共用输出过滤：CRUD、HTTP、插件 RPC、MCP、WS、管理返回和错误都经过安全投影，覆盖原值、JSON 字符串、URL 编码、base64/hex 及含凭据的整体编码响应。过滤依据是凭据服务登记的实际值，字段名不决定是否遮罩，审批数组、token 计数和凭据状态保持原有类型。MCP `tools/call` 的 `content` 与 `prompts/get` 的消息内容中，图片和音频字节只保留说明；`structuredContent` 等业务对象按普通数据处理。错误不转发原始异常对象、stack、cause 或请求配置。过滤作用于本插件的返回接口；本机文件访问和浏览器权限由宿主管理。

DSH 需要提供 `tools`、`storageDomain` 和 `credentials` 服务；两种询问策略使用 `sandboxPolicy` 读取会话模式，并在普通权限下使用 `approval` 请求批准。管理路由通过 `connection.requestRejection` 统一校验来源和身份，兼容 Web 与桌面端；变更请求使用 JSON。持久化或凭据服务不可用时失败关闭，不降级为允许。旧组合里的非空 `token` 在首次初始化时导入 credentials；应由人工清除旧组合中的明文配置，不要将其内容发送到会话。

## 端点授权

端点页提供 697 条来自思源 v3.8.6 的 HTTP 契约，支持按核心、协议、方法、授权状态筛选，搜索路径、方法、工具名和说明，并分页。MCP 工具通过人工点击「发现 MCP 工具」获取，仅进入该核心目录，不获得权限。扩展 HTTP、插件 RPC、MCP 方法和 WS 操作可人工声明入目录。

每个端点可单独设置以下四种权限，并确认具体核心与端点：

| 配置 | 普通权限下 | 完全权限下 |
| --- | --- | --- |
| 每次询问，完全权限下拒绝（默认，`ask`） | 请求宿主批准 | 自动拒绝 |
| 每次询问，完全权限下授权（`ask-full-access`） | 请求宿主批准 | 自动通过 |
| 拒绝（`deny`） | 拒绝 | 拒绝 |
| 允许（`allow`） | 直接通过 | 直接通过 |

未配置、首次发现、重新绑定或声明的新端点默认使用 `ask`。升级保留已经显式保存的 `deny`、`ask` 和 `allow`。完全权限按宿主 `sandboxPolicy` 返回的实际会话模式判断；询问通过 `approval.request()` 请求一次性批准。无会话、无法取得模式或需要询问但审批不可用时停止执行；宿主 `never` 策略自动拒绝询问。批准期间配置改变也会停止派发。活动栏记录选定的端点配置，并区分完全权限自动拒绝、完全权限自动通过、直接允许、宿主批准、拒绝、取消和审批不可用。

授权键分别为：

- HTTP：方法与契约路径；未知路径使用具体路径。四个 CRUD 与同路径的原始 HTTP 共用授权。
- MCP：方法；`tools/call` 还需具体工具名的独立授权。
- 插件 RPC：插件名与方法；批量调用另需 `$batch`，且先检查所有内部方法。
- WS：连接路径的 `connect`，发送操作另需该路径与具体 JSON `cmd` 的 `send` 权限。
- 连接状态：`connection/status`。PID 切换只在人工配置页完成。

原始 HTTP 的 MCP、插件 RPC 和 WS 包裹路径不能代替具体方法授权。代理、事务等尚未解析内部效果的委托接口本阶段不开放。WS 二进制发送和无 `cmd` 的不透明消息不开放。编码或折叠等有歧义的端点路径拒绝执行。

本阶段是端点授权：允许覆盖该端点的全部可操作资源。文档、笔记本、文件路径等资源范围授权，以及内容来源、差异追踪和思源侧徽标尚未实现。

## 会话记录

右侧「思源活动」显示当前会话的实际调用：时间、核心、具体端点、callId、operationId、解析出的文档或块 ID、耗时与结果。可过滤当前页、分页和刷新，核心选择与记录由宿主持久化。点击会话中的思源工具卡片打开右侧「思源活动」，参数与结果通过卡片上的独立按钮展开。侧栏「定位工具调用」切回聊天视图，自动加载目标历史、从外向内展开折叠组，并滚动到精确的工具调用卡片；PTC 子调用会连同根调用一起加载。定位期间显示等待状态；切换会话、发起新定位或卸载会取消旧定位。点击「思源连接管理界面」打开管理面板。

操作意图先持久化，再派发业务请求；不保存笔记正文或凭据。成功、失败、拒绝、已发送与结果不确定分别显示。通知和 WS 发送完成不等于内容效果已确认；网络中断后的写入不自动重发。已执行但结算记录失败时，工具结果明确提示勿重复写入。重载打断的运行记录标为结果不确定。旧版将审批明细错误替换为 `[redacted]` 的活动记录在加载时恢复为可读取结构，并标明明细已丢失；原调用结果和已有错误说明保留。

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

创建文档返回 `docId`，插块、追加和更新返回 `blockIds`，并以 `blockIdScope: "transaction-operations"` 标明这些是内核事务操作 ID。一段 Markdown 可生成多个块而只返回一个操作 ID；ID 数量不是写入块数。写入成功与否依据内核响应。内容空白保留，更新接受空字符串。插块至少需要 `nextID`、`previousID` 或 `parentID`；追加需要 `parentID`。CRUD 检查 HTTP 与内核 `{code,msg,data}` 信封，索引或同步可能稍后更新，不因查询暂时无结果重发写入。

```json
{"channel":"contract","path":"/api/block/","limit":20,"includeSchema":true}
{"channel":"http","path":"/api/block/getBlockKramdown","method":"POST","body":{"id":"20261011180001-abcdefg"},"validate":true}
{"channel":"plugin","plugin":"my-plugin","method":"example.echo","params":{"text":"你好"}}
{"channel":"mcp","method":"tools/list"}
{"channel":"mcp","method":"tools/call","params":{"name":"实际发现的工具名","arguments":{}}}
{"channel":"ws","path":"/ws?app=my-app&id=my-session&type=main","messages":[],"durationMs":1000,"maxMessages":20}
{"channel":"connection","action":"status"}
```

HTTP 支持 JSON、text、base64、form、multipart 请求与文件上传，保留状态、响应头和信封，默认响应上限16MiB。`validate` 仅校验已知契约；未收录路径按具体方法与路径请求批准，也可在管理界面声明后设置权限。MCP 使用官方 SDK 1.32.1，协议上限2025-11-25。每个调用结束后释放临时 WS、RPC、MCP 连接。

## 公共服务与独立连接库

共享服务 `siyuan` 只提供经过授权和凭据投影的 `invoke(toolName, arguments, execution?)`：

```js
export const inject = ["siyuan"];
export async function apply(ctx) {
  const service = ctx.get("siyuan");
  const result = await service.invoke("siyuan_query", { action: "notebooks", kernelId: "local" });
  // 公共服务调用也需要端点授权；无 agent 时两种询问策略均拒绝执行。
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

在 DSH 插件市场中使用以下 GitHub 来源安装或升级：

```text
https://github.com/leolee9086/dsh-plugin-siyuan#v0.2.4
```

客户端通过 `./client` 和 `dsh.client` 声明加载。构建将官方思源 SVG 嵌入客户端，与宿主 JS、类型声明、契约一起放入 `lib/`。

```sh
pnpm install
pnpm run check
node scripts/gen-contract.mjs /path/to/siyuan/kernel/apicontract/schema.json 3.8.6
```

`test:behavior` 运行 37 项独立行为测试，`test:protocol` 运行 25 项协议与工具行为测试；后者使用隔离 HTTP/WS/MCP 夹具。详细范围见 [测试说明](./tests/README.md)。`release:pack` 执行检查并生成安装包；开发代码见 [main 分支](https://github.com/leolee9086/dsh-plugin-siyuan/tree/main)。

## 许可证与来源

Copyright (c) 2026 leolee9086。GNU AGPL 第 3 版或任何后续版本，`AGPL-3.0-or-later`，条款见 [LICENSE](./LICENSE)。接口契约源自 [SiYuan v3.8.6](https://github.com/siyuan-note/siyuan/tree/v3.8.6) 的 `kernel/apicontract/schema.json`，由 [生成脚本](./scripts/gen-contract.mjs) 提取转换。官方图标从思源 `app/stage/icon.svg` 原样复制，来源和版权见 [NOTICE](./NOTICE)。
