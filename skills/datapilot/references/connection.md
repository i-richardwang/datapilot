---
name: datapilot-connection
description: DataPilot server 连接模型：URL / token / TLS / discovery 文件 / workspace 自动检测。第一次在新机器上运行、遇到 CONNECTION_ERROR、切换远程 server、数据看起来为空时查阅。
---

# 连接模型

`datapilot` CLI 是 **thin client**，通过 WebSocket 连接到一个**已经在运行**的 DataPilot server。CLI 不启动也不管理 server 进程 —— 连接失败时返回 `CONNECTION_ERROR`。

**server 来源**：
- **本机**：打开 DataPilot Electron app，app 内部自动启动 headless server 并写入 discovery 文件
- **远程**：由运维 / 管理员部署好（容器、systemd 等），提供 URL + token

两种场景的连接方式相同。

## URL 解析顺序

按优先级匹配，使用第一个命中项：

1. `--url <ws-url>` flag
2. `$DATAPILOT_SERVER_URL`
3. Discovery 文件 `~/.datapilot/.server.endpoint`（Electron app 启动 server 时写入）
4. 默认 `ws://127.0.0.1:9100`

## Token 解析顺序

与 URL 相同的优先级：

1. `--token <secret>` flag
2. `$DATAPILOT_SERVER_TOKEN`
3. Discovery 文件中的 `token` 字段
4. 无 token

本地 Electron app 启动的 server 默认不强制 token（但开启后必须携带）；**远程部署通常都要求 token**。

## TLS（自签名证书）

`--tls-ca <path>` 或 `$DATAPILOT_TLS_CA` 指向 CA 证书文件。生产环境使用 `wss://` + 有效证书时无需配置。

## Discovery 文件

位置：`~/.datapilot/.server.endpoint`（权限 `0o600`）

JSON 格式：
```json
{ "url": "ws://127.0.0.1:9100", "token": "...", "pid": 12345, "startedAt": 1234567890 }
```

- 由 DataPilot Electron app / headless server 启动时写入
- server 正常退出时自动清理

**注意**：手动 `kill` server 后 discovery 文件可能残留过期的 URL/PID —— 删除 `~/.datapilot/.server.endpoint` 即可恢复。

## Workspace 解析顺序

按优先级匹配，使用第一个命中项：

1. `--workspace <id|slug|name>` flag
2. `$DATAPILOT_WORKSPACE` 环境变量（同样接受 id / slug / name）
3. `workspaces:get` 返回的**第一个**（顺序由 server 决定，不一定是预期的那个）
4. 列表为空 → 报 `VALIDATION_ERROR: No workspace available`

flag 和环境变量都不必是 UUID：server 按 `id` / `slug` / `name` 任一匹配解析。匹配不到时字面值原样发给后续 RPC，通常在第一个需要 workspace 的请求上报 `NOT_FOUND`。

获取标识符：`datapilot workspace list | jq -r '.data[] | {id, slug, name}'`

## 远程 server 场景（最常见的 agent-to-agent 场景）

```bash
export DATAPILOT_SERVER_URL=wss://datapilot.example.com
export DATAPILOT_SERVER_TOKEN=<token>
datapilot workspace list    # 确认连通
```

自签名证书场景额外设置 `export DATAPILOT_TLS_CA=/path/to/ca.crt`。

## CONNECTION_ERROR 排查清单

按顺序检查：

1. **URL 来源是否正确**：按上面的解析顺序推演 —— `--url` / `$DATAPILOT_SERVER_URL` / discovery 文件 / 默认值。
2. **目标 server 是否在运行**：
   - 本机：Electron app 是否已打开？`lsof -i :9100` 查看端口是否有进程监听
   - 远程：`curl -I <url 转 http>` 测试 TCP / TLS 是否可通
3. **Token 是否正确**：token 不匹配时 server 在 WebSocket 握手阶段拒绝连接，表现也是 CONNECTION_ERROR —— 尝试显式 `--token` 重试。
4. **自签名证书**：添加 `--tls-ca`。

## 数据异常 / 看起来为空的排查

- **空列表通常是 workspace 指向错误**：`datapilot workspace list` 查看全部 workspace，添加 `--workspace <id|slug|name>` 重试，或检查 `echo $DATAPILOT_WORKSPACE` 是否为预期值。
- **session/batch `NOT_FOUND`**：ID 属于其他 workspace，携带正确的 `--workspace`，或确认 `DATAPILOT_WORKSPACE` 未指向错误的 workspace。
