---
description: "为基于会话的真实 Error 输入、原件附件事实、审阅草稿、受控 Grill 诊断账本和人工确认命令提供支持。"
kind: "package-reference"
---

# @errgrind/episode

[English](README.md) | 中文

## Summary

`@errgrind/episode` 在会话投影中记录真实 Error 输入与原始附件原件事实，允许 agent 通过 `error_draft` 起草完整的 Error 描述，通过 `grill_probe` 和 `grill_conclude` 执行受控 Grill 诊断，并通过 `/error-confirm` 强制人工确认。诊断定案前必须获得人工对 Error 描述的明确确认；定案后若修改草稿，会将诊断标记为待复核（stale）。本包区分用户直接输入与宿主转述，并提供 `/error-status` 用于检查 episode 状态。

## Event flow

在 agent 进入一步时，插件会在模型调用前检查已领取且标为用户来源的消息。如果消息包含文本或附件且尚无打开的 episode，插件会追加 `errgrind/error-open`，记录文本、回合编号、来源（`direct_user` 或 `host_relay`）以及 SHA-256 附件记录。当宿主挂载了附件服务时，原始图像字节在归一化前先通过 `saveFile` 保存，从而持久保留确切的原件文件。

已注册的 `errgrindEpisode` 投影折叠 `errgrind/error-open`、`errgrind/error-draft`、`errgrind/error-confirm`、`errgrind/grill-probe` 和 `errgrind/grill-conclude`。它维护真实的首次输入、附件引用、来源信息、描述草稿、已确认版本以及结构化的 `DiagnosticLedger`。无关事件会保留现有投影状态。

`error_draft` 工具接收一份完整描述（1–12,000 个字符），递增草稿版本，清除先前的确认状态，并在锚定版本发生改变时将已结束的诊断标记为待复核。用户使用 `/error-confirm` 确认当前草稿版本。

在 Grill 阶段，agent 通过 `grill_probe` 提出具有区分度的探针以检验竞争假设（`H1`、`H2`...）。探针问题呈现在用户卡片中，而预测机制与变式题参考答案保留在探针元数据中，防止向学习者泄露答案。当收集到充分证据（`E1`、`E2`...）后，`grill_conclude` 将诊断定案为 `supported`（伴随已验证的最佳假设）或 `undetermined`（明确记录剩余不确定性）。在草稿确认前尝试定案会被严格拒绝。

## Human Commands

- `/error-confirm` — 确认当前的 Error 描述版本。如果草稿不存在、附带了多余参数或该版本已确认过，则会报错。
- `/error-status` — 展示 episode 来源、原始输入大小、附件哈希清单、草稿确认状态、诊断结论以及账本计数。

## Session projection

会话日志是所有 episode 状态的持久化事实来源。投影使用状态版本 `1`，以 `null` 为初始状态，并通过折叠已提交的会话事件进行确定性重建。如果投影服务或已注册键不可用，调用 `currentEpisode` 会明确报错。

本包没有导出 `./invariant`：投影折叠时已检查本包拥有的事件转换，本包也没有需要跨第二个服务或存储检查的关系。

## Model Experience

### Diagnostic tools and session conversation

#### What the model sees

本包不注册系统提示词。启用时，模型可以看到 `error_draft`、`grill_probe` 和 `grill_conclude` 的工具 schema 与描述。区分性探针调用将预期观察与参考答案保留在工具参数内部；用户卡片展示仅渲染探针问题，不泄露参考答案。

#### Token effect

在宿主提供这些工具的请求中，工具 schema 会占用 token。Grill 探针和证据记录将结构化结论追加至会话日志，在支持多轮诊断的同时避免重复注入上下文。

#### KV Cache effect

工具描述与 schema 为静态结构，在前面上下文不变时可保持请求前缀稳定。探针与定案事件均为纯追加日志。

## Known Limitations and Deferred Work

- **Teach 与 Drill 暂未接入** — 本包负责 Error 记录与 Grill 诊断；后续教学干预与变式练习生成留待后续包实现。
- **卡片展示与窄屏适配待完善** — 本包为工具和 CLI 状态提供了通用卡片展示；专用的移动端与 Web Error 卡片 UI 组件留待后续工作。
- **实测 cache read tokens 尚未测量** — 请求前缀稳定性基于静态设计保证，但实际 `cacheReadTokens` 验证需要真实模型凭据。
- **Python 旧库迁移暂不进行** — Error #8 与 SQLite 历史记录保持只读参考，不进行自动迁移。
