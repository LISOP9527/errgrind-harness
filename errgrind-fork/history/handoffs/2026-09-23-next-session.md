# ErrGrind fork：阶段交接（2026-09-24）

> Historical handoff; current authority is [product contract](../../design/product-contract.md), progress is [TODO](../../todo.md), and predecessor documents are in the [local inventory](../python-product-2026-09-27/inventory.md). Old paths below are historical context, not dependencies or instructions to import user data.

这是当前状态的交接，不是新的产品决策。新会话应先核对 Git 状态和源码；不要把旧交接中的「下一步」当成已完成事实。

## 用户目标与决定

- 独立产品与 MCP 插件并行发展，共享 ErrGrind 的业务核心；独立产品以 DeepSeek Harness fork 为当前技术验证基础，可替换旧 React WebUI。旧 Python/Core 边界可重划，不能因此丢失 Error、Evidence、diagnosis、intervention 的来源与认识论约束。
- 数学题 MVP。Record 与 Grill 融合为连续 Error 调查：模型写一段完整 Error 描述，用户可多轮修正并明确确认；建议用户输入题目、原思路、答案，但展示不分这三个字段。确认 Error 锚点与结束 Grill 是两个不同提交点。随后是 Teach、Drill、未来真实 Error；一次 Grill 不产生长期 Pattern。
- 应保留用户原话、宿主转述、模型草稿、原始图片、OCR/vision、Grill 回答和干预后观察的来源区别。Drill 判分与答错派生 Error 需要独立出处。注意真实上下文成本和 cache hit，不能凭静态前缀声称命中。
- 设计权威见 [原始 fork 决策快照](../python-product-2026-09-27/design/decisions/2026-09-23-error-episode-and-agent-fork.md.txt)；fork 的运行事实以当前源码为准。旧 ErrGrind 数据库与 WebUI 暂不迁移或修改。

## 仓库状态

- 工作仓库：`/home/lisop/errgrind-harness`，分支 `feat/errgrind-episode-foundation`，本地 HEAD 比 `origin/feat/errgrind-episode-foundation` 超前 1 个提交。该提交仅在本地；此前授权是本地提交，不要据此自行推送。`upstream` 是 DeepSeek 项目，不要推送到它。
- 当前 fork 代码在 `packages/core/errgrind-episode/`，组合配置在 `errgrind-fork/web.patch.yml`。先读仓库根 `AGENTS.md`、`packages/AGENTS.md`；涉及 Web 时读 `packages/web/AGENTS.md`、`packages/client/AGENTS.md`。
- 原仓库 `/home/lisop/errgrind` 的 `AGENTS.md` 有用户未提交修改，保留原样。旧交接在 `errgrind-fork/history/handoffs/2026-09-23.md`，其中 Gemini 交付后的未完成项已有部分已被后续本地提交（2026-09-23）修正，不能照抄其状态。
- 交接前另修改了 `/home/lisop/.codex/skills/antigravity-executor/SKILL.md`，并新建 `/home/lisop/.codex/AGENTS.md`：原生 Codex subagent 可主动承接独立、低上下文任务，优先短上下文与 Luna；agy 仍从主 agent 直接调用，保留 file-only guard 和主 agent 验收。agy skill 现要求按任务选 Flash 档位与有限超时，超时后先检查部分编辑再重试剩余范围。当前 `agy models` 列出 3.8/3.7 Flash High、Medium、Low；未测各档实际速度或额度消耗。

## 已实现及验证边界

- 首条用户输入进入 Session 事件；原始图片在归一化前经 `saveFile` 持久保存，并留下 SHA-256、字节数、媒体类型、原件凭据。直接输入与宿主转述分别标记。
- `error_draft` 保存完整描述版本；`/error-confirm` 由用户明确确认。`grill_probe` 记录候选机制、区分性问题、预测和变式题参考答案；`grill_conclude` 形成 `supported` 或 `undetermined` episode diagnosis。诊断所引证据必须关联当前轮次的真实用户回答，摘录须与原文匹配。确认后的更正会使旧结论 stale；重新探针可创建新账本并保留历史。
- 该提交（2026-09-23）修正了图片原件持久化与用户回答依据的代码约束。当前 `session-controller` 的 `browserView` 已在服务端处理历史、实时流和重连基线：内部 Grill 事件以保序占位替代，assistant 推理与工具参数不发给浏览器；Host 日志仍保留完整诊断账本。
- Record/Grill 无密钥浏览器竖切片已通过：使用隔离状态与旧库只读材料，浏览器实际上传两张图片，冷读 Session 并在重载后恢复原件；同一组本地材料还覆盖 Error 描述修正、`/error-confirm`、`grill_probe`、用户回答和 `grill_conclude`。测试检查了 WebSocket、历史响应、重连基线和 DOM 中的内部答案哨兵。Host 进程重启用例另以合成图片验证了原消息及原件收据恢复。没有迁移或修改旧数据库。
- 移动宽度检查在 390px 下通过，包含长对话与图片；当前仍是通用 DSH 对话界面，没有专用 Error UI。当前组合将新会话默认设为只读，并关闭 PTC 执行、Shell 设置、文件引用与跨会话引用；保留图片附件和 `/error-confirm` 所需命令。模型请求只包含 `error_draft`、`grill_probe`、`grill_conclude` 三个工具。没有删除上游包或测试。
- 实测组合有 129 个 active Loader 项；禁用前的测量为 133。可见界面仍有通用的“Add files or run commands”和“Describe what you want to build, / commands, @ files or sessions”文案；前者承载图片与 slash command 操作，后者在引用插件关闭后仍显得过时。Shell/文件侧栏、PTC 与引用插件未激活。候选裁剪应先审查尚未暴露到本次模型请求的 subagent、goal、web search 和 MCP 组件，再决定是否禁用；不要直接批量删包。
- 温热 E2E scaffold 启动 Host 约 2.6 秒；三个定向 Web E2E 串行共约 89 秒。没有运行构建。没有可用于本组合的 `DEEPSEEK_API_KEY`，所以模型输出来自 JSONL replay；显示的 `cacheReadTokens` 为 0，真实模型表现与 cache hit 尚未验收。Host 全量 TypeScript 项目在默认 2GB 与 2.5GB Node heap 下都因内存耗尽未完成；这不是诊断代码错误的结果。相关浏览器测试、lint 与 README 翻译配对检查通过。
- 未运行全仓测试或 `doc-sync`。没有 commit 或 push。原工作树的其他改动均保留。

## 下一阶段建议

1. 先评审通用 DSH 界面的剩余文案与 active 插件清单。保留 Session、附件、模型流、浏览器公开视图与回归测试；对尚未模型暴露的能力逐个验证消费者后再决定是否关闭。暂不批量删除上游包。
2. 有可用真实模型凭据时，用隔离状态跑一次真实 Record → Grill，记录模型表现、上下文与 `cacheReadTokens`；当前 replay 的 0 cache read 不代表真实 cache hit。
3. 再实现正式 Error 界面、Teach、Drill、MCP 共用业务操作及其出处。继续只读使用旧库；除非另有明确授权，不迁移 Error #8 或其他历史记录。
4. 主 agent 负责产品判断、安全、整合与验证；独立文件搜索或机械检查可按 `/home/lisop/.codex/AGENTS.md` 委派。不要为了省额度制造重复阅读或并发冲突。

## 当前交付提醒

当前工作树包含本阶段实现与先前未提交改动；开始后先看 `git status --short --branch` 并逐项区分来源。本阶段没有 commit、push、全仓测试、`doc-sync` 或旧库迁移。真实错题材料只在隔离 E2E 临时目录使用，测试退出时已清理。
