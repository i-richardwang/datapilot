---
name: datapilot-task-delegation
description: 把 session / batch / automation 任务派给 DataPilot 的三步模型：提交立即返回 → 过段时间轮询状态 → 读产物。起任何长任务前读。
---

# 任务委派模型

**把任务派给 DataPilot 的心智模型就三步**：

1. **提交** —— 命令立刻返回一个 ID，任务在 server 后台跑
2. **过段时间回来看** —— 轮询状态，直到跑完
3. **读产物** —— 从对应的 get / items / history 命令里取结果

Master Agent 提交后就可以去干别的活。CLI 里**没有** `--wait` / `--follow` / 阻塞式 API，也不提供实时推送订阅 —— 这是刻意的，agent-to-agent 委派场景不应该让主控 agent 傻等。就走轮询。

## 挑哪个原语

| 任务形态 | 原语 | 备注 |
|---|---|---|
| 一次性分析 / 渲染 / 对话 | `session` | 数据可由 prompt 带入或 session agent 自行从 source 拉 |
| 同一 action 并发到批量 item | `batch` | 输入 / 输出都是 server 文件路径；新建 batch 前数据需已在可达路径 |
| 事件触发（定时、标签变化、session 结束等） | `automation` | `enable` 后常驻运行 |

**session vs batch 的选择看数据在哪**。`batch.source.path` / `batch.output.path` 都是 server 文件系统路径，`batch items` 返回的也是 item state 而不是 output JSONL 的原文。所以：数据已经在 server（原有 source、前序 session 落盘、共享挂载）→ `batch` 直连合适；只有本地数据或单纯任务描述 → 起 session，让 agent 决定要不要内部拉 batch、要不要落盘再读。

改已有 batch 的 prompt / 并发度、启停、查状态、看 item summary 都只需 id，跟数据是否在本地无关。

## 三段生命周期

```
① 提交 (submit, 立即返回)  →  ② 过会儿轮询状态  →  ③ 读产物
```

三种原语的映射：

| 阶段 | session | batch | automation |
|---|---|---|---|
| ① 提交 | `session create` + `session send` | `batch create` + `batch start` | `automation create` + `automation enable`（事件驱动后续自动跑）<br/>或 `automation test`（手动触发一次） |
| ② 查状态 | `session get <id>` 的 `.data.isProcessing`（布尔） | `batch get <id>` 的 `.data.progress.status`（枚举） | `automation history <id> --limit N` 拿最近执行条目 |
| ③ 读产物 | `session messages <id>` 的 `.data.messages[-1].content`<br/>+ `session share <id> --html <file>` | `batch items <id>` 的 `.data.items[]`（每条 item 的 state；真正的 agent 回复要按 `.state.sessionId` 去 `session messages` 读）| `automation history <id>` 里对应条目 |

## 轮询范式

```bash
# session
dtpilot session send "$SID" "干活的 prompt"
while [ "$(dtpilot session get "$SID" | jq -r .data.isProcessing)" = "true" ]; do
  sleep 2
done
dtpilot session messages "$SID" | jq -r '.data.messages[-1].content'

# batch
dtpilot batch start "$BID"
while :; do
  STATUS=$(dtpilot batch get "$BID" | jq -r .data.progress.status)
  case "$STATUS" in completed|failed) break ;; esac
  sleep 10
done
dtpilot batch items "$BID" | jq '.data.items[]'
```

**轮询间隔怎么选**：

| 任务类型 | 预期耗时 | 建议间隔 |
|---|---|---|
| 简单 session（无工具，纯 LLM 回答） | 秒级 | 2s |
| 复杂 session（带 source / 工具调用） | 十秒到几分钟 | 5-10s |
| batch（几十到几千 item） | 分钟到小时 | 30-60s |

别每 100ms 扫一次，浪费带宽也没更快。

## 终止态识别

| 原语 | 终止信号 | 判断字段 |
|---|---|---|
| session turn | agent 回复完 | `session.isProcessing === false` |
| batch | 跑完（成功/失败） | `batch.progress.status ∈ {completed, failed}` |
| automation 单次执行 | history 条目落盘 | `automation history <id>` 最新条目 |

**陷阱**：
- `batch.progress.status = paused` 不是终止态，是 `resume` 之前的中间态
- batch 没有 `cancelled` 这个状态 —— 想中断用 `batch pause` 或 `batch delete`
- Automation 本身是常驻的，没有"整体跑完" —— 只有"某次 trigger 执行完"

## 取消 / 中断

| 原语 | 命令 | 效果 |
|---|---|---|
| session | `session cancel <id>` | 中断当前 turn，session 保留可续 |
| session | `session delete <id>` | 彻底删 session |
| batch | `batch pause <id>` | 暂停，可 `resume` |
| batch | `batch delete <id>` | 彻底删 batch |
| automation | `automation disable <id>` | 停止响应新事件，配置 / 历史保留 |

## 产物读取

### Session
```bash
# 最终回复文本（messages 返回整个 session 对象，消息在 .data.messages[]）
dtpilot session messages "$SID" | jq -r '.data.messages[-1].content'
# 整段 session 的只读分享链接
dtpilot session share "$SID" | jq -r '.data.url'
# 单独一个 HTML 文件上传分享（给上游 agent）
dtpilot session share "$SID" --html ./report.html | jq -r '.data.url'
```

### Batch
```bash
# 所有 item 的 state（id + state.{status, sessionId, summary, ...}）
dtpilot batch items "$BID" | jq '.data.items[] | {id, status: .state.status, sessionId: .state.sessionId, summary: .state.summary, error: .state.error}'

# 只要失败项（state.status ∈ pending/running/completed/failed/skipped）
dtpilot batch items "$BID" | jq '.data.items[] | select(.state.status=="failed")'

# agent 的实际回复不在 items 里，要按 sessionId 去 session 读
dtpilot batch items "$BID" | jq -r '.data.items[].state.sessionId' | while read SID; do
  echo "=== $SID ==="
  dtpilot session messages "$SID" | jq -r '.data.messages[-1].content'
done
```

### Automation
```bash
dtpilot automation history "$AID" --limit 50 | jq '.data[]'
```

## 关键原则

1. **提交动作立即返回** —— 拿到 ID 就走，不要傻等。
2. **Session 完成信号是 `isProcessing === false`** —— 轮询 `session get` 即可。
3. **Batch 的真相在 `items`，不在 `get`** —— `batch get` 告诉你跑完了，`items` 给你每条结果。
4. **`session messages` 返回的是整个 session 对象**，消息在 `.data.messages[]`，不是直接数组。
