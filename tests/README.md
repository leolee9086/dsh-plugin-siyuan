# 测试

运行 `pnpm run check` 构建项目并依次执行两组测试，也可在构建后单独运行下列命令。

| 命令 | 范围 |
| --- | --- |
| `pnpm run test:behavior` | 端点策略、状态规则、请求输入、凭据过滤和组件静态展示 |
| `pnpm run test:protocol` | 连接库与五个工具的 HTTP、WS、JSON-RPC 和 MCP 行为 |

## 独立行为测试

`behavior/` 直接调用生产代码的领域入口。

- `policy.test.mjs`：端点识别、逐项授权、包裹调用拒绝、过滤和分页；HTTP 使用离线契约查询。
- `control-state.test.mjs`：核心选择、换绑撤权、发现目录更新、重载恢复、配置校验和过期配置拒绝。
- `management-input.test.mjs`：内容类型、字节流 JSON、大小限制和查询校验。
- `secrets.test.mjs`：跨核心凭据与编码形式遮罩、敏感词业务字段的类型保留、MCP 媒体位置与业务对象区分。
- `client-ui.test.mjs`：真实 React 静态渲染；活动经过凭据过滤、持久化解析、返回投影和 JSON 传输后保留审批，旧版错误脱敏记录可读且注明明细丢失。
- `client-navigation.test.mjs`：真实 React 与 jsdom 验证卡片点击、参数展开和定位反馈；通过领域参数注入历史加载，验证补载历史、PTC 根与子调用、原生展开事件、换会话和卸载取消。jsdom 无布局引擎，几何读数单独提供，实际滚动由安装后的软件验收。

- `gateway-publication.test.mjs`：697 条 HTTP 契约按用途合并为 663 个工具、路径末段命名与父路径分组、重名区分、同用途优先 POST、不同处理函数保留、请求映射、常规 HTTP 成功只返回 data、HTTP 与内核失败状态、特殊响应及结算警告保留、MCP 原始 schema、同名跨核心区分、增删改同步、核心改名、默认关闭组、撤回顺序、旧工具失效与管理组件展示。

## 协议和工具行为

根目录测试使用本地隔离的 HTTP、WS、JSON-RPC 与 MCP 协议服务，检验连接库与基础工具的数据行为。`gateway.test.mjs` 从 `KernelManager` 的存储和凭据端口注入隔离数据，验证 MCP 发现保存完整 schema、全量发布、端点拒绝不派发、实际 HTTP/MCP 往返、multipart 文件内容、两级 MCP 授权、活动的工具名与 callId，以及网关重连和核心删除。

## 宿主接口集成

宿主集成检查单独验证服务契约及注册接口。v0.2.1 已在真实桌面应用中验证连接管理、端点配置、读取和追加项目笔记，以及将宿主审批从 never 切换为 ask 后的批准派发。v0.2.4 的卡片打开侧栏与历史定位需安装后验证实际交互；组件测试使用真实 React 静态渲染及 jsdom 点击事件。工具、凭据、存储和插槽接入不使用手写宿主上下文替身。
