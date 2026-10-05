---
description: "在对话中呈现已审阅的 Error 描述与公开的 Grill 进度卡片。"
kind: "package-reference"
---

# @errgrind/ui-errgrind-episode

[English](README.md) | 中文

## 概述

`@errgrind/ui-errgrind-episode` 在侧栏显示 Error 历史，并在对话中呈现公开的 Error、Grill、Teach 和 Drill 内容。学习者可以重新打开、重命名、归档或恢复一条 Error，并可针对已完成的 Error 请求 Drill。模型产出的内容（Teach 步骤、判分、提问与结论）按普通 assistant Markdown 渲染，仅等待输入的提示保留轻量边框。Error 卡片显示描述、确认状态、安全的追问进度和结论；确认操作调用 `/error-confirm <revision>`。Models 页底部提供 ErrGrind 的 Codex 设备码登录。

## 目录

- [组成](#composition)
- [隐私边界](#privacy-boundary)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="composition"></a>
## 组成

本包是浏览器插件。Web profile 挂载 `@errgrind/ui-errgrind-episode`；Client 入口注册 Conversation 事件定义、本地化 Chat 节点、确认按钮、`sidebar.workspaces` 中的 Error 历史面板，以及 `settings.models.footer` 中的 Codex 登录卡片。历史面板遮蔽通用 Workspace 浏览器，但保留其导航服务。它依赖 Session Controller、Locale、Conversation、Chat、Sidebar、Workspace 和 Models 设置客户端包。入口还为 Conversation 的三个通用输入文案注册中英文覆盖，使这些产品文案只应用于挂载此 ErrGrind 插件的 profile。

<a id="privacy-boundary"></a>
## 隐私边界

Client 从公开 Session 事件组装卡片。历史只读取狭义的 `errgrindEpisode` 浏览器视图，其中包含有长度上限的公开描述摘录、阶段和能否出 Drill；私有的 Host 折叠状态不可读取。缺少缓存分类的旧会话仍可打开并重建。Host 必须配置 `session-controller.browserView`，只允许已批准的投影键和事件字段，并确保私有事件、assistant stream、工具参数和附件存储引用不会进入浏览器响应。图片与文件缩略图使用由 Host 解析的 Session 事件位置标识。

<a id="model-experience"></a>
## 模型体验

无。本包渲染 Session 状态，且仅排入用户自己的修订确认与 Drill 请求；面向模型的全部事件由 Host 插件负责。

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
