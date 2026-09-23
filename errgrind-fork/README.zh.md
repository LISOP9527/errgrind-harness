# ErrGrind Web 组合

[English](README.md) | 中文

这个 patch 是 fork 的首个 Web 组合，并插入 `@errgrind/episode`。标准 preset 保留基础上下文压缩行为和 `/compact` 命令。该包会将用户提供的首次输入记录到会话中，让模型保存完整的 `error_draft`，并允许用户通过 `/error-confirm` 确认当前草稿。

Web 组合仍保留上游会话、附件、模型和聊天基础设施，也保留上游 workspace 选择器和会话界面；Error episode 卡片界面及原始图像 Evidence 的归属尚未实现。图像输入目前还不是可持久化的 ErrGrind Evidence。

先按仓库说明运行 `pnpm run build`。验证时使用隔离的 `DSH_HOME`，再从仓库根目录运行 `pnpm dsh --profile web --patch errgrind-fork/web.patch.yml --no-open`。这些说明用于启动当前的部分组合，不代表完整 Error 工作流已经实现或验证。不要将该组合中的聊天记录作为 ErrGrind 业务 Evidence。

产品与共享 Core 决策记录在 ErrGrind 仓库的 `design/decisions/2026-09-23-error-episode-and-agent-fork.md`。Git 历史记录了准确的 DeepSeek Harness 基点；本 fork 遵循上游 MIT 许可。

## 当前里程碑

当前实现覆盖首次输入捕获、模型撰写的描述草稿和人工明确确认。确认草稿不代表 Error 调查已完成或得到验证。

完整的 Record、Grill、Teach 和 Drill 行为仍待实现，Error episode 卡片界面、原始图像归属和 MCP 支持也尚未完成。真实案例工作流、模型和移动端验证仍待进行。现有 Web 外壳仍显示上游 workspace 和会话界面、编程任务式输入提示、"Workspace Write" 权限标签、DeepSeek 首次使用引导和上游品牌；仅凭配置不能证明底层工具和权限面已经封闭。
