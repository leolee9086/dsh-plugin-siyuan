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

宿主集成检查单独验证服务契约及注册接口。目前这部分和真实软件运行尚未验收，范围包括工具与公共服务注册、凭据和持久化接入、审批结果对接、管理路由鉴权、客户端插槽，以及存储失败或审批期间配置变化时的派发行为。
