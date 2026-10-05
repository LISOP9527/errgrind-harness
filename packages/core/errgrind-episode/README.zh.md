---
description: "为基于会话的真实 Error 输入、原件附件事实、审阅草稿、受控 Grill 诊断账本和人工确认命令提供支持。"
kind: "package-reference"
---

# @errgrind/episode

[English](README.md) | 中文

## 概述

`@errgrind/episode` 在会话投影中记录真实 Error 输入与原始附件原件事实，支持可见的输入澄清、Error 草稿与确认、Grill 诊断、公开 Teach 步骤和独立 Drill 尝试。Teach 与 Drill 属于干预，不是关于原始 Error 成因的新证据。Teach 开始后，原始 Error 草稿会被锁定。本包区分用户直接输入与宿主转述，并提供 `/error-status` 用于检查 episode 状态。

## 目录

- [事件流](#event-flow)
- [人工命令](#human-commands)
- [Session 投影](#session-projection)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="event-flow"></a>
## 事件流

在 agent 进入一步时，插件会在模型调用前检查已领取且标为用户来源的消息。如果消息包含文本或附件且尚无打开的 episode，插件会追加 `errgrind/error-open`，记录文本、回合编号、来源（`direct_user` 或 `host_relay`）以及 SHA-256 附件记录。首次文本和附件事实会初始化结构化的 Error 时点 Evidence；附件 Evidence 的 quote 为空，因为来源是图像本身，而非提取出的文字。当宿主挂载了附件服务时，原始图像字节在归一化前必须通过 `saveFile` 获取持久保存凭据。`saveFile` 失败会使上传失败；首条 Error 消息中的图像若缺少该凭据，则无法打开 episode。归一化图像引用携带确切的原件凭据（`errgrindOriginal`），且批量校验先于写入执行。无密钥 Web E2E 覆盖浏览器图片准入、原件凭据持久化、冷读 Session，以及页面重载后的图片读取；另一项 Host 重启测试使用合成图片覆盖恢复。这些测试不验证真实模型对图片的理解。

已注册的 `errgrindEpisode` 投影折叠 Error、Grill 和 `errgrind/teach-step` 事件，以及来自 `user/message` 的依据摘录。它的 Host 状态维护真实的首次输入、附件引用、来源信息、描述草稿、已确认版本、诊断历史、证据来源和当前诊断账本；浏览器视图只含公开描述的前 300 个 Unicode 字符、粗粒度阶段和当前能否出 Drill，供 Error 历史使用。`errgrind/error-clarify` 与 `errgrind/teach-step` 是持久化的公开对话事件。`latest-probe-answer` 来源别名会先解析到持久化的 `user/message` 来源，再进行依据校验。Teach 开始后的用户回答不会计入 Error 发生时的证据。无关事件会保留现有投影状态。

独立的 `errgrindDrill` 投影保存私有 DrillSpec 与参考答案、公开题目、持久化用户回答引用、可审阅的图片作答草稿以及判分记录。`drill_answer_draft` 将图片转写记录为草稿；学习者须回复 `确认` 或 `修正：...` 完成作答后，才可判分。`drill_judge` 从请求头记录判分所用 provider 和 model。答错时，同一条 `errgrind/drill-judged` 事件保存含题目、作答、参考答案及来源尝试的衍生 Error 快照。浏览器可请求把该快照打开为独立的待 Grill Session；重复请求会复用同一目标会话，来源关系保存在持久化日志中。

`error_draft` 工具接收一份完整描述（1–12,000 个字符），递增草稿版本。Grill 同时负责收集形成准确描述所需的信息。`grill_conclude` 只保存锚定当前草稿的暂定诊断，Grill 仍保持开放。用户使用 `/error-confirm <revision>` 确认该版本时，才一起提交诊断并完成 Grill；不确认则可继续澄清、追问和修订，旧提案随之失效。Teach 和 Drill 都要求这一共同完成。已完成诊断后的更正会将诊断标记为陈旧待复核；重新探针会将旧账本归档至 `diagnosisHistory`。

Grill 开放期间，agent 可调用 `error_clarify` 显示事实澄清问题，或调用 `grill_probe` 记录区分候选假设的问题；ErrGrind Web 组合中的普通 assistant 消息和 stream 不会显示给用户。新的澄清、探针或描述修订会使待确认结论失效。探针元数据携带内部预测与变式题参考答案。ErrGrind Web 组合配置中的 session-controller `browserView` 会在事件进入浏览器前，用保留序号的占位事件替换内部 Grill 事件，并从浏览器历史、实时帧和重连基线中移除 assistant 推理与工具参数。宿主的持久会话日志仍保留完整诊断账本。证据来源从 `user/message` 事件派生。`grill_conclude` 提出 `supported`（指定最佳假设）或 `undetermined`（明确记录剩余不确定性）的暂定结论；用户确认匹配的 Error 描述后，它才成为已完成诊断。`supported` 提案要求证据绑定到用户对探针的实际回答，且引文与源文本匹配。这保证证据与对话相连，不代表已证明因果机制。

<a id="human-commands"></a>
## 人工命令

- `/error-confirm <revision>` — 确认用户正在查看的 Error 描述版本。如果草稿不存在、提供的修订号已过期或该版本已确认过，则会报错。
- `/error-status` — 展示 episode 来源、原始输入大小、附件哈希清单、草稿确认状态、诊断结论以及账本计数。

<a id="session-projection"></a>
## Session 投影

会话日志是所有状态的持久化事实来源。`errgrindEpisode` 使用版本 `9`，以 `null` 为初始状态；`errgrindDrill` 使用版本 `3`，以空记录为初始状态。两者均通过折叠已提交事件重建。只有 Host 的 `browserView` 策略允许该键时，浏览器才能接收狭义的 `errgrindEpisode` 视图；私有折叠状态留在 Host。如果投影服务或已注册键不可用，调用 `currentEpisode` 会明确报错。

本包没有导出 `./invariant`：投影折叠时已检查本包拥有的事件转换，本包也没有需要跨第二个服务或存储检查的关系。

<a id="model-experience"></a>
## 模型体验

### 诊断工具与会话对话

#### 模型看到什么

本包不注册系统提示词。启用时，模型可以看到 `error_clarify`、`error_draft`、`grill_probe`、`grill_conclude`、`teach_step`、`drill_prepare`、`drill_answer_draft` 和 `drill_judge` 的工具 schema 与描述。工具描述和参数指导在插件启动时从 `errgrind-fork/prompts/tools.json` 加载；ErrGrind Web 的系统提示词在 `errgrind-fork/prompts/system.md`。`teach_step` 在当前诊断完成后公开教学问题、提示或解释。Drill 只公开题目与反馈，参考答案和衍生 Error 快照留在 Host。ErrGrind Web 组合会隐藏普通 assistant 文本；浏览器视图也使探针预测、工具参数、assistant 推理与内部 Grill 事件留在宿主。

当前 Web 组合将新会话默认设为只读权限，并关闭 PTC 执行、Shell 设置、文件／会话引用以及可能暴露附件哈希与诊断状态的 `/error-status`。图片附件和绑定修订号的 `/error-confirm <revision>` 仍可用；standard preset 向模型提供八个 ErrGrind 工具，包括 Teach、Drill 和 `drill_answer_draft`。

#### Token 影响

在宿主提供这些工具的请求中，工具 schema 会占用 token。Grill 探针和证据记录将结构化结论追加至会话日志，在支持多轮诊断的同时避免重复注入上下文。

#### KV Cache 影响

工具描述与 schema 为静态结构，在前面上下文不变时可保持请求前缀稳定。探针与定案事件均为纯追加日志。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **浏览器视图的范围** — ErrGrind Web 使用严格事件与字段白名单：浏览器只接收用户消息、完整 Error 描述与修订号、确认状态、公开补充问题、Grill 问题、安全结论字段以及狭义的 Error 历史视图。Assistant 消息、工具结果、内部 Grill 事件、推理、工具参数、私有投影状态和原始附件引用留在 Host。图片与文件读取使用事件位置标识，由 Host 在所属 Session 内解析。其他组合需要显式配置等效的 `browserView` 策略。
- **Web 图像与恢复覆盖** — 无密钥浏览器测试覆盖图片上传、原件收据、冷读 Session，以及页面重载后的图片恢复。另一项宿主重启测试使用合成图片验证恢复；这些测试不覆盖真实模型对图片的解读。
- **业务流程与移动端验收** — 简单分数错题的无密钥浏览器 replay 覆盖描述修正、Grill、Teach、错误判分的 Drill、在独立会话打开衍生 Error、幂等重试、冷读、刷新恢复及 390px 布局，定向测试 2/2 通过。图片作答现支持先审阅并确认或修正再判分；完整手机端产品验收和真实模型完整闭环仍待完成。
- **缓存表现仍需更多数据** — 一次隔离的真实 Codex 首轮测试中，第二次模型调用报告了 11,520 个 `cacheReadTokens`。这不足以估计完整流程的持续命中率或成本。
- **无可重复的旧库导入** — 旧 SQLite Error 库已由仓库外的一次性导入器迁入 fork 存储；产品没有内置导入功能，旧资料仍为只读参考。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作语境——点击展开</summary>

`origin` 记录首条 Error 输入是直接到达会话（`direct_user`）还是经宿主转述（`host_relay`）。折叠时仍会读取改名前日志写下的旧字段名；缺失或非法的值回落为 `direct_user`。同样的兼容读取也适用于 `probeId`：旧写入为未绑探针证据留下的空字符串在读取时按缺省处理，写边界把 `''` 归一为不写字段。

</details>
