# DSH 痕迹盘点（de-branding inventory）

2026-10-01 真实 UI 逐屏审计（桌面 + ~320px 移动）。截图存 VM `~/errgrind-evidence/debrand/`（01–14，不入库），逐屏过程录像 `~/screencasts/rec-4e264b19-…`。只盘点、未改动；每项给出处理路径。

判断标注：**[配置]** = locale 字典 / `web.patch.yml` 字段可换；**[禁插件]** = 禁用插件或命令注册源；**[改 UI]** = 需改组件代码；**[架构级]** = 不改 monorepo 包名无法消除。

已处理不重复报：title/manifest = ErrGrind（`errgrind-manifest.webmanifest`）；`brand.localBuild` 已由 `ui-errgrind-episode` locale override 为 ErrGrind；`welcomeNotice`/`credentialOnboarding` 已关（原"内测声明"含 DeepSeek Harness 文案）；模型 picker 仅两个 Hongyun 路由（`hideModelsWithoutCredential`）。

## 严重级：直接露品牌或内部实现

| # | 位置 | 原文 | 代码位置 | 处理路径 |
|---|------|------|----------|----------|
| 1 | 设置→Models provider 列表 | "openai-codex"、"DeepSeek" 行（红点无凭据） | `packages/client/ui-settings-models/src/client/ModelsSection.tsx` + `ModelRow.tsx`；provider 数据来自 `llm-pi-ai`（openai-codex）与 `llm-deepseek` 路由声明 | [改 UI] 或 [配置]：设置页按产品 flag 隐藏无凭据 provider 行；或从 patch 摘除 openai-codex/llm-deepseek（注意 patch 留 `openai-codex: {}` 是为 codex 模型可见性） |
| 2 | 设置→Models 底部 | "Codex sign-in … Sign in with ChatGPT" 整块 OAuth | **`packages/client/ui-errgrind-episode/src/client/CodexAuthSettings.tsx`**（自家包渲染，index.ts:534 注册） | [改 UI]：ErrGrind 产品移除该区块（codex auth 是 codex 时代遗物） |
| 3 | 无 token 401 页 | `dsh web authentication required; reopen the URL printed by dsh web.` | `packages/client/connection/src/browser-auth.ts:309` | [改 UI]：host 响应文案改为产品名 |
| 4 | 失败 turn 卡 | ~~原样渲染 `INVALID_CONFIG`/`INVALID_REQUEST`/`PI_AI_ERROR` 徽章 + provider/模型/compat 字段 + HTTP body~~ **已做（批 2）** | turn 失败展示在 `ui-chat`/`ui-conversation`（`TurnProcessNodeView.tsx` 一带），错误文本来自 step/end reason | [改 UI]：已落地为 `message.failure.*` locale 键 + `MessageItem.tsx` 的 `failureMessage()` 映射，细节仅进日志 |

## 中等级：coding-agent 心智模型

| # | 位置 | 原文 | 代码位置 | 处理路径 |
|---|------|------|----------|----------|
| 5 | "+" / "/" 命令菜单 | **Permission**（sandbox+approval 暴露） | 命令注册在 `packages/interaction/permission-presets/src/index.ts:248`（`/permission` 是 web 端唯一写路径）；`ui-permission` 已禁用≠命令消失 | [禁插件]：禁用 `permission`/`permission-presets` 插件，或给命令注册加过滤 |
| 6 | 同上 | **Compact** | `packages/compaction/command-compact/src/index.ts:101`（preset-standard 内 compaction 组） | [禁插件]：只摘 `command-compact`，保留 `compaction-basic` 自动压缩 |
| 7 | 命令菜单 + 会话头 "..." 菜单 | **Export** / "Download session log" | `packages/session-query/session-log-export/src/index.ts:79` | [禁插件]：禁用 `session-log-export` |
| 8 | composer | 点选命令落裸模板 `/permission <preset>`、`/feedback <text>` | command → composer 模板注入机制（`ui-model-selection`/commands UI 层） | [改 UI]：点选直接执行或弹参数表单。~~`/error-confirm`~~ **已做** —— 经 `hiddenCommands`（patch.yml）从斜杠菜单隐藏，描述卡片的确认控件成为唯一确认路径；手输 `/error-confirm` 行按设计作为普通聊天提交，面向模型的 prompt 亦只声明卡片确认 |
| 9 | 会话头面包屑 + 侧栏 | ~~"Default workspace" 作为会话标题~~ **已做（批 2）** | `session-controller/client/sessions/service.ts:119` `workspaceTitleOf(cwd)` 回退；无 title 投影时取工作区名 | [改 UI]：`ui-workspace` `defaultWorkspace.title` locale 改为 'ErrGrind'——新工作区目录/标题均为 ErrGrind；变更前已存的会话标题仍显示旧文案 |
| 10 | 侧栏 Error history 底部 | ~~"These older sessions have not been classified yet…"~~ **已做（批 2）** | `ui-errgrind-episode` locales `history.unclassified` | [改 UI]：改为 "Sessions not yet linked to an Error:" |
| 11 | 每个 turn 下方 | ~~"Worked"/"Took 39s"/"Failed" 徽章~~ **已做**——文案现为 "已完成工作"/"思考 {时长}"/"处理失败"（运行中 "思考中 {时长}"；en "Worked"/"Thought for"/"Failed"，running "Thinking for"） | `ui-chat/src/client/locale.ts` `message.turnProcess.*` + `TurnProcessNodeView.tsx` | [配置] 文案路径已落地——固定 thinking 文案，按节点命名的活动机制已移除；[改 UI] 整枚隐藏仍是可选项 |
| 12 | 设置→General | ~~"Send behavior while busy — while the agent is running"~~ **已做（批 2）** | `ui-settings-general` | [配置/改 UI]：经 `hiddenSettingsItems`（id `composer-enter`）隐藏 |
| 13 | 设置→General | ~~Developer tools、Open configuration file、Performance & usage、底部 "Current version: 0.1.7-alpha.2"~~ **已做（批 2）**——"turns and steps" 文案保留（描述的是 ErrGrind 的 turn 展开行为） | `ui-settings-general` + `ui-settings/src/client/developer-tools.ts` | [禁插件/改 UI]：经 `hiddenSettingsItems`（ids `developer-tools`、`current-version`、`performance-usage`、`open-document`）隐藏 |
| 14 | 右上 "Open right sidebar" | ~~通用 dock 工作台："Start" tab、Split、Fullscreen~~ **已做（批 2 + 收尾）**——插件保留（ui-chat 依赖其服务）；`expandButton` 配置关掉 header-corner 按钮，并把 `link-opening` 设置行隐藏，新装用户不会再持久化 `linkOpening:'sidebar'` | `packages/client/ui-sidebar-right` | [禁插件]：口子已堵——行经 `hiddenSettingsItems` 隐藏；仅已持久化的旧 'sidebar' 偏好仍能打开 dock（新装不存在） |
| 15 | composer 模型 pill→Effort | ~~8 档梯子 Default/Off/…/Max~~ **已做（批 2）** | route `reasoningEfforts`（astra 全档） | [配置]：`web.patch.yml` 中 astra 收窄为 low/medium/high；opus 保持 xhigh/max（模型强制） |

## 轻级 / 措辞统一

| # | 位置 | 原文 | 代码位置 |
|---|------|------|----------|
| 16 | 会话右竖条 | ~~`aria-label="Jump to turn N"`~~ **已做（收尾）**——'Turn navigation'/'Jump to turn N' → 'Message navigation'/'Jump to message N'；zh 轮次 → 条消息 | `ui-chat` locale `chat.turnNavigation.*` |
| 17 | "+" 菜单 | ~~"for this conversation" / "this session"~~ **已做（收尾）**——模型命令 → 'this Error'/本条 Error；feedback → 'this Error'/本条 Error；附带：`error.sessionInUse` 的 DSH 字样换成 ErrGrind | `ui-model-selection` 与 `ui-commands` locale 描述 |
| 18 | Error 卡 footer | ~~"…in the conversation"~~ **已做（收尾）**——'in the conversation' → 'in this Error'（en ×4）、在对话中 → 在本条 Error 中（zh ×3） | `ui-errgrind-episode` locales（自家） |
| 19 | DOM 隐藏元素 | `data-hero-workspace-picker`、workspaces section、`crumbSubagent` 样式仍在 DOM | `ui-workspace`——**已裁定：插件保留且有用**（G8 保留：`openSession`/`openWorkspace` 驱动血缘面包屑与工作区选择）；隐藏 DOM 按设计继续 CSS 压制 |
| 20 | view-source | bundle URL `plugins/@deepseek-ai/dsh-*`、`__DSH_BOOT_READY__`、`--dsh-*` CSS 变量 | 构建产物命名——**缓期：架构级**；改 bundle 路径/CSS 变量/启动标志要动构建链与缓存调试约定，无用户可见收益 |

## 核对过干净的面

- 首启 hero："EG" + "Start with a math mistake" 无 DSH；composer 无占位提示
- 侧栏底部仅 Settings 齿轮，无版本号外露（版本在设置内，见 #13）
- 模型 picker 仅 Astra/Opus 两路由
- "/" 与 "+" 菜单一致，无 terminal/files/workspace/jobs/subagent 命令泄露
- 无应用内右键菜单、无快捷键帮助页
- 移动 ~320px：rail 折叠正常；遗留同桌面（Default workspace 标题、菜单、右 pane 全屏占满）

## 建议的最小处理集（供排期）

1. ~~设置页 Models tab：摘 openai-codex/DeepSeek provider 行、Codex sign-in 区块、"+ Add model provider"~~ **已做（批 1）** — `web.patch.yml` 停 codex 路由与 `llm-deepseek`；删 `CodexAuthSettings`；新增 `providerAddition` 引导开关藏加号卡。Host 侧后来也清理：`CodexAuthController` 及其 `errgrindCodexAuth` Remote namespace 从 `dsh-api-settings-controller` 删除（路由移除后即空转），连带 `CodexAuthStatus`/`CodexAuthNotice` 类型、host spec、live-codex e2e 与 credentials.md 小节
2. ~~命令面：摘 Compact/Permission/Export（另评 Feedback/Model）；点选不落裸 `/cmd` 模板~~ **已做（批 1）** — `/compact` 随 `command-compact` 移除，`/export` 随 `session-log-download` 禁用消失，`/permission` 由新增的 `CommandRuntime.hiddenCommands` 隐藏（插件保留以持有沙箱预设）；Feedback 保留——通用项非 DSH；`/model` 后来也经新增的 `commandMenu` 配置隐藏（composer 模型位仍可切换）。后续加固：`hiddenCommands` 只过滤 `list`，因此 `web.patch.yml` 也摘掉了 `workspace-write`/`danger-full-access` 预设——只配 `read-only`，手打 `/permission` 会按普通聊天提交
3. ~~turn 失败卡：友好文案映射，隐藏 provider/model/compat/HTTP body~~ **已做（批 2）**——`message.failure.*` locale 键（中英）+ `MessageItem.tsx` `failureMessage()` 映射；实机 AUTH 失败验证显示 "This turn failed — API key is invalid"。后续精修：原始诊断完全不可见，卡片恢复 `code` 徽章并新增“错误详情”折叠区展示 `node.message`（AUTH 在 `displayFailure` 已清空防凭据回显），重试详情行重新显示原始失败消息
4. ~~"Default workspace"：会话标题回退 + 未分类段措辞~~ **已做（批 2）**——`defaultWorkspace.title` → 'ErrGrind'；`history.unclassified` → 'Sessions not yet linked to an Error:'；已存在的旧会话标题仍为原文案
5. ~~`ui-sidebar-right` 禁用 + 设置页 agent 系分项隐藏~~ **已做（批 2）**——`expandButton: false` 关掉 header-corner 按钮；新增 `hiddenSettingsItems` 配置 + `RenderOpts.except` 隐藏 `developer-tools`、`current-version`、`composer-enter`、`performance-usage`、`open-document`；收尾补 `link-opening`；同批收窄 effort 档位（第 15 项）
6. ~~401 文案去 "dsh web"~~ **已做（批 1）** — `connection.productLabel` 配置；页面显示 "ErrGrind authentication required"
