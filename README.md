# dsh-plugin-siyuan

思源笔记的完整连接层，以及第一批五个 DeepSeek Harness 工具。HTTP、WebSocket、思源插件 JSON-RPC 和思源自身 MCP 共用同一套地址、鉴权和生命周期。

697 条来自思源 v3.8.6 的接口契约用于发现和可选校验。原始转发也接受资源、上传、插件私有路径、WebDAV 等未收录路径；接口权限仍由思源内核决定。

## 许可证与源码

Copyright (c) 2026 leolee9086。本项目以 GNU Affero General Public License 第 3 版或任何后续版本（`AGPL-3.0-or-later`）发布，可依该许可证使用、修改和再分发，不提供任何担保。完整条款见 [LICENSE](./LICENSE)。

v0.1.3 将此前 v0.1.2 的 AGPL-3.0-only 声明修正为 AGPL-3.0-or-later，与思源源码的授权声明一致；此前 v0.1.1 的 MIT 声明不适用于本版本。源码、构建脚本和锁文件随安装包提供，也可从 [本版本源码](https://github.com/leolee9086/dsh-plugin-siyuan/tree/v0.1.3) 获取。

接口契约由 [SiYuan v3.8.6](https://github.com/siyuan-note/siyuan/tree/v3.8.6) 的 `kernel/apicontract/schema.json` 生成，版权归原作者及贡献者所有。上游 [kernel/main.go 的授权声明](https://github.com/siyuan-note/siyuan/blob/v3.8.6/kernel/main.go#L4-L7) 明确允许 GNU AGPL 第 3 版或任何后续版本。插件对该契约进行字段提取和格式转换；生成脚本见 [scripts/gen-contract.mjs](./scripts/gen-contract.mjs)。后续复用思源实现时，保留所复用文件的版权、许可证及来源声明，并注明修改。

## 安装与配置

需要 Node.js >=22.19.0。包内包含已构建的入口、声明和生成契约，安装不需要思源源码。

在 DSH 官方插件管理器的包来源中填写固定版本地址：

```text
https://github.com/leolee9086/dsh-plugin-siyuan#v0.1.3
```

也可填写 `github:leolee9086/dsh-plugin-siyuan#v0.1.3`。标签内包含已构建的 `lib/`，安装方不需要编译插件或运行测试。非桌面 profile 可使用 `dsh plugin --profile <name> add "github:leolee9086/dsh-plugin-siyuan#v0.1.3"`；桌面版通过官方插件管理器操作，安装后按其提示重载或重启。

本地安装也可在包来源填写 `dsh-plugin-siyuan-0.1.3.tgz` 的完整绝对路径。包通过 `dsh.bundle.patch` 声明安装补丁，并向宿主组合添加以下行。正常桌面安装无需修改源码或填写动态端口：

```yaml
- id: dsh-plugin-siyuan
  name: dsh-plugin-siyuan
  config:
    apiUrl: auto
    token: ""
    timeoutMs: 15000
```

`apiUrl` 省略或设为 `auto` 时，读取思源自己维护的 PID→端口登记，过滤已退出进程，并通过不带 token 的版本接口确认候选。只有一个有效实例时自动连接。思源未启动时插件仍能加载，网络调用会提示启动思源；契约发现不需要内核在线。登记文件只读，不清理思源的历史记录，也不扫描其他端口。

| 桌面平台 | 默认端口登记文件 |
| --- | --- |
| Windows | 账户主目录下的 `.config\siyuan\port.json`，通常为 `C:\Users\<账户>\.config\siyuan\port.json` |
| macOS | `~/.config/siyuan/port.json`，通常为 `/Users/<账户>/.config/siyuan/port.json` |
| Linux | `~/.config/siyuan/port.json`，通常为 `/home/<账户>/.config/siyuan/port.json` |

路径依据是思源的 `util.HomeDir = gulu.OS.Home()` 和 `rewritePortJSON`。Home 优先取操作系统账户主目录；macOS 也使用 `.config`，Linux 不使用 `XDG_CONFIG_HOME`。可选 `portFile` 可指定可读取的登记文件绝对路径；DSH 和思源需要处于同一主机与可见的进程/网络环境。移动端需要主动配置地址。

每次新的 HTTP 调用、WS、插件 RPC 或 MCP 会话都会重新读取登记，自动适应内核重启后的端口变化；业务请求发送后不会自动重试。已建立的 WS、隧道和 MCP 会话继续绑定原目标，包括 MCP 的 DELETE 清理，内核退出时由调用方新建连接。

多个有效实例时不会随便选一个。先用 `siyuan_rpc` 查看并选择（`pid` 换成状态中返回的实际 PID）：

```json
{"channel":"connection","action":"status"}
{"channel":"connection","action":"select","pid":12345}
```

选择作用于当前插件连接实例的后续调用，插件重载后需重新选择；可用配置 `kernelPid` 固定本次运行的 PID。选中 PID 退出后会明确报错，不切到其他实例；重启后用状态和选择重新指定。

远程、Docker 或反向代理部署可显式设置 `apiUrl` 为 HTTP(S) 地址，支持路径前缀。显式地址优先，跳过本机发现及 `portFile/kernelPid`；地址不能带用户名、密码、查询或片段。使用0.1.0配置升级时若仍保留明确地址，需要在配置入口改为 `auto` 或删去该字段，不需要修改源码。

`token` 在思源设置中查看后自行填入；连接发送 `Authorization: Token <token>`。MCP 要求管理员权限。空 token 不添加鉴权头，能否访问由内核决定。不要把凭据提交到仓库或贴到会话。

`timeoutMs` 默认 15000，必须为正整数。普通请求的期限覆盖响应体；写请求不会自动重试。长期 WS、MCP session 和 CONNECT 隧道由持有者管理，插件卸载时释放。连接服务允许显式 `timeoutMs: 0` 管理长流。

插件同时发布宿主服务 `siyuan`，并注册恰好五个工具。服务提供者应装到宿主组合。如果一个预设确实只在该会话内使用它，需要把提供者与消费者放入同一组、设置 `isolate: { siyuan: true }`，避免会话间的服务注册冲突。

## 五个工具

| 工具 | action / channel | 用途 |
| --- | --- | --- |
| `siyuan_query` | notebooks、docs、search、sql、read、children | 列笔记本、查文档和块、全文搜索、SQL 查询 |
| `siyuan_create` | doc、block、append | 创建 Markdown 文档、插块、追加子块 |
| `siyuan_update` | block、rename_doc | 整块替换内容、改文档标题 |
| `siyuan_delete` | block、doc | 按 ID 删除块或文档 |
| `siyuan_rpc` | http、contract、plugin、mcp、ws、connection | 使用完整连接能力，查看与选择本机实例 |

下面对象是对应工具的参数。ID 示例需换成实际目标 ID。

```json
{"action":"notebooks"}
{"action":"docs","notebook":"20261011180000-abcdefg","limit":64,"offset":0}
{"action":"search","query":"连接层","page":1,"pageSize":20}
{"action":"read","id":"20261011180001-abcdefg"}
```

创建文档返回 `docId`；插块、追加和更新返回 `blockIds`。内容字符串保留原文空白，更新也接受空字符串。

```json
{"action":"doc","notebook":"20261011180000-abcdefg","path":"/连接层验收","markdown":"# 验收\n\n"}
{"action":"append","parentID":"20261011180001-abcdefg","data":"正文\n","dataType":"markdown"}
{"action":"block","id":"20261011180002-abcdefg","data":"替换内容\n","dataType":"markdown"}
{"action":"rename_doc","id":"20261011180001-abcdefg","title":"新的标题"}
{"action":"doc","id":"20261011180001-abcdefg"}
```

`create.block` 至少提供 `nextID`、`previousID`、`parentID` 中一个锚点；`append` 需要 `parentID`。`dataType` 支持 `markdown`、`dom`。`update.block` 替换整块，先读取要保留的内容。`query.docs` 默认最多64条，用 `limit/offset` 分页。删除会影响真实存储，核对目标 ID 后调用。

CRUD 自动检查内核 `{code,msg,data}` 信封，HTTP 或非零 code 会报错。code=0 表示该调用成功，全文索引、WS 事件和同步可能稍后才更新；不要因查询暂时无结果而重发写请求。

## 通用 RPC 样例

### 原始 HTTP

```json
{"channel":"http","path":"/api/notebook/lsNotebooks","method":"POST","body":{}}
{"channel":"http","path":"/api/block/getBlockKramdown","method":"POST","body":{"id":"20261011180001-abcdefg"},"validate":true}
{"channel":"http","path":"/assets/example.png","method":"GET","responseEncoding":"base64"}
```

`method` 默认 POST；HTTP 连接服务的 `request` 默认 GET。`bodyType` 默认 json，另支持 text、base64、form、multipart。表单字段是字符串或字符串数组；文件通过 `files` 提供字节，必须指定 multipart：

```json
{"channel":"http","path":"/api/asset/upload","bodyType":"multipart","body":{"id":"20261011180001-abcdefg"},"files":[{"field":"file[]","name":"sample.bin","base64":"AP8=","mimeType":"application/octet-stream"}],"validate":true}
```

HTTP 结果含 `status/statusText/headers/encoding/size/body`，保留非2xx和内核信封，调用方根据实际接口判定结果。`responseEncoding` 支持 auto、json、text、base64；auto 按 Content-Type 选择。原始字节用 base64，空响应体是 null。工具默认最多读取16MiB，可提高 `maxBytes`；超限报错，不截断。大文件或长期响应可以通过服务直接读取流。

`headers` 可补充请求头；有配置 token 时，Authorization 使用配置值。重定向返回原始3xx，由调用方决定下一步。`validate` 默认 false；设为 true 仅对匹配到的契约进行校验，不拒绝未收录路径。连接可发送标准及扩展 HTTP 方法，包括 Fetch 不支持的 TRACE/CONNECT 和带请求体的 GET/HEAD；服务端可能拒绝其不支持的方法。CONNECT 返回收到的字节流，双向隧道用服务的 `openTunnel`。

### 契约发现

```json
{"channel":"contract","path":"/api/asset/","method":"POST","limit":20,"offset":0,"includeSchema":true}
```

`path` 按子串过滤，`method` 精确过滤，默认最多返回50条。结果含版本、过滤后总条数和端点；`includeSchema` 提供可独立消费的请求 Schema 与引用定义。

### 思源插件 JSON-RPC

```json
{"channel":"plugin","plugin":"my-plugin","method":"example.echo","params":{"text":"你好"},"transport":"http"}
{"channel":"plugin","plugin":"my-plugin","method":"example.notify","params":{"text":"通知"},"notification":true,"transport":"ws"}
{"channel":"plugin","plugin":"my-plugin","calls":[{"method":"example.echo","params":[1]},{"method":"example.notify","notification":true}],"transport":"http"}
```

`plugin` 可省略，分别调用 `/api/plugin/rpc` 或 `/ws/plugin/rpc`；指定时追加编码后的插件名。方法需由目标思源插件实际注册。单次请求返回 result；批量返回带 ID 的响应，包括逐项 error；通知返回 sent，表示传输发送完成。JSON-RPC error 保留 code/data。服务端通知不当成调用响应，长期双向通知用原始 WS 服务消费。

### 思源自身 MCP

```json
{"channel":"mcp","method":"tools/list","timeoutMs":15000}
{"channel":"mcp","method":"tools/call","params":{"name":"实际发现的工具名","arguments":{}}}
{"channel":"mcp","method":"resources/list"}
```

使用官方 SDK 握手、协商协议和管理会话；每个工具调用结束后清理会话。需要持续使用的 SDK 客户端通过服务 `mcp.open()` 获取。SDK 1.32.1 最高支持 2025-11-25，思源 v3.8.6 源码保留旧协议兼容入口；使用协商结果，不宣称 SDK 支持 2026-07-28 的全部新能力。现代协议或不支持的 SDK 扩展仍可通过原始 HTTP/WS 入口按内核协议调用。

### 原始 WebSocket

```json
{"channel":"ws","path":"/ws?app=my-app&id=my-session&type=main","messages":[],"durationMs":1000,"maxMessages":20}
{"channel":"ws","path":"/ws/plugin/rpc/my-plugin","messages":["{\"jsonrpc\":\"2.0\",\"method\":\"example.notify\"}"],"durationMs":1000,"maxMessages":20}
```

在最长收集时间或消息条数到达时返回并关闭该连接。文本保持 UTF-8 字符串，二进制帧以 base64 返回；发送二进制用 `messages:[{"base64":"AP8="}]`。持久监听和双向交互使用服务 `ws.open()`。WS 工具以 durationMs 控制收集窗口。

## 插件间使用连接服务

```js
export const inject = ['siyuan']
export function apply(ctx) {
  const connection = ctx.get('siyuan')
  // 原始 HTTP：保留 Response、下载流、状态与响应头。
  // const response = await connection.http.request('/assets/example.png')
  // const socket = await connection.ws.open('/ws?app=my-app&id=my-session')
  // const result = await connection.rpc.request('example.echo', {}, { plugin: 'my-plugin' })
  // const session = await connection.mcp.open()
  // 使用完毕 await session.close()，socket 用 close()/terminate()。
}
```

也可 `import { SiYuanConnection } from 'dsh-plugin-siyuan/connection'` 独立创建连接；持有者最后应 `await connection.dispose()`。`connection.discovery.status()` / `select(pid)` 与工具使用相同实例；普通 HTTP 使用 `request(path)`，需要绝对 URL 时用异步 `resolveUrl(path)`，会话消费者用 `bindFetch()` 得到固定目标的 `url(path)` / `fetch()`。同步 `url(path)` 只组合已解析的地址，不刷新登记。配置 token 的服务返回原始响应，工具文本对已知配置 token 做遮罩。

## 开发与验收

```sh
pnpm install
pnpm run release:pack
node scripts/gen-contract.mjs /path/to/siyuan/kernel/apicontract/schema.json 3.8.6
```

构建生成 JavaScript、声明与契约；`release:pack` 先执行构建和全部测试，再打包到 `releases/`。GitHub 标签包含构建产物，包不设置 `prepare`、`prepack` 或安装生命周期脚本。本地协议验收使用真实 HTTP/WS/MCP 传输及隔离夹具，覆盖全部697条契约、动态路由、上传下载、二进制、流、错误、取消、卸载、五工具全部动作和通道。

真实内核只读检查：`node scripts/live-smoke.mjs` 默认自动发现，也可传 `<apiUrl>` 或设置 `SIYUAN_API_URL` 使用明确地址。脚本检查发现、HTTP版本、笔记本查询、WS和MCP，失败时以非零状态退出；可自行设置环境变量 `SIYUAN_TOKEN`，脚本不会读取配置凭据文件，也不输出凭据或笔记内容。这与 DSH 实际安装校验是两个检查阶段；安装后确认五工具出现，再在专门的验收文档上操作。
