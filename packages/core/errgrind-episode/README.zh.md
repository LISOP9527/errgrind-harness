---
description: "为基于会话的真实 Error 输入、原件附件事实、审阅草稿、受控 Grill 诊断账本和人工确认命令提供支持。"
kind: "package-reference"
---

# @errgrind/episode

[English](README.md) | 中文

## Summary

`@errgrind/episode` 在会话投影中记录真实 Error 输入与原始附件原件事实，允许 agent 通过 `error_draft` 起草完整的 Error 描述，通过 `grill_probe` 和 `grill_conclude` 执行 Grill 诊断，并通过 `/error-confirm` 强制人工确认。诊断定案前必须获得人工对 Error 描述的明确确认；定案后若修改草稿，会将诊断标记为待复核（stale）；在确认更正后的描述后，重新发起探针将开启新账本并将旧账本保留在 `diagnosisHistory` 中。本包区分用户直接输入与宿主转述，并提供 `/error-status` 用于检查 episode 状态。

## Event flow

在 agent 进入一步时，插件会在模型调用前检查已领取且标为用户来源的消息。如果消息包含文本或附件且尚无打开的 episode，插件会追加 `errgrind/error-open`，记录文本、回合编号、来源（`direct_user` 或 `host_relay`）以及 SHA-256 附件记录。当宿主挂载了附件服务时，原始图像字节在归一化前必须通过 `saveFile` 获取持久保存凭据。`saveFile` 失败会使上传失败；首条 Error 消息中的图像若缺少该凭据，则无法打开 episode。归一化图像引用携带确切的原件凭据（`errgrindOriginal`），且批量校验先于写入执行。真实 `LocalAttachmentStore` 集成测试覆盖了输入准入、已提交的原件凭据，以及冷启动后读取原始字节；完整 Web RPC 路径尚未测试。

已注册的 `errgrindEpisode` 投影折叠 `errgrind/error-open`、`errgrind/error-draft`、`errgrind/error-confirm`、`errgrind/grill-probe`、`errgrind/grill-conclude` 以及来自 `user/message` 的依据摘录。它维护真实的首次输入、附件引用、来源信息、描述草稿、已确认版本、`diagnosisHistory`、`evidenceSources` 以及当前活动的 `DiagnosticLedger`。每条用户回答归属一个诊断轮次，因此重新探针时即使复用探针编号，也不能把旧账本的回答当成本轮证据。无关事件会保留现有投影状态。

`error_draft` 工具接收一份完整描述（1–12,000 个字符），递增草稿版本，清除先前的确认状态，并在锚定版本发生改变时将已结束的诊断标记为待复核。用户使用 `/error-confirm` 确认当前草稿版本。定案后的更正会将诊断标记为陈旧待复核；在确认更正后的描述后，重新探针将启动全新账本，并将之前的账本归档至 `diagnosisHistory`。

在 Grill 阶段，agent 可调用 `grill_probe` 记录问题和候选假设。探针元数据携带内部预测与变式题参考答案。宿主的 `presentCall` 只返回问题，但当前 DSH Web session-controller 会将原始 Session 事件与 assistant tool-call 参数发送给浏览器，通用 Web 卡片仍可能显示这些字段。证据来源从 `user/message` 事件派生。诊断定案前必须获得人工对 Error 描述草稿的确认；`grill_conclude` 将诊断记录为 `supported`（指定最佳假设）或 `undetermined`（明确记录剩余不确定性）。`supported` 要求证据绑定到用户对探针的实际回答，且引文与源文本匹配。这保证证据与对话相连，不代表已证明因果机制。

## Human Commands

- `/error-confirm` — 确认当前的 Error 描述版本。如果草稿不存在、附带了多余参数或该版本已确认过，则会报错。
- `/error-status` — 展示 episode 来源、原始输入大小、附件哈希清单、草稿确认状态、诊断结论以及账本计数。

## Session projection

会话日志是所有 episode 状态的持久化事实来源。投影使用状态版本 `3`，以 `null` 为初始状态，并通过折叠已提交的会话事件进行确定性重建。如果投影服务或已注册键不可用，调用 `currentEpisode` 会明确报错。

本包没有导出 `./invariant`：投影折叠时已检查本包拥有的事件转换，本包也没有需要跨第二个服务或存储检查的关系。

## Model Experience

### Diagnostic tools and session conversation

#### What the model sees

本包不注册系统提示词。启用时，模型可以看到 `error_draft`、`grill_probe` 和 `grill_conclude` 的工具 schema 与描述。区分性探针调用将预期观察与参考答案保留在工具参数内部，工具卡片展示将 `rawInput` 配置为仅呈现问题。但由于当前 DSH Web session-controller 会在网络传输中将原始会话事件与工具调用参数发送至浏览器客户端，探针预测与参考答案在传输层面并不能向前端隐蔽。

#### Token effect

在宿主提供这些工具的请求中，工具 schema 会占用 token。Grill 探针和证据记录将结构化结论追加至会话日志，在支持多轮诊断的同时避免重复注入上下文。

#### KV Cache effect

工具描述与 schema 为静态结构，在前面上下文不变时可保持请求前缀稳定。探针与定案事件均为纯追加日志。

## Known Limitations and Deferred Work

- **Web 客户端数据暴露的隐私阻断项** — `errgrindEpisode` 投影只在宿主内部使用，但 DSH Web session-controller 会将原始 Session 事件、assistant 流与工具调用参数发送给浏览器，因此 `grill_probe` 预测与 `answerKey` 并未向浏览器或通用工具卡片隐蔽；这是面向用户测试前的阻断项（blocker）。
- **完整 Web 图像路径尚未测试** — 真实 `LocalAttachmentStore` 集成测试验证了输入准入，以及冷启动后按凭据恢复原始字节；浏览器 RPC 上传与重连尚未测试。
- **业务流程与移动端验收尚未完成** — 目前尚无完整的 Record/Grill/Teach/Drill 流程，也未进行移动端验收；后续教学干预、变式练习生成以及专用的移动端/Web Error 卡片 UI 均待后续实现。
- **实测 cache read tokens 尚未测量** — 请求前缀稳定性基于静态设计保证，但实际 `cacheReadTokens` 验证需要真实模型凭据；目前尚无真实模型的 cache-hit 数据。
- **Python 旧库迁移暂不进行** — Error #8 与 SQLite 历史记录保持只读参考，数据库迁移尚未实现。
