# Redash MCP Per-User 认证说明

本文档说明 `redash-mcp-peruser` 中 per-user Redash API Key 的使用方式，重点面向 RakAgent / GoClaw 这类以 HTTP 方式接入 MCP 的平台。

## 结论

在 RakAgent 的 streamable HTTP 部署中，Redash MCP 不使用全局共享的 `REDASH_API_KEY`。

每次 MCP 请求都应该由 RakAgent 按当前用户注入请求头：

```text
Authorization: Key <user_redash_api_key>
```

MCP 服务端只在当前请求上下文中读取这个 header，并用它访问 Redash。这样不同用户访问 Redash 时使用各自的 Redash API Key，权限边界由 Redash 自身控制。

## 适用场景

适用：

- RakAgent / GoClaw 以 streamable HTTP 方式注册 MCP server。
- 平台需要按当前登录用户访问 Redash。
- 管理员在 RakAgent 后台为少量 TenantUser 绑定个人 Redash API Key。
- 不希望在 MCP 服务容器里保存共享 Redash API Key。

不适用：

- 本地单用户 stdio 使用。
- Claude Desktop 这类直接以本地进程方式启动 MCP，且只需要一个固定 Redash Key 的场景。

本地 stdio / 单用户场景仍可使用 `REDASH_API_KEY` 环境变量作为共享 key。

## RakAgent 配置方式

在 RakAgent 管理员页面注册 Redash MCP：

```json
{
  "mcpServers": {
    "redash-mcp": {
      "url": "http://172.16.22.87:5001/mcp"
    }
  }
}
```

然后开启：

```text
Require User Credentials
```

在 MCP Servers 管理页面点击 key 图标，为每个用户配置 Headers：

```text
Header: Authorization
Value: Key <user_redash_api_key>
```

不要使用 RakAgent 的普通 `api_key` 字段，除非目标服务刚好接受 `Authorization: Bearer <api_key>`。Redash API 需要的是：

```text
Authorization: Key <redash_api_key>
```

因此这里应使用 per-user Headers，而不是 `api_key` 字段。

## GoClaw 中的 user 口径

GoClaw / RakAgent 的 per-user MCP credentials 应绑定到租户内用户标识：

```text
TenantUser.user_id
```

不要绑定到以下字段：

```text
tenant_users.id             # TenantUser 的 UUID 主键，不是 MCP credential key
channel_contacts.sender_id  # 渠道物理用户 ID，不建议作为 Redash 凭证长期 key
channel_contacts.id         # ChannelContact 的 UUID，也不是 MCP credential key
```

MCP credentials 的实际存储键可以理解为：

```text
tenant_id + mcp_server_id + user_id
```

其中 `user_id` 是 `tenant_users.user_id` 这个字符串，例如：

```text
han@example.com
john
u_123
```

管理后台的 MCP user credentials 弹窗使用 TenantUser 选择器，默认提交的也是 `user_id` 字符串，不是 TenantUser UUID。

### Channel 用户前置条件

来自 Telegram、微信、钉钉、Teams 等 Channel 的外部用户，初始身份通常只是 `ChannelContact`：

```text
ChannelContact.sender_id = <外部平台用户 ID>
```

这类用户需要先 merge 到租户内的 TenantUser，才能稳定命中管理员绑定的 Redash MCP credentials：

```text
ChannelContact(sender_id=12345)
  -> merge 到
TenantUser(user_id=han@example.com)
  -> 管理员给 han@example.com 绑定 Redash API Key
```

如果 ChannelContact 没有 merge 到 TenantUser，那么用户发起对话时可能无法命中 `TenantUser.user_id` 下的 MCP credentials。表现通常是：

- 该 MCP server 设置了 `Require User Credentials`，但当前用户看不到相关工具。
- 或工具调用阶段返回缺少凭证、无效凭证、401、403 等错误。

本方案建议统一采用：

```text
Redash per-user credentials 只绑定 TenantUser.user_id。
ChannelContact 必须先 merge 到 TenantUser。
不为裸 channel sender_id 单独维护 Redash 凭证。
```

这样同一个人跨 Web UI、Telegram、微信、钉钉等入口时，可以复用同一份 Redash API Key，权限和 GoClaw 的 RBAC、memory、context files 也保持同一个用户口径。

## 服务端环境变量

streamable HTTP per-user 部署中，推荐只保留非用户级配置：

```env
REDASH_URL=https://redash.example.com
REDASH_TIMEOUT=30000
REDASH_MAX_RESULTS=1000
MCP_TRANSPORT=streamable-http
HOST=0.0.0.0
PORT=8000
MCP_PATH=/mcp
```

不应配置：

```env
REDASH_API_KEY=...
SERVICE_TOKEN=...
CREDENTIAL_SERVICE_URL=...
CREDENTIAL_SERVICE_TIMEOUT=...
```

说明：

- `REDASH_API_KEY` 是 stdio / 本地共享 key 模式使用的 fallback。
- streamable HTTP per-user 模式下，Redash key 来自每次请求的 `Authorization` header。
- `SERVICE_TOKEN` / `CREDENTIAL_SERVICE_*` 属于旧的 simple-credential 方案，本方案不再使用。

## 代码实现位置

核心实现位于：

- `src/index.ts`
- `src/redashClient.ts`

请求入口逻辑：

1. `src/index.ts` 启动 streamable HTTP server。
2. 每个 `POST /mcp` 请求都会读取 `authorization` header。
3. 请求处理被包在 `withRedashAuthorization(authorization, ...)` 中。
4. `src/redashClient.ts` 使用 `AsyncLocalStorage` 保存当前请求的 Authorization。
5. 真正调用 Redash API 时，从当前请求上下文解析 Redash API Key。
6. 每个请求都会创建基于当前用户 key 的 `RedashClient`。

关键格式校验：

```text
Authorization: Key <redash_api_key>
```

缺少 header 时返回：

```json
{
  "error": "NO_API_KEY",
  "service": "redash",
  "message": "Missing Authorization: Key <redash_api_key> header for Redash MCP request"
}
```

header 格式不是 `Key ...` 时返回：

```json
{
  "error": "INVALID_AUTH_HEADER",
  "service": "redash",
  "message": "Redash MCP expects Authorization: Key <redash_api_key>"
}
```

## 请求隔离方式

本实现使用 Node.js `AsyncLocalStorage` 保存请求级上下文。

这意味着：

- A 用户请求中的 Redash API Key 只在 A 用户当前 MCP 请求链路内可见。
- B 用户请求会有独立上下文。
- 不依赖全局变量保存当前用户 key。
- 不需要额外 credential service。

注意：如果没有请求上下文，代码会回退到 `REDASH_API_KEY`。这个 fallback 是为了兼容 stdio / 本地单用户模式。生产 HTTP per-user 部署不要设置 `REDASH_API_KEY`，这样可以避免误用共享 key。

## 验证方式

以下命令以远端部署在 `rakagent` 为例。

### 健康检查

```bash
ssh rakagent 'curl -fsS http://127.0.0.1:5001/healthz && printf "\n"'
```

预期：

```text
{"status":"ok"}
```

### MCP 初始化

```bash
ssh rakagent 'curl -fsS -X POST http://127.0.0.1:5001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"clientInfo\":{\"name\":\"check\",\"version\":\"1.0\"}}}"'
```

预期：返回 `serverInfo.name = redash-mcp`。

### 缺少 Authorization 的负向测试

```bash
ssh rakagent 'curl -fsS -X POST http://127.0.0.1:5001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"list_queries\",\"arguments\":{\"page\":1,\"pageSize\":1}}}"'
```

预期：工具错误中包含 `NO_API_KEY`。

### 错误 Authorization scheme 的负向测试

```bash
ssh rakagent 'curl -fsS -X POST http://127.0.0.1:5001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer fake-token" \
  --data "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"list_queries\",\"arguments\":{\"page\":1,\"pageSize\":1}}}"'
```

预期：工具错误中包含 `INVALID_AUTH_HEADER`。

### 假 Redash Key 的负向测试

```bash
ssh rakagent 'curl -fsS -X POST http://127.0.0.1:5001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Key fake-redash-key-for-negative-test" \
  --data "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"list_queries\",\"arguments\":{\"page\":1,\"pageSize\":1}}}"'
```

预期：进入 Redash API 调用后失败。这个失败是合理的，因为 fake key 不应该能访问 Redash。关键判断点是：错误不应是 `NO_API_KEY` 或 `INVALID_AUTH_HEADER`。

### 容器环境变量安全检查

```bash
ssh rakagent 'docker inspect redash-mcp --format "{{range .Config.Env}}{{println .}}{{end}}" | grep -E "REDASH_API_KEY|SERVICE_TOKEN|CREDENTIAL_SERVICE" || true'
```

预期：无输出。

## 用户侧提示策略

普通用户不需要知道 MCP、header、Authorization 或 Redash API 调用细节。

如果 Redash 工具不可用，或调用返回 `NO_API_KEY` / `INVALID_AUTH_HEADER` / 401 / 403 / invalid key，应在智能体提示词层面统一处理为：

```text
当前账号还没有绑定 Redash 访问凭证，或绑定的凭证已失效。请联系管理员为你的账号绑定或刷新 Redash API Key。
```

如果用户来自 Channel，管理员还需要确认该 ChannelContact 已经 merge 到正确的 TenantUser，并且凭证绑定在该 TenantUser 的 `user_id` 上。

不要让普通用户直接在对话中发送 API Key。

## 与 simple-credential 方案的区别

旧方案：

- MCP 根据用户标识调用 simple-credential。
- simple-credential 返回该用户的 Redash API Key。
- MCP 再用该 key 请求 Redash。
- 需要维护额外服务、`SERVICE_TOKEN`、credential service URL 和授权链路。

当前方案：

- RakAgent 已有 per-user MCP credentials 机制。
- 管理员直接在 RakAgent 为用户配置 header。
- MCP 只读取当前请求 header。
- 不需要新增普通用户入口。
- 不需要 simple-credential。
- 不需要修改 RakAgent 社区代码。

## 部署原则

生产 streamable HTTP per-user 模式应满足：

- `MCP_TRANSPORT=streamable-http`
- MCP endpoint 使用 `/mcp`
- 保留 `REDASH_URL`
- 不设置共享 `REDASH_API_KEY`
- 不设置 simple-credential 相关环境变量
- RakAgent 开启 `Require User Credentials`
- per-user header 使用 `Authorization: Key <user_redash_api_key>`
- 凭证绑定对象使用 `TenantUser.user_id`
- Channel 用户先 merge 到 TenantUser，再配置 MCP per-user credentials

## Frank 部署入口

Frank 相关的部署文件集中维护在 `frank/` 目录：

```text
frank/Dockerfile
frank/docker-compose.yaml
frank/Makefile
```

本地构建并启动：

```bash
cd frank
make up-build
```

查看本地容器状态：

```bash
cd frank
make ps
```

同步源码到远端并重建：

```bash
cd frank
make remote up-build
```

查看远端容器状态：

```bash
cd frank
make remote ps
```

默认远端参数：

```text
REMOTE_HOST=rakagent
REMOTE_DIR=/opt/ai/redash-mcp
```

可以通过命令行覆盖：

```bash
cd frank
make REMOTE_HOST=rakagent REMOTE_DIR=/opt/ai/redash-mcp remote up-build
```
