# ErrGrind Web 组合

[English](README.md) | 中文

这个 patch 是 fork 的首个 Web 组合：关闭上游 coding preset、模型可调用的终端与文件工具，以及与编程相关的浏览器面板；保留会话、图片、模型和聊天基础设施供验证。Error episode 界面尚未实现，上游 workspace 选择与会话界面暂时保留。

先按仓库说明运行 `pnpm run build`。验证时使用隔离的 `DSH_HOME`，再从仓库根目录运行 `pnpm dsh --profile web --patch errgrind-fork/web.patch.yml --no-open`。这个 patch 尚未实现 Error 记录、诊断、Teach、Drill 或 MCP server；此时的聊天记录不能当作 ErrGrind 业务 Evidence。

产品与共享 Core 决策记录在 ErrGrind 仓库的 `design/decisions/2026-09-23-error-episode-and-agent-fork.md`。Git 历史记录了准确的 DeepSeek Harness 基点；本 fork 遵循上游 MIT 许可。

## 首次冒烟验证（2026-09-23）

本地上游构建及应用 patch 后的 Web 启动通过。展开后的配置中 `preset-standard` 只包含 `persona`，patch 列出的 coding preset 与面板均已关闭。带令牌保护的本地页面在 Chromium 的 1280×800 和 390×844 视口下可以加载。

实际界面仍显示 workspace 选择、编程任务式输入提示、"Workspace Write" 权限标签、DeepSeek 首次使用引导和上游品牌。这些是明确的 UI 迁移任务。配置解析成功尚不能证明底层工具和权限面已经封闭；Error 工作流和真实模型调用也尚未验证。
