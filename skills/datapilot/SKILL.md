---
name: datapilot
description: 把当前 session 干不完/不该干的长任务委派给 DataPilot 后台跑——一次性分析/渲染、批量并发、定时或事件驱动的 automation 都能搞。典型触发场景：用户说"后台跑"、"委派给另一个 agent"、"批量处理一堆 item"、"定时任务 / 事件触发"、"跑完给我分享链接"、"不想占着当前会话"；或显式提到 dtpilot / DataPilot / session / batch / automation 这些原语。通过 `dtpilot` CLI（npm 包 `dtpilot`）操作远程 DataPilot server，本机无需是 DataPilot runtime。
allowed-tools: Bash, Read
---

# 调用 DataPilot

在**其他项目**里把 DataPilot 当作"专业工人"用：当前 agent 通过 `dtpilot` CLI 把任务委派给 DataPilot server，拿回产物继续干自己的事。server 可以在本机也可以远程。

## 三个原语怎么选

- **session** — 一次性对话 / 分析 / 渲染。数据可以直接塞进 prompt，或让 session agent 从激活的 source 拉；产物以消息文本 / HTML / 分享链接回来。**手头只有任务描述的时候起点就在这**。
- **batch** — 同一 action 并发跑到一堆 item 上。`source.path` / `output.path` 指向 server 文件系统；创建新 batch 前数据要已经在 server 可达的路径上（常见做法：先起 session 让 agent 写到 workspace 里）。查看 / 修改 / 重跑已有 batch（`list` / `get` / `items` / `update` / `start` / `pause` / `retry-item`）只需要 id，随时能用。
- **automation** — 事件驱动（定时、标签变化、session 结束等）。`enable` 后脱离 CLI 常驻，配置一次长期生效。

**选 session 还是 batch 的关键看数据在哪**：数据已在 server（原有 source、之前 session 落盘、共享卷；本地文件需 server 同机才看得见，看 `workspace get` 的 `connection.sameMachine`）→ batch 直连；否则 → session 起步让 agent 自己决定要不要内部拉 batch。

## References

- [references/cli.md](references/cli.md) — 实体 / action 语义、字段、枚举、陷阱的权威参考。执行任何 `dtpilot <entity>` 命令前加载。
- [references/connection.md](references/connection.md) — URL / token / TLS / workspace 检测。第一次跑、`CONNECTION_ERROR`、切远程 server、数据看起来空时查。
- [references/task-delegation.md](references/task-delegation.md) — 提交 → 轮询 → 读产物 的三步模型。起任何长任务前读。

## 操作索引

按用户意图对应命令，具体参数加载 [references/cli.md](references/cli.md)：

**Session（一次性对话/任务，含 HTML 渲染等产物输出）**
- 起会话 / 发消息 — `session create` + `session send <id> <message...>`
- 看消息 — `session messages <id>`
- 停止 / 取消 — `session cancel <id>` / `session delete <id>`
- 分享 —— 整段 session：`session share <id>`；单个 HTML 文件：`session share <id> --html <file>`

**Batch（同一 action 并发跑到批量 item）**
- 查看 / 重跑 / 改配置 — `batch list` / `batch get <id>` / `batch items <id>` / `batch update <id>` / `batch retry-item`
- 启停 — `batch start <id>` / `batch pause <id>` / `batch resume <id>`
- 创建（要求数据已在 server 可达的路径上）— `batch create`

**Automation（事件驱动）**
- 建 / 开 / 关 — `automation create` / `automation enable <id>` / `automation disable <id>`
- 手动试跑 — `automation test --input '<json>'`
- 看执行历史 — `automation history <id> [--limit N]`

**Workspace（连接上下文）**
- `workspace list` / `workspace get [<id>]`

**配置类实体** `label` / `source` / `skill` —— CRUD 参考 [references/cli.md](references/cli.md) 末尾。

## 约定

- **输出**：非 TTY 走 JSON envelope `{ok, data | error, warnings}`；`--json` / `--human` 可强制。Exit code `0` 成功、`2` USAGE_ERROR、`1` 其它。完整 error code 表见 [cli.md](references/cli.md#输出-envelope)。
- **默认 workspace**：不传 `--workspace` 就用 `workspaces:get` 第一个。**多 workspace 环境永远显式传 `--workspace <id>`**（见 [connection.md](references/connection.md)）。
- **ID 格式**：workspace id 是 UUID；**session id 是 `YYMMDD-adj-noun` 形式的 slug**（如 `260419-wide-grove`）；**batch id / automation id 是 6 位 hex 短串**（如 `cad987`、`1ed008`）；skill / source / label 用 slug。始终从 `list` / `create` 的 JSON 输出里取 `id`，不支持短前缀。
- **长任务是 fire-and-forget**：`session send` / `batch start` / `automation test` **立刻返回**，不等 agent 跑完。提交后去干别的活，过会儿回来拉结果。详见 [task-delegation.md](references/task-delegation.md)。
- **输入面规则**：flat flag 只做**身份**（`--name`）/ **schema 分支**（`--event` / `--provider` / `--type`）/ **读侧 query**（`--limit` 等）。**数据字段一律走 `--input '<json>'` 或 `--stdin`**。传不认识的 flag 会直接报 `USAGE_ERROR` 并指向对应 JSON key。详见 [cli.md 通用约定](references/cli.md#通用约定)。
- **create 只传用户明确要求的字段**：不知道的不要硬编码，交给 server 默认值。
- **Session 默认 `permissionMode: "allow-all"`**：agent 会自动执行读/写/工具调用不问——agent-to-agent 委派场景合理（主控本来就没法一条条批），但生产 / 共享 server 想防守就显式 `--input '{"permissionMode":"safe"}'` 或 `"ask"`。

## 典型工作流

**把对话里的任务委派成一个 session**（最常见路径）：
```bash
# 1. 提交（send 立即返回，agent 在 server 后台跑）
ID=$(dtpilot session create --name "分析 Q3 销售" | jq -r .data.id)
dtpilot session send "$ID" "读取 /data/sales.csv 并生成趋势报告"

# 2. 过一阵回来看
while [ "$(dtpilot session get "$ID" | jq -r .data.isProcessing)" = "true" ]; do sleep 2; done

# 3. 读产物（messages 返回整个 session 对象，消息在 .data.messages[]）
dtpilot session messages "$ID" | jq -r '.data.messages[-1].content'

# 可选：让 session 生成的 HTML 报告转成可分享 URL 给上游 agent
dtpilot session share "$ID" --html ./report.html | jq -r '.data.url'
```

**批量任务 — 通过 session 启动**（没有现成 server 数据文件时的常用路径）：
```bash
ID=$(dtpilot session create --name "批量分析 sales" \
  --input '{"enabledSourceSlugs":["sales-db"]}' | jq -r .data.id)
dtpilot session send "$ID" "对 sales 表按 region 做分类统计，每 region 输出 {region, total, avg}。并发处理，完成后以 markdown 表格回复。"
while [ "$(dtpilot session get "$ID" | jq -r .data.isProcessing)" = "true" ]; do sleep 5; done
dtpilot session messages "$ID" | jq -r '.data.messages[-1].content'
```

**直连 batch**（数据已在 server 路径上、或只是改已有 batch 的 prompt 重跑）：
```bash
BATCH=$(dtpilot batch create --input "$(cat batch-config.json)" | jq -r .data.id)
dtpilot batch start "$BATCH"
while :; do
  STATUS=$(dtpilot batch get "$BATCH" | jq -r .data.progress.status)
  case "$STATUS" in completed|failed) break ;; esac
  sleep 10
done
dtpilot batch items "$BATCH" | jq '.data.items[]'    # 每条 item 的 id + state.{status, sessionId, summary}
```

`batch items` 返回的是 item state（`.data.items[].state`），**不是** agent 的回复，也不是 output JSONL 内容本身。需要回复内容：按 `.state.sessionId` 起 `dtpilot session messages <sid>` 读；需要 output JSONL 原文：另起一个 session 去读 `output.path`。

**prompt 里引用 item 字段**用 shell env 语法 `${BATCH_ITEM_<FIELD_UPPER>}`（或 `$BATCH_ITEM_<FIELD_UPPER>`），比如 item 是 `{"id":1,"text":"..."}`，prompt 里写 `${BATCH_ITEM_TEXT}`；写成 `{{text}}` 不会被替换。

**装一个事件驱动的 automation**：
```bash
AID=$(dtpilot automation create --name "xxx" --event "<EventName>" --input "$(cat automation.json)" | jq -r .data.id)
dtpilot automation enable "$AID"
dtpilot automation history "$AID" --limit 20   # 事后查执行
```

## 失败模式快速定位

- `CONNECTION_ERROR` → server 没起 / URL 错 / token 错 → 查 [connection.md](references/connection.md)
- `VALIDATION_ERROR: No workspace available` → `dtpilot workspace list` 确认，显式传 `--workspace <id>`
- `NOT_FOUND: Session/Batch '...' not found` → ID 错或在别的 workspace → 带上正确的 `--workspace`
- `USAGE_ERROR` → 看 `suggestion` 字段，错误消息通常会直接指出正确用法
