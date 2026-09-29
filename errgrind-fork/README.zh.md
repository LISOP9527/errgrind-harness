# ErrGrind Web 组合

[English](README.md) | 中文

这个 patch 是 fork 的首个 Web 组合，并插入 `@errgrind/episode`。标准 preset 保留基础上下文压缩行为和 `/compact` 命令。Web UI 展示 Error、Grill、Teach 和 Drill 卡片，将用户提供的首次输入和附件事实记录为 Error 时点 Evidence，并通过 `/error-confirm <revision>` 按版本确认。附件 Evidence 的 quote 为空，因为来源是图像本身。八个模型工具是 `error_draft`、`error_clarify`、`grill_probe`、`grill_conclude`、`teach_step`、`drill_prepare`、`drill_judge` 和 `drill_answer_draft`；Web 中禁用了 `/error-status`。Teach 与 Drill 回答属于干预后的观察，不再作为原始 Error 成因证据。浏览器会隐藏普通 assistant 文本。

默认模型为 `openai-codex/gpt-5.6-sol`，推理强度为 medium；用户可在 Web 中选择其他模型。该路由使用现有的 DSH `llm-pi-ai` 和 pi-ai provider 登录。OAuth 凭据由 Host 凭据服务保存，不写入此 patch；用户必须通过授权界面完成登录。2026-09-25 的隔离 Web 实测已用真实 Codex 处理一条带两张图片的数学错题并提出澄清问题；尚未完成整个诊断链的真实模型验收。

Web 组合仍保留上游会话、附件、模型和聊天基础设施，以及上游 workspace 选择器和会话界面。原始图像字节现在需要持久化的 `saveFile` 凭据；保存失败会使上传失败，首条 Error 消息中的图像若缺少凭据就不能打开 episode。归一化图像引用携带确切的原件凭据，写入前先执行批量校验。真实 `LocalAttachmentStore` 测试和使用两张真实图片的隔离浏览器回归已验证输入准入、原件哈希与刷新恢复。

先运行 `corepack pnpm run errgrind:build` 构建源码，再运行 `npm run errgrind:start` 启动产品。此构建在限定 Node 堆内存的情况下检查各包的 TypeScript 引用项目，并生成 native、Host、Client 和 Web 产物。它不执行根级 Host/Client TypeScript 汇总项目及 Web TypeScript 项目；这些仍是独立门禁，后者目前会报 TS2878。专用构建会记录 ErrGrind 客户端 profile，并输出 ErrGrind 浏览器标题、manifest 和图标；普通 `build` 命令仍保留 DSH 品牌。ErrGrind 产品构建成功后，本地只修改 Web 品牌时可运行 `corepack pnpm run errgrind:build:web`，它只更新 Web 资源，不生成完整客户端构建记录。启动器使用 `ERRGRIND_HOME`（默认 `~/.errgrind`），并选择 Web profile 和 fork patch。只有调试底层 DSH 启动器时，才使用隔离的 `DSH_HOME`，并从仓库根目录运行 `NODE_USE_ENV_PROXY=1 corepack pnpm dsh --profile web --patch errgrind-fork/web.patch.yml --no-open`。这些说明用于启动当前组合，不代表所有产品流程均已完成或验证。只有经 Core 校验并关联来源的观察才可成为诊断 Evidence；聊天记录本身不是诊断结论。

在这台 3.8 GiB VPS 上，普通 Host 汇总检查设置 2 GiB 和 2.5 GiB Node 堆上限时都发生内存不足。限定内存的 ErrGrind 构建利用已有的 TypeScript 增量产物成功完成，并验证了包含 267 个文件的客户端构建记录。这份记录证明当前产物字节和公开构建 profile 一致，不代表被跳过的根级类型检查已经通过。同样内存限制下的全新 checkout 构建尚需验证；逐包构建和 tsdown 仍覆盖大量 DSH 工作区包。

在通过 `HTTP_PROXY`/`HTTPS_PROXY` 出网的 Node 24 环境，本机验证需在启动命令前设置 `NODE_USE_ENV_PROXY=1`。否则浏览器设备码登录可能显示成功，但 Node 的模型请求仍会直连超时。改变环境变量后须重启 Web 进程。

当前 fork 的产品契约见 `errgrind-fork/design/product-contract.md`；[产品待办](todo.md)跟踪迁移、产品呈现与逐步瘦身。[设计索引](design/README.zh.md)连接当前规则与研究；[本地迁移清单](history/python-product-2026-09-27/inventory.md)保留原始 fork 决策及全部前驱设计、agent 指令、进度和 Prompt 来源。Git 历史记录了准确的 DeepSeek Harness 基点；本 fork 遵循上游 MIT 许可。

## 当前里程碑

当前切片覆盖带有持久化 `saveFile` 图像凭据的首次输入捕获、模型撰写的描述草稿（`error_draft`）、Grill 追问（`grill_probe`）、暂定结论（`grill_conclude`），以及对最终描述的人工确认（`/error-confirm`）；确认与 Grill 完成同时发生。未确认时，Grill 保持开放，仍可澄清、追问和修订描述。完成后才可进入 Teach 和独立 Drill。主 agent 生成精确的 15 字段 DrillSpec，Core 在模型调用前持久化；之后独立的模型调用只接收该规格，并生成题目和参考答案。生成失败后会用已保存的规格重试；参考答案仅作为私有持久化 Judge 上下文。判分引用已持久化的用户回答。图片作答先通过 `drill_answer_draft` 形成可核对的草稿，用户回复 `确认` 或 `修正：...` 后才可判分。答错时，判分事件同时保存带来源关系的衍生 Error 快照；用户可将它打开为独立的待 Grill 会话。重复打开会复用同一会话，持久化日志可用于冷读恢复。首次 Error 时点 Evidence 来自 `error-open` 的来源文本和附件事实；澄清与探针回答 Evidence 来自 `user/message` 事件。有依据的诊断仍需真实探针回答支持，引用须匹配来源文本和当前诊断轮次。`latest-probe-answer` 会解析为持久化来源。Teach 开始后，后续回答不再成为原始 Error 成因的 Evidence，原始描述草稿也会锁定。Error 投影状态版本为 8，独立 Drill 投影为版本 3。

模型可见的 ErrGrind 指导集中在 `errgrind-fork/prompts/system.md` 和 `errgrind-fork/prompts/tools.json`；修改后重启 Web。插件从 `tools.json` 加载工具描述，可执行 schema 与校验仍在 `packages/core/errgrind-episode/src/index.ts` 和 `src/drill.ts`。若启动目录不是仓库根目录，把 `ERRGRIND_PROMPT_PATH` 设为 system prompt 的绝对路径；插件默认从同一目录加载 `tools.json`，也可用 `ERRGRIND_TOOL_PROMPTS_PATH` 覆盖。

`errgrindEpisode` 与 `errgrindDrill` 投影只在宿主内部使用。Error 投影使用 stateVersion 8，并将 `latest-probe-answer` 别名解析到其持久化来源；澄清问题待回答时记录为用户消息的回复，会连同来源文本和图像写入结构化 Evidence。Drill 投影使用 stateVersion 3，通过 `drill_answer_draft` 支持图片作答草稿；学习者须回复 `确认` 或 `修正：...` 完成作答后才可判分。浏览器展示 Error、Grill、Teach 和 Drill 卡片并隐藏普通 assistant 文本；Session Controller 的公开视图会筛选事件字段，因此私有诊断数据和 Drill 答案保留在 Host 上下文中。

简单分数错题的无密钥浏览器回放覆盖 Error 描述修订与确认、Grill 追问与结论、Teach、独立 Drill 生成与判分、图片作答草稿和复核、在独立会话打开衍生 Error、幂等重试、冷读、刷新恢复及 390px 布局。侧栏按公开 Error 描述列出 fork 自身的会话并打开原调查；明确指定某条已完成 Error 出 Drill 时，请求会排入该 Error 的原会话。Drill 生成先由主 agent 提出精确的 15 字段规格，Core 持久化后才用独立模型调用生成题目和答案；失败重试会复用已保存的规格。完整手机端产品验收和真实模型的完整闭环仍待完成；数据库迁移尚未实施。启动器使用 `ERRGRIND_HOME`（默认 `~/.errgrind`），不会自动导入旧数据库或凭据。一次真实 Codex 首轮测试中，第二次模型调用报告了 11,520 个 `cacheReadTokens`；单次结果不足以估算持续命中率或成本。MCP 支持仍待实现。上游应用元数据仍保留。Host 仅投影公开 Error 历史字段；私有诊断状态仍在 Host。旧版普通综合出题只是让模型选择一条 Error，新版不把多条 Error 合成一道 Drill。
