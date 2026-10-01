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
| 4 | 失败 turn 卡 | 原样渲染 `INVALID_CONFIG`/`INVALID_REQUEST`/`PI_AI_ERROR` 徽章 + provider/模型/compat 字段 + HTTP body | turn 失败展示在 `ui-chat`/`ui-conversation`（`TurnProcessNodeView.tsx` 一带），错误文本来自 step/end reason | [改 UI]：错误卡映射友好文案，细节仅进日志 |

## 中等级：coding-agent 心智模型

| # | 位置 | 原文 | 代码位置 | 处理路径 |
|---|------|------|----------|----------|
| 5 | "+" / "/" 命令菜单 | **Permission**（sandbox+approval 暴露） | 命令注册在 `packages/interaction/permission-presets/src/index.ts:248`（`/permission` 是 web 端唯一写路径）；`ui-permission` 已禁用≠命令消失 | [禁插件]：禁用 `permission`/`permission-presets` 插件，或给命令注册加过滤 |
| 6 | 同上 | **Compact** | `packages/compaction/command-compact/src/index.ts:101`（preset-standard 内 compaction 组） | [禁插件]：只摘 `command-compact`，保留 `compaction-basic` 自动压缩 |
| 7 | 命令菜单 + 会话头 "..." 菜单 | **Export** / "Download session log" | `packages/session-query/session-log-export/src/index.ts:79` | [禁插件]：禁用 `session-log-export` |
| 8 | composer | 点选命令落裸模板 `/permission <preset>`、`/feedback <text>`、`/error-confirm` | command → composer 模板注入机制（`ui-model-selection`/commands UI 层）；arg 不落已知 gap | [改 UI]：点选直接执行或弹参数表单 |
| 9 | 会话头面包屑 + 侧栏 | "Default workspace" 作为会话标题 | `session-controller/client/sessions/service.ts:119` `workspaceTitleOf(cwd)` 回退；无 title 投影时取工作区名 | [改 UI]：ErrGrind 会话标题回退改为 Error 描述/中性文案；短期可改 workspace 显示名 |
| 10 | 侧栏 Error history 底部 | "These older sessions have not been classified yet…" + "Default workspace" 条目 | `ui-errgrind-episode` locales `history.unclassified` | [改 UI]：未分类段措辞或隐藏（自家包） |
| 11 | 每个 turn 下方 | "Worked"/"Took 39s"/"Failed" 徽章 | `ui-chat/src/client/locale.ts` `message.turnProcess.*` + `TurnProcessNodeView.tsx` | [配置] 文案可换；[改 UI] ErrGrind 可整枚隐藏 |
| 12 | 设置→General | "Send behavior while busy — while the agent is running" | `ui-settings-general` | [配置/改 UI]：ErrGrind 无 agent-busy 概念可整行隐藏 |
| 13 | 设置→General | Developer tools、Open configuration file、Performance & usage、"turns and steps"、底部 "Current version: 0.1.7-alpha.2"（shell 版本冒充产品版本） | `ui-settings-general` + `ui-settings/src/client/developer-tools.ts` | [禁插件/改 UI]：按项隐藏；版本号走产品构建变量 |
| 14 | 右上 "Open right sidebar" | 通用 dock 工作台："Start" tab、Split、Fullscreen | `packages/client/ui-sidebar-right` | [禁插件]：禁用 `ui-sidebar-right`（ErrGrind 无多窗格需求） |
| 15 | composer 模型 pill→Effort | 8 档梯子 Default/Off/…/Max | route `reasoningEfforts`（astra 全档） | [配置]：按产品收窄档位数 |

## 轻级 / 措辞统一

| # | 位置 | 原文 | 代码位置 |
|---|------|------|----------|
| 16 | 会话右竖条 | `aria-label="Jump to turn N"` | `ui-chat` locale `chat.turnNavigation.jump` |
| 17 | "+" 菜单 | "for this conversation" / "this session" | `ui-model-selection` 与 `ln` 命令描述 |
| 18 | Error 卡 footer | "…in the conversation" | `ui-errgrind-episode` locales（自家） |
| 19 | DOM 隐藏元素 | `data-hero-workspace-picker`、workspaces section、`crumbSubagent` 样式仍在 DOM | `ui-workspace`；已 CSS 压制，长期摘插件 |
| 20 | view-source | bundle URL `plugins/@deepseek-ai/dsh-*`、`__DSH_BOOT_READY__`、`--dsh-*` CSS 变量 | 构建产物命名 | [架构级] 长期项 |

## 核对过干净的面

- 首启 hero："EG" + "Start with a math mistake" 无 DSH；composer 无占位提示
- 侧栏底部仅 Settings 齿轮，无版本号外露（版本在设置内，见 #13）
- 模型 picker 仅 Astra/Opus 两路由
- "/" 与 "+" 菜单一致，无 terminal/files/workspace/jobs/subagent 命令泄露
- 无应用内右键菜单、无快捷键帮助页
- 移动 ~320px：rail 折叠正常；遗留同桌面（Default workspace 标题、菜单、右 pane 全屏占满）

## 建议的最小处理集（供排期）

1. 设置页 Models tab：摘 openai-codex/DeepSeek provider 行、Codex sign-in 区块、"+ Add model provider"（一处改动去掉最露骨残留）
2. 命令面：摘 Compact/Permission/Export（另评 Feedback/Model）；点选不落裸 `/cmd` 模板
3. turn 失败卡：友好文案映射，隐藏 provider/model/compat/HTTP body
4. "Default workspace"：会话标题回退 + 未分类段措辞
5. `ui-sidebar-right` 禁用 + 设置页 agent 系分项隐藏（Developer tools/Send behavior/Performance & usage/Open configuration file）
6. 401 文案去 "dsh web"
