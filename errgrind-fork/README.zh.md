# ErrGrind Web 组合

[English](README.md) | 中文

这个 patch 是 fork 的首个 Web 组合，并插入 `@errgrind/episode`。标准 preset 保留基础上下文压缩行为和 `/compact` 命令。该包会将用户提供的首次输入记录到会话中，让模型保存完整的 `error_draft`，允许用户通过 `/error-confirm` 确认当前草稿，通过 `grill_probe` 与 `grill_conclude` 执行受控 Grill 诊断，并提供 `/error-status` 查看状态。

Web 组合仍保留上游会话、附件、模型和聊天基础设施，以及上游 workspace 选择器和会话界面。原始图像字节现在需要持久化的 `saveFile` 凭据；保存失败会使上传失败，首条 Error 消息中的图像若缺少凭据就不能打开 episode。归一化图像引用携带确切的原件凭据，写入前先执行批量校验。真实 `LocalAttachmentStore` 测试验证了输入准入和冷启动后恢复原始字节；浏览器 RPC 上传与重连尚未测试。专用的 Error episode 卡片界面尚未实现。

先按仓库说明运行 `pnpm run build`。验证时使用隔离的 `DSH_HOME`，再从仓库根目录运行 `pnpm dsh --profile web --patch errgrind-fork/web.patch.yml --no-open`。这些说明用于启动当前的部分组合，不代表完整 Error 工作流已经实现或验证。只有经 Core 校验并关联来源的观察才可成为诊断 Evidence；聊天记录本身不是诊断结论。

产品与共享 Core 决策记录在 ErrGrind 仓库的 `design/decisions/2026-09-23-error-episode-and-agent-fork.md`。Git 历史记录了准确的 DeepSeek Harness 基点；本 fork 遵循上游 MIT 许可。

## 当前里程碑

当前切片覆盖带有持久化 `saveFile` 图像凭据的真实首次输入捕获、模型撰写的描述草稿（`error_draft`）、人工明确确认（`/error-confirm`）以及 Grill 诊断（`grill_probe` 与 `grill_conclude`）。证据来源从 `user/message` 事件派生；定案为 `supported` 的诊断要求证据绑定到用户对探针的实际回答，引文与源文本匹配，且回答属于当前诊断轮次。这是用于保证对话依附性的代码守卫，而非主张因果诊断已获科学证实。定案后的更正会将诊断标记为待复核；确认更正后的描述后，重新探针将开启新账本并将旧账本保存在 `diagnosisHistory` 中。投影状态版本为 3。仅确认草稿并不代表 Error 调查已完成或得到验证。

隐私阻断项：`errgrindEpisode` 投影只在宿主内部使用，但当前 DSH Web session-controller 会将原始 Session 事件、assistant 流和工具调用参数直接发送给浏览器。因此，浏览器能看到 `grill_probe` 预测与 `answerKey`，通用工具卡片也可能显示这些内容。面向用户测试前必须解决。

目前尚无完整的 Record/Grill/Teach/Drill 流程、移动端验收、真实模型 cache-hit 数据或数据库迁移。MCP 支持仍待实现。现有 Web 外壳仍显示上游 workspace 和会话界面、编程任务式输入提示、"Workspace Write" 权限标签、DeepSeek 首次使用引导和上游品牌；仅凭配置不能证明底层工具和权限面已经封闭。
