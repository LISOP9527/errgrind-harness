---
description: "在对话中呈现已审阅的 Error 描述与公开的 Grill 进度卡片。"
kind: "package-reference"
---

# @errgrind/ui-errgrind-episode

[English](README.md) | 中文

## 概述

`@errgrind/ui-errgrind-episode` 在侧栏显示 Error 历史，并在对话中呈现 Error、Grill、Teach 与 Drill 内容。学习者可以重新打开、重命名、恢复，或针对已完成的 Error 打开独立的 Drill 会话；仅 Drill 行提供归档，已归档的练习会话不留痕迹（已归档 Error 仍可恢复）。模型产出的内容按普通 assistant Markdown 渲染，仅等待输入的提示保留轻量边框。Error 卡片只显示描述与确认状态；Grill 结论与被其复述的澄清均为普通消息。确认操作调用 `/error-confirm <revision>`；空白 Error 无 provider 时显示模型引导卡片。

## 目录

- [组成](#composition)
- [隐私边界](#privacy-boundary)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="composition"></a>
## 组成

本包是浏览器插件。Web profile 挂载 `@errgrind/ui-errgrind-episode`；Client 入口注册 Conversation 事件定义、本地化 Chat 节点、确认按钮、`sidebar.workspaces` 中的 Error 历史面板、ErrGrind 品牌标识，以及 `conversation.input.dock` 中的模型引导卡片（空白 Error 没有可用 provider 时显示）。历史面板遮蔽通用 Workspace 浏览器，但保留其导航服务。它依赖 Session Controller、Locale、Conversation、Chat、Sidebar、Workspace 和 Models 设置客户端包。入口还为 Conversation 的三个通用输入文案注册中英文覆盖，使这些产品文案只应用于挂载此 ErrGrind 插件的 profile。注册的每个 Chat 节点在数据中携带 `TurnActivity` 标识（`kind` → 活动，经 `KIND_TURN_ACTIVITY`），使共享的轮次尾标能指出该轮产出——记录、追问、澄清、讲解、出题、起草或判分。

<a id="privacy-boundary"></a>
## 隐私边界

Client 从公开 Session 事件组装卡片。历史只读取狭义的 `errgrindEpisode` 浏览器视图，其中包含有长度上限的公开描述摘录、阶段、能否出 Drill 与行类型（Error 或 Drill）；私有的 Host 折叠状态不可读取。缺少缓存分类的旧会话仍可打开并重建。Host 必须配置 `session-controller.browserView`，只允许已批准的投影键和事件字段，并确保私有事件、assistant stream、工具参数和附件存储引用不会进入浏览器响应。图片与文件缩略图使用由 Host 解析的 Session 事件位置标识。

<a id="model-experience"></a>
## 模型体验

无。本包渲染 Session 状态，且仅排入用户自己的修订确认；Practice 经 `session.openDrill` 打开独立的 Drill 会话，面向模型的全部事件由 Host 插件负责。

#### KV 缓存影响

无；本包从不组装或发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **确认绑定到当前显示版本** — Host 会拒绝过期修订号；用户必须先查看更新后的卡片，再次确认。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作语境——点击展开</summary>

无。

</details>
