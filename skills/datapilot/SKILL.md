---
name: datapilot
description: 把当前 session 干不完或不适合干的长任务委派给 DataPilot 后台执行——一次性分析/渲染、批量并发、定时或事件驱动的 automation 均可处理。典型触发场景：用户说"后台跑"、"委派给另一个 agent"、"批量处理一堆 item"、"定时任务 / 事件触发"、"跑完给我分享链接"、"不想占着当前会话"；或显式提到 datapilot / DataPilot / session / batch / automation 这些概念。通过 `datapilot` CLI（npm 包 `datapilot`）操作远程 DataPilot server，本机无需是 DataPilot runtime。
allowed-tools: Bash, Read
---

# 调用 DataPilot

在**其他项目**里把 DataPilot 当作"专业工人"用：当前 agent 通过 `datapilot` CLI 把任务委派给 DataPilot server，获取产物后继续自己的工作。server 可以在本机也可以远程。

## 选择任务类型

- **session** — 一次性对话 / 分析 / 渲染。数据可以直接写在 prompt 中，或让 session agent 从已启用的 source 获取；产物以消息文本、HTML 或分享链接返回。**只有任务描述而没有现成数据文件时，从这里开始**。
- **batch** — 同一 action 并发执行到一批 item 上。`source.path` / `output.path` 指向 server 文件系统；创建新 batch 前数据必须已在 server 可达的路径上（常见做法：先起 session 让 agent 写到 workspace 里）。查看 / 修改 / 重跑已有 batch（`list` / `get` / `items` / `update` / `start` / `pause` / `retry-item`）只需要 id，随时可用。
- **automation** — 事件驱动（定时、标签变化、session 结束等）。`enable` 后在 server 端常驻运行，配置一次长期生效。

**选 session 还是 batch 取决于数据位置**：数据已在 server 上（已有 source、之前 session 写入的产物、共享卷；本地文件需 server 同机才可见，通过 `workspace get` 的 `connection.sameMachine` 判断）→ 可以直接用 batch；否则 → 先起 session，让 agent 决定是否内部启动 batch。

## References

- [references/cli.md](references/cli.md) — 实体 / action 语义、字段、枚举、易错点的权威参考。执行任何 `datapilot <entity>` 命令前加载。
- [references/connection.md](references/connection.md) — URL / token / TLS / workspace 检测。第一次运行、遇到 `CONNECTION_ERROR`、切换远程 server、数据看起来为空时查阅。
- [references/task-delegation.md](references/task-delegation.md) — 提交 → 轮询 → 读取产物的三步模型。启动任何长任务前阅读。

## 操作索引

按用户意图对应命令，具体参数见 [references/cli.md](references/cli.md)：

**Session（一次性对话/任务，含 HTML 渲染等产物输出）**
- 创建会话 / 发消息 — `session create` + `session send <id> <message...>`
- 查看消息 — `session messages <id>`
- 停止 / 取消 — `session cancel <id>` / `session delete <id>`
- 分享 —— 整段 session：`session share <id>`；单个 HTML 文件：`session share <id> --html <file>`

**Batch（同一 action 并发执行到批量 item）**
- 查看 / 重跑 / 改配置 — `batch list` / `batch get <id>` / `batch items <id>` / `batch update <id>` / `batch retry-item`
- 启停 — `batch start <id>` / `batch pause <id>` / `batch resume <id>`
- 创建（要求数据已在 server 可达的路径上）— `batch create`

**Automation（事件驱动）**
- 创建 / 启用 / 停用 — `automation create` / `automation enable <id>` / `automation disable <id>`
- 手动试运行 — `automation test --input '<json>'`
- 查看执行历史 — `automation history <id> [--limit N]`

**Workspace（连接上下文）**
- `workspace list` / `workspace get [<id>]`

**配置类实体** `label` / `source` / `skill` —— CRUD 参考 [references/cli.md](references/cli.md) 末尾。

## 约定

- **输出**：非 TTY 环境输出 JSON envelope `{ok, data | error, warnings}`；`--json` / `--human` 可强制指定格式。Exit code `0` 成功、`2` USAGE_ERROR、`1` 其它。完整 error code 表见 [cli.md](references/cli.md#输出-envelope)。
- **默认 workspace**：`--workspace` flag 或 `$DATAPILOT_WORKSPACE` 环境变量都接受 id / slug / name，二者都未设置时回落到 `workspaces:get` 返回的第一个。多 workspace 环境不要依赖默认顺序，应显式指定。
- **ID 格式**：workspace id 是 UUID；**session id 是 `YYMMDD-adj-noun` 形式的 slug**（如 `260419-wide-grove`）；**batch id / automation id 是 6 位 hex 短串**（如 `cad987`、`1ed008`）；skill / source / label 用 slug。始终从 `list` / `create` 的 JSON 输出里取 `id`，不支持短前缀。
- **长任务提交即返回**：`session send` / `batch start` / `automation test` **立刻返回**，不等 agent 执行完毕。提交后可以做其他事，稍后轮询结果。详见 [task-delegation.md](references/task-delegation.md)。
- **参数传入规则**：普通 flag 只用于**身份标识**（`--name`）/ **子类型选择**（`--event` / `--provider` / `--type`）/ **查询参数**（`--limit` 等）。**数据字段一律通过 `--input '<json>'` 或 `--stdin` 传入**。传入不支持的 flag 会报 `USAGE_ERROR` 并提示对应的 JSON key。详见 [cli.md 通用约定](references/cli.md#通用约定)。
- **create 只传用户明确要求的字段**：不确定的字段不要硬编码，交给 server 默认值。
- **Session 默认 `permissionMode: "allow-all"`**：agent 会自动执行读/写/工具调用而不询问——agent-to-agent 委派场景下合理（委派方无法逐条审批），但在生产或共享 server 上想限制权限时，应显式传入 `--input '{"permissionMode":"safe"}'` 或 `"ask"`。

## 典型工作流

**把对话里的任务委派为一个 session**（最常见路径）：
```bash
# 1. 提交（send 立即返回，agent 在 server 后台执行）
ID=$(datapilot session create --name "分析 Q3 销售" | jq -r .data.id)
datapilot session send "$ID" "读取 /data/sales.csv 并生成趋势报告"

# 2. 等待完成
while [ "$(datapilot session get "$ID" | jq -r .data.isProcessing)" = "true" ]; do sleep 2; done

# 3. 读取产物（messages 返回整个 session 对象，消息在 .data.messages[]）
datapilot session messages "$ID" | jq -r '.data.messages[-1].content'

# 可选：将 session 生成的 HTML 报告上传为可分享 URL
datapilot session share "$ID" --html ./report.html | jq -r '.data.url'
```

**批量任务 — 通过 session 启动**（没有现成 server 数据文件时的常用路径）：
```bash
ID=$(datapilot session create --name "批量分析 sales" \
  --input '{"enabledSourceSlugs":["sales-db"]}' | jq -r .data.id)
datapilot session send "$ID" "对 sales 表按 region 做分类统计，每 region 输出 {region, total, avg}。并发处理，完成后以 markdown 表格回复。"
while [ "$(datapilot session get "$ID" | jq -r .data.isProcessing)" = "true" ]; do sleep 5; done
datapilot session messages "$ID" | jq -r '.data.messages[-1].content'
```

**直接使用 batch**（数据已在 server 路径上，或修改已有 batch 的 prompt 重跑）：
```bash
BATCH=$(datapilot batch create --input "$(cat batch-config.json)" | jq -r .data.id)
datapilot batch start "$BATCH"
while :; do
  STATUS=$(datapilot batch get "$BATCH" | jq -r .data.progress.status)
  case "$STATUS" in completed|failed) break ;; esac
  sleep 10
done
datapilot batch items "$BATCH" | jq '.data.items[]'    # 每条 item 的 id + state.{status, sessionId, summary}
```

`batch items` 返回的是 item 状态（`.data.items[].state`），**不是** agent 的回复，也不是 output JSONL 的原文。需要回复内容：按 `.state.sessionId` 调用 `datapilot session messages <sid>` 读取；需要 output JSONL 原文：另起一个 session 去读取 `output.path`。

**prompt 中引用 item 字段**用 shell env 语法 `${BATCH_ITEM_<FIELD_UPPER>}`（或 `$BATCH_ITEM_<FIELD_UPPER>`），例如 item 是 `{"id":1,"text":"..."}`，prompt 中写 `${BATCH_ITEM_TEXT}`；写成 `{{text}}` 不会被替换。

**创建事件驱动的 automation**：
```bash
AID=$(datapilot automation create --name "xxx" --event "<EventName>" --input "$(cat automation.json)" | jq -r .data.id)
datapilot automation enable "$AID"
datapilot automation history "$AID" --limit 20   # 查看执行历史
```

## 失败模式快速定位

- `CONNECTION_ERROR` → server 未启动 / URL 错误 / token 错误 → 查阅 [connection.md](references/connection.md)
- `VALIDATION_ERROR: No workspace available` → `datapilot workspace list` 确认，显式传 `--workspace <id|slug|name>` 或设置 `DATAPILOT_WORKSPACE`
- `NOT_FOUND: Session/Batch '...' not found` → ID 错误或属于其他 workspace → 检查 `--workspace` / `$DATAPILOT_WORKSPACE`
- `USAGE_ERROR` → 查看 `suggestion` 字段，错误消息通常会直接指出正确用法
