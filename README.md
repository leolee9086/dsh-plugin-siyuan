# dsh-plugin-siyuan

思源笔记的 DSH 插件：检索笔记、创建与修改内容，多核心连接配置、逐端点授权和会话活动记录。提供五个基础工具，并可将 697 条 HTTP 契约按用途整理为 663 个工具，与发现的 MCP 工具一起注册到工具箱，按会话选择开启。

**0.3.3** 常规 HTTP 扩展工具收到标准 `{code,msg,data}` JSON 响应时，成功直接返回 `data`，失败返回 `isError`、HTTP `status`、内核 `code`、`msg` 和 `data`。文件、代理、SSE、直接 JSON 等特殊接口保持各自的原始响应；通用 `siyuan_rpc` 继续提供完整 HTTP 结果。

**0.3.2** 修复 `.well-known` 等路径分组的 ID 含非法字符而导致整批注册失败的问题，分组标题保留原始路径名称。HTTP 工具按路径末段命名，例如 `siyuan_sql`、`siyuan_getBlockInfo`；父路径用于分组，只有重名时才进入工具名。同路径、同处理函数的多种方法合并，优先 POST；不同用途的处理函数分别保留。工具名移除摘要 ID 与 HTTP 方法前缀。升级后需在工具箱重新开启新名字及分组，已有思源端点授权保持不变。

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

## 思源 callout 规则提醒

详细步骤见 [规则编写教程](./docs/规则编写教程.md)：从创建原生 callout、编写触发条件，到正则与路径、优先级与互斥、去重、插件扩展和排错。

思源可向公共 `reminderRules` 服务贡献规则。当前由 context-care 的已有 `/requests` Host 行提供服务；思源通过可选注入连接，两个插件没有直接包依赖。没有该服务时，思源工具继续独立工作。

使用专属 callout 标记 `[!DSH-REMINDER]`，内部放一个 `dsh-rule` 代码块，其余正文就是提醒内容。标记归属公共提醒服务，其他插件的规则使用各自标记；单独出现 `dsh-rule` 不会注册为提醒。下面的声明在成功读取 `.ts` 或 `.d.ts` 后，于下一次自然模型请求前提醒：

````markdown
> [!DSH-REMINDER] TypeScript 类型约定
>
> 禁止使用 `any`。类型暂不明确时使用 `unknown`，再缩小类型范围。
>
> ```dsh-rule
> format: reminder/v1
> id: typescript-no-any
> on: tool.succeeded
> when:
>   tool: read
>   arguments:
>     file_path:
>       regex: '\.ts$'
>       flags: i
> deliver:
>   model:
>     once: surface
> ```
````

规则可以放在任意文档中，无需配置文档或块 ID。插件在现有已启用核心中自动执行以下检索，一次读取全部匹配块，并按会话现有的核心选择贡献规则。显式 `LIMIT -1` 避开思源在省略 LIMIT 时采用的默认返回条数：

```sql
SELECT id,root_id,type,subtype,markdown FROM blocks
WHERE type='callout' AND subtype='DSH-REMINDER'
ORDER BY id LIMIT -1
```

连接建立和重连时全量校准；平时按 WebSocket 通知刷新相关文档，空闲时不读 SQL。`reminders.refreshMs` 默认30秒，用于失败读取和容量候选重试。规则数量默认不限；在“会话规则 → 提醒容量”中可保存所有来源共用的总量上限（0表示不限），查看已注册数量及最近拒绝来源的数量和原因。设置持久保留；降低上限保留已有规则，只限制后续增长。超限更新保留该来源上一批已接受的规则，提高上限后在下次重试时直接注册已缓存候选，不重复读取和解析。示例 [TypeScript 类型约定](siyuan://blocks/20261013174959-h1vn4ci) 已通过真实内核回读确认自定义 subtype。

提醒来源通过管理器的内部专用能力订阅推送并读取固定范围的提醒块，沿用已启用核心、实例绑定、凭据和配置生命周期；不需要为这些内部请求设置模型端点授权。模型工具和公共 `invoke` 调用仍执行原有逐端点审批。管理器每核心共享一条只读推送连接，断线后按1、2、4秒递增至30秒重连。每批读取前等待事务和索引队列完成；事务按 `context.rootIDs` 局部查询并合并快照，已知规则文档的子块编辑和新提醒标记都触发更新。范围不明、同步、移动及笔记本挂卸载做全量校准，无关状态通知不读取。扫描期间的新事件保留到下一批。未变块复用解析和校验结果，包括错误结果；一个坏块只暂停自己的规则。离线立即撤销来源，恢复后全量校准；读取或连接失败记入插件日志。

同一提醒仍在模型可见上下文时只投递一次；追加普通消息、再次读取文件或只修改正文都不会重复。提醒被压缩移除后，新读取事件可以再次触发。身份包含核心、块 ID 和规则 ID，移动到其他文档不改变身份。正文和标题可以修改，`id` 用于保持身份，省略时为 `reminder`。YAML 使用 1.2，拒绝重复键和 aliases，规则字段由服务统一校验。

`when.condition` 可以追加引擎 v2 条件树，读取插件分析器产出的 `facts.<ref>`；`judge` 可以引用插件注册的异步判定器。笔记中声明条件和引用，分析器/判定器的代码由插件注册。

## 会话记录

右侧「思源活动」显示当前会话的实际调用：时间、核心、具体端点、callId、operationId、解析出的文档或块 ID、耗时与结果。可过滤当前页、分页和刷新，核心选择与记录由宿主持久化。点击会话中的思源工具卡片打开右侧「思源活动」，参数与结果通过卡片上的独立按钮展开。侧栏「定位工具调用」切回聊天视图，自动加载目标历史、从外向内展开折叠组，并滚动到精确的工具调用卡片；PTC 子调用会连同根调用一起加载。定位期间显示等待状态；切换会话、发起新定位或卸载会取消旧定位。点击「思源连接管理界面」打开管理面板。

操作意图先持久化，再派发业务请求；不保存笔记正文或凭据。成功、失败、拒绝、已发送与结果不确定分别显示。通知和 WS 发送完成不等于内容效果已确认；网络中断后的写入不自动重发。已执行但结算记录失败时，工具结果明确提示勿重复写入。重载打断的运行记录标为结果不确定。旧版将审批明细错误替换为 `[redacted]` 的活动记录在加载时恢复为可读取结构，并标明明细已丢失；原调用结果和已有错误说明保留。

只有本机明确目标的资源 ID 才提供 `siyuan://blocks/...` 快速打开；远程核心只显示 ID，避免在本机打开另一个库的同名资源。没有解析出位置时如实显示未知，不推断完整影响范围。

## 工具箱协同

安装 [dsh-tool-gateway v0.3.0 或更新版](https://github.com/leolee9086/dsh-tool-gateway)，在思源管理界面点击「注册全部 HTTP / MCP 工具」。管理界面显示可注册的 HTTP 工具数、MCP 工具数和实际注册数；HTTP 按父路径分为「思源 · block」「思源 · notebook」「思源 · query」等组，MCP 按核心分组。新组默认关闭，到右侧工具箱选择要在当前会话开启的工具或工具组。

工具箱开关决定当前会话能否使用工具；思源端点授权决定具体核心是否允许执行。注册与开启都不会自动授予端点权限。MCP 调用仍分别检查 `tools/call` 与具体工具名。697 条 HTTP 契约按路径与处理函数合并为 663 个工具：同用途方法优先 POST，其次 GET；`rpc` 等不同处理函数分别保留。其他方法仍可通过基础工具 `siyuan_rpc` 调用，执行原有端点授权与调用限制。

- HTTP 工具以 `siyuan_` 加路径末段命名，例如 `siyuan_sql`；重名才增加父路径，例如 `siyuan_setting_setSnippet` 和 `siyuan_snippet_setSnippet`。动态路径及同路径的不同用途用处理函数名区分。说明保留实际方法与完整路径，可按接口路径搜索。参数 `body` 使用原始请求 schema 及完整 `$defs`，支持 `query`、动态路由的 `pathParams` 和业务 `headers`。`kernelId` 可显式指定核心，省略时使用会话选择或默认核心。
- MCP 工具直接使用发现的完整 `inputSchema`，参数就是该工具的原参数，固定调用发现它的核心。名称为 `siyuan_mcp_<核心ID>_<工具名>`，使不同核心的同名工具可区分；旧版目录缺少 schema 的记录会提示重新发现。
- 新目录注册后，重新发现 MCP 会新增、更新或撤回对应工具。核心改名更新组标题，更换地址或删除核心会撤回该核心的 MCP 目录。注册选择保存到本机，重启后自动恢复；网关卸载时撤回扩展工具，重新连接后恢复。
- 「撤回扩展工具」撤回 HTTP / MCP 注册并保存这一选择，五个基础工具继续可用。网关缺席时也可使用基础工具。

例如，搜索 `/api/query/sql` 的 HTTP 工具后，参数为：

```json
{"body":{"stmt":"SELECT id, content FROM blocks WHERE type = 'd' LIMIT 10"},"kernelId":"local"}
```

HTTP 原始字节请求的 `body` 使用 base64。表单文件的名称填入 `body` 的对应契约字段，内容放入 `files`；`/api/file/putFile` 示例：

```json
{"body":{"path":"/data/example.txt","file":"example.txt"},"files":[{"field":"file","name":"example.txt","base64":"aGk=","mimeType":"text/plain"}]}
```

工具名保持稳定，普通授权修改和再次同步不会重建未变化的工具，也不会覆盖工具箱保存的会话开关。HTTP / MCP 扩展调用同样在「思源活动」中记录实际生成工具名，可通过 callId 定位来源调用。

## 五个基础工具

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
https://github.com/leolee9086/dsh-plugin-siyuan#v0.3.3
```

客户端通过 `./client` 和 `dsh.client` 声明加载。构建将官方思源 SVG 嵌入客户端，与宿主 JS、类型声明、契约一起放入 `lib/`。

```sh
pnpm install
pnpm run check
node scripts/gen-contract.mjs /path/to/siyuan/kernel/apicontract/schema.json 3.8.6
```

`test:behavior` 运行 43 项独立行为测试，`test:protocol` 运行 26 项协议与工具行为测试；后者使用隔离 HTTP/WS/MCP 夹具，覆盖扩展工具从注册、授权到实际调用和活动记录的完整链路。详细范围见 [测试说明](./tests/README.md)。`release:pack` 执行检查并生成安装包；开发代码见 [main 分支](https://github.com/leolee9086/dsh-plugin-siyuan/tree/main)。

## 许可证与来源

Copyright (c) 2026 leolee9086。GNU AGPL 第 3 版或任何后续版本，`AGPL-3.0-or-later`，条款见 [LICENSE](./LICENSE)。接口契约源自 [SiYuan v3.8.6](https://github.com/siyuan-note/siyuan/tree/v3.8.6) 的 `kernel/apicontract/schema.json`，由 [生成脚本](./scripts/gen-contract.mjs) 提取转换。官方图标从思源 `app/stage/icon.svg` 原样复制，来源和版权见 [NOTICE](./NOTICE)。
