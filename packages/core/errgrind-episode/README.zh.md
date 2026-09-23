---
description: "为需要显式人工确认步骤的组合提供基于会话的首次 Error 输入和经审阅的描述草稿。"
kind: "package-reference"
---

# @errgrind/episode

[English](README.md) | 中文

## Summary

`@errgrind/episode` 将首次标为用户来源的输入记录在会话投影中，允许 agent 通过 `error_draft` 保存完整的 Error 描述，并且只接受用户通过 `/error-confirm` 命令明确确认的当前草稿版本。在用户明确确认前，草稿始终是模型撰写的内容；每次替换草稿都会清除先前的确认状态。本包提供输入记录和确认边界，不包含完整的 ErrGrind 工作流。

## Event flow

在 agent 进入一步时，插件会在模型调用前检查已领取且标为用户来源的消息。如果消息文本或图像内容非空且尚无打开的 episode，插件会追加 `errgrind/error-open`，记录文本、是否包含图像的标记以及回合编号。该事件不保存图像字节。

已注册的 `errgrindEpisode` 投影只折叠 `errgrind/error-open`、`errgrind/error-draft` 和 `errgrind/error-confirm`。它提供首次输入、输入是否包含图像、输入所属回合、最新草稿版本及文本，以及已确认的版本。无关事件会保留现有投影状态。

`error_draft` 工具接收一份完整描述，对内容去除首尾空白，限制长度为 1–12,000 个字符，递增草稿版本并追加 `errgrind/error-draft`。新草稿会替换旧草稿并清空 `confirmedRevision`。工具契约要求 agent 区分用户的陈述与自己的解释，并请用户审阅描述；工具本身不能代替用户确认。

审阅草稿后，用户不带参数运行 `/error-confirm`。命令会在 `errgrind/error-confirm` 中记录当前版本，以及对应用户发起的 `command/run` 事件关联 ID。重复确认当前版本会返回成功，但不会追加第二条确认事件。过期版本和无效事件转换会失败。

## Session projection

会话日志是本包状态的持久化事实来源。投影使用状态版本 `1`，以 `null` 为初始状态，并通过折叠已提交的会话事件重建；如果投影服务或已注册键不可用，`currentEpisode` 会明确报错。

本包没有导出 `./invariant`：投影折叠时已检查本包拥有的事件转换，本包也没有需要跨第二个服务或存储检查的关系。

## Model Experience

### Draft tool and session conversation

#### What the model sees

本包不注册系统提示词。启用时，模型可以看到 `error_draft` 工具的 schema 和描述，以及普通会话上下文中的工具调用与结果。工具接收一个必填的 `description` 字符串，并返回保存后的版本和描述。

#### Token effect

在宿主向模型提供该工具的请求中，工具 schema 会占用 token。使用工具时，调用和渲染后的结果会增加会话内容；本包将首次输入作为领域事件保存，不会再向模型上下文添加一份副本。

#### KV Cache effect

本包的工具描述和 schema 是静态内容；只要组合和此前上下文未变，它们就能保留可复用的请求前缀。工具调用和结果会向会话追加内容；替换草稿不会改写先前的会话事件。Provider 的缓存可用性和驱逐策略不属于本包契约。

## Known Limitations and Deferred Work

- **不包含完整 Error 工作流** — 本包没有实现 Record 编辑、Grill、Teach、Drill、UI 或 MCP 行为；消费者需要提供这些能力。
- **图像输入仅作标记** — 打开事件保留是否包含图像的标记，但不会持久化或暴露原始图像数据。
- **确认只针对版本** — 确认表示用户命令接受了当前描述版本；它不验证描述的事实准确性，也不代表完成了其他工作流阶段。
- **尚未记录 adapter 来源** — DSH 中标为用户来源的消息也可能由宿主转述。未来 MCP adapter 必须记录这层来源，才能将其文本作为用户直接提供的 Evidence。
