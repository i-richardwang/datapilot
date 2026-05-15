---
name: datapilot-task-delegation
description: 把 session / batch / automation 任务委派给 DataPilot 的三步模型：提交立即返回 → 轮询状态 → 读取产物。启动任何长任务前阅读。
---

# 任务委派模型

**把任务委派给 DataPilot 的模型分三步**：

1. **提交** —— 命令立刻返回一个 ID，任务在 server 后台执行
2. **轮询** —— 定期检查状态，直到完成
3. **读取产物** —— 从对应的 get / items / history 命令中获取结果

Master Agent 提交后即可处理其他工作。CLI 中**没有** `--wait` / `--follow` / 阻塞式 API，也不提供实时推送订阅 —— 这是有意为之，agent-to-agent 委派场景不应让主控 agent 阻塞等待。使用轮询。

## 选择任务类型

| 任务形态 | 类型 | 备注 |
|---|---|---|
| 一次性分析 / 渲染 / 对话 | `session` | 数据可由 prompt 传入或由 session agent 自行从 source 获取 |
| 同一 action 并发到批量 item | `batch` | 输入 / 输出都是 server 文件路径；创建 batch 前数据需已在可达路径 |
| 事件触发（定时、标签变化、session 结束等） | `automation` | `enable` 后常驻运行 |

**session 与 batch 的选择取决于数据位置**。`batch.source.path` / `batch.output.path` 都是 server 文件系统路径，`batch items` 返回的也是 item 状态而非 output JSONL 的原文。因此：数据已在 server（已有 source、之前 session 写入的产物、共享挂载）→ 可以直接用 `batch`；只有本地数据或纯任务描述 → 起 session，让 agent 决定是否内部启动 batch、是否需要先写入文件。

修改已有 batch 的 prompt / 并发度、启停、查状态、查看 item 结果都只需 id，与数据是否在本地无关。

## 三阶段生命周期

```
① 提交 (submit, 立即返回)  →  ② 轮询状态  →  ③ 读取产物
```

三种类型的映射：

| 阶段 | session | batch | automation |
|---|---|---|---|
| ① 提交 | `session create` + `session send` | `batch create` + `batch start` | `automation create` + `automation enable`（事件驱动后续自动执行）<br/>或 `automation test`（手动触发一次） |
| ② 查状态 | `session get <id>` 的 `.data.isProcessing`（布尔值） | `batch get <id>` 的 `.data.progress.status`（枚举） | `automation history <id> --limit N` 获取最近执行条目 |
| ③ 读取产物 | `session messages <id>` 的 `.data.messages[-1].content`<br/>+ `session share <id> --html <file>` | `batch items <id>` 的 `.data.items[]`（每条 item 的状态；agent 的实际回复需按 `.state.sessionId` 通过 `session messages` 读取）| `automation history <id>` 中对应条目 |

## 轮询方式

```bash
# session
datapilot session send "$SID" "执行的 prompt"
while [ "$(datapilot session get "$SID" | jq -r .data.isProcessing)" = "true" ]; do
  sleep 2
done
datapilot session messages "$SID" | jq -r '.data.messages[-1].content'

# batch
datapilot batch start "$BID"
while :; do
  STATUS=$(datapilot batch get "$BID" | jq -r .data.progress.status)
  case "$STATUS" in completed|failed) break ;; esac
  sleep 10
done
datapilot batch items "$BID" | jq '.data.items[]'
```

**轮询间隔建议**：

| 任务类型 | 预期耗时 | 建议间隔 |
|---|---|---|
| 简单 session（无工具，纯 LLM 回答） | 秒级 | 2s |
| 复杂 session（带 source / 工具调用） | 十秒到几分钟 | 5-10s |
| batch（几十到几千 item） | 分钟到小时 | 30-60s |

不要每 100ms 轮询一次，浪费带宽且不会加快执行。

## 终止状态识别

| 类型 | 终止信号 | 判断字段 |
|---|---|---|
| session turn | agent 回复完成 | `session.isProcessing === false` |
| batch | 执行完毕（成功或失败） | `batch.progress.status ∈ {completed, failed}` |
| automation 单次执行 | history 条目写入 | `automation history <id>` 最新条目 |

**注意**：
- `batch.progress.status = paused` 不是终止状态，是 `resume` 之前的中间状态
- batch 没有 `cancelled` 状态 —— 要中断用 `batch pause` 或 `batch delete`
- Automation 本身是常驻的，没有"整体完成" —— 只有"某次触发执行完成"

## 取消 / 中断

| 类型 | 命令 | 效果 |
|---|---|---|
| session | `session cancel <id>` | 中断当前 turn，session 保留可续 |
| session | `session delete <id>` | 彻底删除 session |
| batch | `batch pause <id>` | 暂停，可 `resume` |
| batch | `batch delete <id>` | 彻底删除 batch |
| automation | `automation disable <id>` | 停止响应新事件，配置和历史保留 |

## 产物读取

### Session
```bash
# 最终回复文本（messages 返回整个 session 对象，消息在 .data.messages[]）
datapilot session messages "$SID" | jq -r '.data.messages[-1].content'
# 整段 session 的只读分享链接
datapilot session share "$SID" | jq -r '.data.url'
# 上传单个 HTML 文件获取分享链接（供上游 agent 使用）
datapilot session share "$SID" --html ./report.html | jq -r '.data.url'
```

### Batch
```bash
# 所有 item 的状态（id + state.{status, sessionId, summary, ...}）
datapilot batch items "$BID" | jq '.data.items[] | {id, status: .state.status, sessionId: .state.sessionId, summary: .state.summary, error: .state.error}'

# 筛选失败项（state.status 可选值：pending/running/completed/failed/skipped）
datapilot batch items "$BID" | jq '.data.items[] | select(.state.status=="failed")'

# agent 的实际回复不在 items 中，需按 sessionId 到 session 读取
datapilot batch items "$BID" | jq -r '.data.items[].state.sessionId' | while read SID; do
  echo "=== $SID ==="
  datapilot session messages "$SID" | jq -r '.data.messages[-1].content'
done
```

### Automation
```bash
datapilot automation history "$AID" --limit 50 | jq '.data[]'
```

## 关键要点

1. **提交动作立即返回** —— 拿到 ID 即可继续其他工作，不要阻塞等待。
2. **Session 完成信号是 `isProcessing === false`** —— 轮询 `session get` 即可。
3. **Batch 的详细结果在 `items`，不在 `get`** —— `batch get` 返回整体进度，`items` 提供每条 item 的结果。
4. **`session messages` 返回的是整个 session 对象**，消息在 `.data.messages[]`，不是直接数组。
