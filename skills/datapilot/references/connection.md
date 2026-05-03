---
name: datapilot-connection
description: DataPilot server 连接模型：URL / token / TLS / discovery 文件 / workspace 自动检测。第一次在新机器上跑、报 CONNECTION_ERROR、切远程 server、数据看起来空时查。
---

# 连接模型

`dtpilot` CLI 是 **thin client**，通过 WebSocket 连到一个**已经在跑**的 DataPilot server。CLI 自己不启动也不管理 server 进程 —— 连不上就返 `CONNECTION_ERROR`。

**server 从哪里来**：
- **本机**：打开 DataPilot Electron app，app 内部自动起 headless server 并写 discovery 文件
- **远程**：由运维 / 管理员起好（容器、systemd 等），给你 URL + token

连接方式两种场景一致。

## URL 解析顺序

命中即停，不回退：

1. `--url <ws-url>` flag
2. `$DATAPILOT_SERVER_URL`
3. Discovery 文件 `~/.datapilot/.server.endpoint`（Electron app 启动 server 时写入）
4. 默认 `ws://127.0.0.1:9100`

## Token 解析顺序

镜像 URL 的优先级：

1. `--token <secret>` flag
2. `$DATAPILOT_SERVER_TOKEN`
3. Discovery 文件里的 `token` 字段
4. 空（无 token）

本地 Electron app 起的 server 默认不强制 token（但开启后必须带）；**远程部署基本都要求 token**。

## TLS（自签名证书）

`--tls-ca <path>` 或 `$DATAPILOT_TLS_CA` 指向 CA 证书文件。生产 `wss://` + 有效证书的话不用管。

## Discovery 文件

位置：`~/.datapilot/.server.endpoint`（权限 `0o600`）

JSON 格式：
```json
{ "url": "ws://127.0.0.1:9100", "token": "...", "pid": 12345, "startedAt": 1234567890 }
```

- 由 DataPilot Electron app / headless server 启动时写入
- server 正常退出会清理

**陷阱**：手动 `kill` 了 server，discovery 文件可能残留旧 URL/PID —— 删 `~/.datapilot/.server.endpoint` 一次性复位。

## Workspace 自动检测

不传 `--workspace <id>` 时：

1. 调 `workspaces:get` 拿列表
2. 取**第一个** workspace 的 `id`
3. 把后续命令的作用域绑到该 workspace
4. 列表为空 → 报 `VALIDATION_ERROR: No workspace available`

"第一个"的顺序由 server 决定，不一定是你想的那个。**agent 自动化调用里永远显式 `--workspace <id>`**。

获取 ID：`dtpilot workspace list | jq -r '.data[] | {id, slug, name}'`

## 远程 server 场景（最常见的 agent-to-agent 场景）

```bash
export DATAPILOT_SERVER_URL=wss://datapilot.example.com
export DATAPILOT_SERVER_TOKEN=<token>
dtpilot workspace list    # 确认连通
```

自签名证书场景多加 `export DATAPILOT_TLS_CA=/path/to/ca.crt`。

## CONNECTION_ERROR 排查清单

按顺序查：

1. **URL 来源对不对**：按上面的解析顺序推演 —— `--url` / `$DATAPILOT_SERVER_URL` / discovery 文件 / 默认。
2. **目标 server 真的在跑吗**：
   - 本机：Electron app 是否开着？`lsof -i :9100` 看端口有没有进程
   - 远程：`curl -I <url 转 http>` 看 TCP / TLS 能不能通
3. **Token 对不对**：token 不匹配时 server 在 WebSocket 握手阶段拒连，表现也是 CONNECTION_ERROR —— 显式 `--token` 重试。
4. **自签名证书**：加 `--tls-ca`。

## 数据不对 / 看起来空的排查

- **空列表多半是 workspace 绑错**：`dtpilot workspace list` 看全部，加 `--workspace <id>` 重试。
- **session/batch `NOT_FOUND`**：ID 在别的 workspace 下，带正确的 `--workspace`。
