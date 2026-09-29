---
description: "在对话中呈现已审阅的 Error 描述与公开的 Grill 进度卡片。"
kind: "package-reference"
---

# @errgrind/ui-errgrind-episode

[English](README.md) | 中文

## Summary

`@errgrind/ui-errgrind-episode` 在侧栏显示 Error 历史，并在对话中呈现公开的 Error、Grill、Teach 和 Drill 卡片。学习者可以重新打开一条 Error，或针对一条已完成的 Error 请求 Drill。Error 卡片显示完整描述、修订号、确认状态、安全的追问进度和结论；确认操作会针对当前显示版本调用 `/error-confirm <revision>`。Models 设置页底部提供 ErrGrind 专用的 ChatGPT Codex 设备码登录。

## Composition

本包是浏览器插件。Web profile 挂载 `@errgrind/ui-errgrind-episode`；Client 入口注册 Conversation 事件定义、本地化 Chat 节点、确认按钮、`sidebar.workspaces` 中的 Error 历史面板，以及 `settings.models.footer` 中的 Codex 登录卡片。历史面板遮蔽通用 Workspace 浏览器，但保留其导航服务。它依赖 Session Controller、Locale、Conversation、Chat、Sidebar、Workspace 和 Models 设置客户端包。入口还为 Conversation 的三个通用输入文案注册中英文覆盖，使这些产品文案只应用于挂载此 ErrGrind 插件的 profile。

## Privacy boundary

Client 从公开 Session 事件组装卡片。历史只读取狭义的 `errgrindEpisode` 浏览器视图，其中包含有长度上限的公开描述摘录、阶段和能否出 Drill；私有的 Host 折叠状态不可读取。缺少缓存分类的旧会话仍可打开并重建。Host 必须配置 `session-controller.browserView`，只允许已批准的投影键和事件字段，并确保私有事件、assistant stream、工具参数和附件存储引用不会进入浏览器响应。图片与文件缩略图使用由 Host 解析的 Session 事件位置标识。

## Model Experience

本包呈现 Session 状态，并通过 Session Controller 发送用户明确确认的修订号。历史里的 Drill 操作会打开所选 Error 的原会话，并在其中排入用户请求；Host Core 会在出题前校验当前诊断。设置卡片通过 Host 的 Codex 授权 Remote 发起、查询或取消设备授权；浏览器只接收授权网址和一次性用户代码。它不会直接调用模型或组装模型上下文。

## Known Limitations and Deferred Work

- **尚未导入旧数据库** — 历史只列出 fork 自身存储中的 Session；旧 SQLite Error 库尚未导入。
- **确认绑定到当前显示版本** — Host 会拒绝过期修订号；用户必须先查看更新后的卡片，再次确认。
