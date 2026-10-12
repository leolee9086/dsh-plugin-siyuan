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
- `secrets.test.mjs`：输出与错误的凭据过滤。
- `client-ui.test.mjs`：React 静态渲染，通过 props 提供表单、端点和活动数据。

## 协议和工具行为

根目录测试使用本地隔离的 HTTP、WS、JSON-RPC 与 MCP 协议服务，检验连接库与五个工具的数据行为。

## 宿主接口集成

宿主集成检查单独验证服务契约及注册接口。v0.2.1 已在真实桌面应用中验证连接管理、端点配置、读取和追加项目笔记，以及将宿主审批从 never 切换为 ask 后的批准派发。v0.2.2 的自动连接、右栏定位与反馈需安装后验证交互；组件测试使用真实 React 静态渲染。工具、凭据、存储和插槽接入不使用手写宿主上下文替身。
