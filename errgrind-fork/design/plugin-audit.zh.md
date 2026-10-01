# 已挂载插件必要性审计

2026-10-01 对 ErrGrind Web 组合的审计，用
`dsh --profile web --patch errgrind-fork/web.patch.yml --dump-config` 解析（覆盖所有嵌套
层级的条目、祖先 `disabled` 逐层传递、`!!js` 条件按 Linux + profile `web` 求值）。
结果：审计时 **105 个挂载条目，148 个禁用**；同日 G1–G6 删除组落地后挂载集为 **89**；后 directory-picker 回退（G6），当前 **90**（G6 中 `session-query-sqlite` 保留，见分组表）。

列含义按 todo 要求：**flow** = 哪个用户流程需要它；**dep** = 启用态消费者
（服务读取经 grep 验证，或文档化的结构性依赖方）；**model** = 是否进入模型请求；
**data** = 是否写持久状态；**sec** = 安全/权限面；**UI** = 拥有的浏览器入口。
结构性消费者（cordis Loader、gateway remote、boot 接线）单独注明——单纯 grep
`ctx.<service>` 会低估面向传输层的 provider，且会漏掉**必需 inject 列表**：`session-controller` 在 `static inject` 中按名字引入 `sessionQuery`，调用点 grep 不可见。G6 落地时实机抓到了这类依赖；"无消费者"的结论须对照 inject 声明复核。

## 层 A — 内核基底（全部保留）

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| timer | cordis 定时器服务（调度基建） | cordis runtime | 否 | 否 | 无 | 无 |
| hmr | 开发期热重载；生产空闲 | loader | 否 | 否 | 无 | 无 |
| config-editor | 类型化配置读写 | agent-default-model | 否 | settings 文件 | 配置写路径 | 无 |
| settings | 设置服务 | settings-controller, ui-settings* | 否 | 用户设置 | 设置域 | Settings 弹窗 |
| storage / storage-json / storage-domain | 投影/工作区背后的持久 KV | session-projection-cache, workspace | 否 | `~/.errgrind` 存储 | 无 | 无 |
| subprocess | 子进程执行 provider | sandbox | 否 | 否 | 进程执行 | 无 |

## 层 B — 模型面（全部保留）

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| llm | 所有请求都走的 provider 注册表 | 全部 | 是 | 否 | provider key | 无 |
| llm-pi-ai | Hongyun 中转路由（Astra/Opus） | agent loop | 是 | 否 | `ERRGRIND_RELAY_*` key | Models 设置 |
| llm-retry | 请求重试策略 | agent loop | 是 | 否 | 无 | 无 |
| agent-default-model | 默认模型解析 | session-controller | 否 | 否 | 无 | 模型 pill |
| credentials | 中转鉴权 key 存储 | llm-pi-ai | 否 | 凭据存储 | **key** | 无 |
| authorization | 鉴权授予检查 | llm-pi-ai auth, settings-controller | 否 | 鉴权状态 | **auth** | 无 |
| system-prompt | persona 前后缀槽位 | agent loop | 是 | 否 | 无 | 无 |

## 层 C — 会话面（除标记外保留）

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| session | sessions 服务 | 全部 | 否 | session 日志 | 会话数据 | 无 |
| session-persistence-jsonl | session 日志持久化 | sessions | 否 | **JSONL 日志** | 会话数据 | 无 |
| session-projection | 投影注册表 | session-controller, agent-loop | 否 | 投影 | 无 | 无 |
| session-projection-cache | 投影缓存 | session-controller | 否 | 缓存 | 无 | 无 |
| session-title / session-title-llm | 侧栏标题（首条 prompt 生成） | session-controller | 是（标题请求） | 标题 | 无 | 侧栏文字 |
| session-checkpoint-policy | 断点恢复 checkpoint | sessions resume | 否 | checkpoint | 无 | 无 |
| session-stats / session-turn-outline | turn 轨道 + 统计投影 | session-controller | 否 | 否 | 无 | turn 轨道 |
| attachment-local | 图片原件落盘 | attachments | 否 | **图片文件** | 用户内容 | 无 |
| image-offload | request-error 恢复：路由拒绝图片体积时把最旧图片卸到磁盘 | agent request-error 路径 | 否 | 卸载副本 | 用户内容 | 无 |
| session-telemetry-otel | OTLP 导出后端——**`session-telemetry` 协调器未挂载，无人发数** | 无 | 否 | 否 | 无 | 无 |

## 层 D — agent loop、tools、guard

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| agent / agent-loop | turn 机制本体 | 全部 | 是 | 否 | 无 | 无 |
| tools | 工具注册表；errgrind-episode 在此注册业务工具 | host-runner inject（必需）, errgrind-episode | 是 | 否 | 工具执行 | 工具卡 |
| token-meter | 上下文计量 | compaction-basic | 否 | 否 | 无 | 无 |
| compaction-basic | preset 域内自动压缩 | agent loop | 是 | 否 | 无 | 无 |
| spill-local / spill-policy | 大体积工具输出溢出落盘 | tools 管线 | 是 | spill 文件 | 无 | 无 |
| user-questions | UserQuestionService——消费者为 tool-ask-user/plan-mode，均已禁用 | 无启用态 | 否 | 否 | 无 | 无 |
| goal / goal-round-driver | goal 服务 + 驱动——消费者 command-goal/tool-goal/ui-goal，均已禁用 | 无启用态 | 否 | goal 状态 | 无 | 无 |
| jobs | JobRegistry——唯一启用态消费者是 subagent 的 run-settlement | subagent | 否 | job 记录 | 无 | 无 |
| subagent / subagent-spawn-in-process / subagent-fork-in-process | 委派后端——所有 tool-subagent*/ui-subagent 行均已禁用 | 无启用态 | 否 | 否 | **子会话** | 无 |
| repeat-tool-reminder | tools/post-execute + agent/pre-step 提醒；未挂任何模型工具 | 惰性 | 是 | 否 | 无 | 无 |
| timeout-policy | 包装 tools/execute 实现调用超时；无工具 | 惰性 | 否 | 否 | 无 | 无 |
| fs-observation-policy | fs 工具的 freshness/no-clobber 守卫；无 fs 工具 | 惰性 | 否 | 否 | 无 | 无 |

## 层 E — 沙箱 + 审批链（全部保留）

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| sandbox / bash-sandbox / fs-sandbox | tools 注册表解析用的沙箱 provider | sandbox-policy 解析 | 否 | 否 | **沙箱** | 无 |
| sandbox-policy | 只读模式 + 工作区根 | tools, fs-sandbox, bash-sandbox | 否 | 否 | **沙箱** | 无 |
| approval | 特权调用审批 | tools, permission-presets | 否 | 否 | **审批** | 无 |
| permission | preset → sandbox/approval 映射；刻意保留（持有预设） | tools 链 | 否 | 否 | **权限** | 无 |
| shell-env | 发布 DSH_WEB_URL/MODE | web-app boot | 否 | 否 | 无 | 无 |

## 层 F — web 工具 + MCP 后端（删除组）

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| web | ctx.web 运行时——唯一读者是 cordis-host-runner 沙箱提示文本 | 无（可选读取） | 否 | 否 | 网络抓取 | 无 |
| web-search-deepseek | 搜索 provider——需要产品已不再持有的 DeepSeek key | 无 | 是 | 否 | DeepSeek key | 无 |
| web-fetch-http | tool-web（已禁用）的抓取 provider | 无 | 是 | 否 | 网络抓取 | 无 |
| mcp-resources | MCP 资源读取；无 mcp-client 挂载 | 无 | 否 | 否 | MCP 数据 | 无 |

## 层 G — skills + commands

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| skill | skill 注册表（skill-filesystem 已禁用 → 空目录） | session-controller skill-catalog | 是 | 否 | 无 | 无 |
| commands | `/`/`+` 菜单背后的命令注册表 | ui-commands | 否 | 否 | 无 | 命令菜单 |
| command-feedback | `/feedback` + 会话反馈 remote | 命令菜单 | 否 | 反馈记录 | 无 | `/feedback` |

## 层 H — DeepSeek 专属管线（已于 G1 移除）

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| deepseek-llm-api-extensions | DeepSeek 请求的扩展注册表 | session-log-deepseek, plugin-pkg-inventory | 是 | 否 | 无 | 无 |
| session-log-deepseek | `dsh_session_log` 扩展：把会话日志元数据写入 DeepSeek 请求 | 注册到 deepseek-llm-api-extensions | 是 | 否 | 无 | 无 |
| plugin-package-inventory-deepseek | 面向官方 DeepSeek 请求的活动包清单 | 注册到 deepseek-llm-api-extensions | 是 | 否 | 无 | 无 |

封闭簇：所有消费者都在簇内或已禁用（`llm-deepseek`）。ErrGrind 请求经
`llm-pi-ai` → Hongyun 中转；这套东西永不执行。**2026-10-01 已移除（`f3d4a92`）。

## 层 I — host/web 传输（除标记外保留）

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| typert / typert-loader / typert-gateway / api-remotes | Remote RPC 主干 | 全部客户端 | 否 | 否 | 传输 | 无 |
| session-controller | 会话 remote（命令、冷读、控制流） | 客户端 shell | 否 | 否 | 会话操作 | 每个界面 |
| settings-controller | 设置/凭据 remote | Settings 弹窗 | 否 | 设置 | 凭据 | Settings |
| workspace-controller | 工作区 remote + directoryPickerController | 会话/工作区操作 | 否 | 否 | 无 | 无 |
| workspace | 工作区实体；会话按工作区分组 | session-controller | 否 | 工作区 | 无 | 无 |
| cordis-host-runner | JS 插件沙箱宿主（inject: tools） | tools | 否 | 否 | **执行 JS** | 无 |
| cordis-client-runner | 浏览器侧 cordis/inspect remote | 客户端 shell | 否 | 否 | 无 | 无 |
| web-startup / webserver / web-runtime | 绑定、伺服、打印 URL、打开 | boot | 否 | 否 | 绑定面 | 无 |
| client-hmr / modules | 客户端 bundle 扫描 + 重载 | 客户端 boot | 否 | 否 | 无 | 无 |
| connection | 传输 + productLabel + 鉴权页 | 客户端 shell | 否 | 否 | 鉴权 | 登录页 |
| file-upload | 浏览器上传传输 | composer | 否 | 上传 | 用户内容 | 附件 |
| agent-preset-registry / preset-standard | 会话级 realm（persona + 压缩） | session-controller | 是 | 否 | 无 | 无 |
| session-query-sqlite | 全文索引——`openAt: never`，配置即休眠 | **session-controller 必需 inject**（list/observe/search） | 否 | `:memory:` 索引 | 无 | 无 |
| directory-picker | 解析 native|browse 后端供工作区选择；ErrGrind 无创建工作区 UI | 无启用态 | 否 | 否 | 无 | 无 |

## 层 J — 客户端 shell（除标记外保留）

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| cordis-client-runner, ui-theme, locale, ui-layout, ui-renderer, ui-session, resources, ui-sidebar | shell 内核 + 主题/语言/布局/插槽/侧栏 | 浏览器 boot | 否 | 否 | 无 | shell |
| ui-conversation / ui-chat | 会话界面 + 会话头 + turn 渲染 | 浏览器 | 否 | 否 | 无 | 主界面 |
| ui-settings / ui-settings-general / ui-settings-models | 设置弹窗（分项已由配置裁剪） | settings | 否 | 否 | 无 | Settings |
| ui-sidebar-right | ui-chat 必需的 dock 服务；expandButton 已关 | ui-chat | 否 | 否 | 无 | 无（已门控） |
| ui-attachment | 附件渲染 | 消息 | 否 | 否 | 用户内容 | 图片卡 |
| ui-tool | 工具调用卡（errgrind 工具在此渲染） | turn | 否 | 否 | 无 | 工具卡 |
| ui-input-trigger / ui-commands | `/` 与 `+` 输入管线 | composer | 否 | 否 | 无 | 菜单 |
| ui-model-selection | 模型 pill + picker | composer | 否 | 模型选择 | 无 | 模型 pill |
| ui-workspace | 工作区树/picker + hero 座——**输出全部 CSS 隐藏（inventory #19）；`uiWorkspace` 仅被 `ui-conversation` 经 `ctx.get` 读取（工作区切换 + 打开会话回调）** | ui-conversation（可选读取、未加防护） | 否 | 否 | 无 | 隐藏 DOM |

## 层 K — ErrGrind 产品（保留）

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| errgrind-episode | 业务核心：error 草稿/确认、账本、drill | turn | 是 | **episode 状态** | 业务数据 | 无 |
| ui-errgrind-episode | Error 卡、历史、品牌、引导 | 浏览器 | 否 | 否 | 无 | 侧栏 + 卡片 |

## 删除候选，按依赖闭包分组

按 todo 要求"每次只移除一组，落地后跑定向回归"排序。

- **G1 — DeepSeek 请求管线**（`deepseek-llm-api-extensions`、`session-log-deepseek`、`plugin-package-inventory-deepseek`）：封闭簇，ErrGrind 路径零使用。**已落地**（`f3d4a92`）：启动 + 真实 Astra turn 通过。
- **G2 — 委派与 jobs**（`subagent`、`subagent-spawn-in-process`、`subagent-fork-in-process`、`jobs`）：无启用态消费者；所有委派工具与 UI 行已禁用。**已落地**（`ff36891`）：启动、冷读、恢复、一轮推进账本的 35 秒 Opus turn 均通过。
- **G3 — goal 与 user questions**（`goal`、`goal-round-driver`、`user-questions`）：无启用态消费者。**已落地**（`1dd82bb`）：启动 + 真实 turn 通过。
- **G4 — 模型 web 后端**（`web`、`web-search-deepseek`、`web-fetch-http`、`mcp-resources`）：tool-web 已关；runner 仅把 ctx.web 当沙箱提示文本。**已落地**（`5e450a6`）：启动 + 真实 turn 通过。
- **G5 — OTel 后端**（`session-telemetry-otel`）：无 telemetry 协调器挂载；默认导出器指向 harness-telemetry.deepseeksvc.com。**已落地**（`5e450a6`，与 G4 同提交）：启动 + 真实 turn 通过。
- **G6 — 休眠服务**（`session-query-sqlite`、`directory-picker`）：落地时拆分——`session-controller` 在**必需 inject 列表**中声明 `sessionQuery`（`listSessions`/`observeSession`），禁用 `session-query-sqlite` 会让整个会话面挂起（实机验证：启动日志报 "session-controller … waiting for service: sessionQuery"，工作区进入与最近会话恢复均失效）。因此 `session-query-sqlite` **保留挂载**；要移除需先把该 inject 改为可选，属共享包手术，留待后续。`directory-picker` **已回退**（保留挂载）：审计漏看了它是兜底恢复面——默认 Workspace 初始化失败时，`defaultWorkspaceFailed` toast 指引用户去“选择工作区”，而 `remote.directoryPicker` 按名字取的就是这个插件（`packages/client/ui-workspace/src/client/navigation.ts:145`）。禁用后 picker 手势打开空菜单，唯一的恢复路径断掉。2026-10-01 核对 todo-39 设置验收时发现。
- **G7 — 缺席工具的守卫策略**（`repeat-tool-reminder`、`timeout-policy`、`fs-observation-policy`）：挂在零可执行工具上。保留成本最低；仅当 loop 面进一步收缩时再评。
- **G8 — ui-workspace**（`ui-workspace`）：**保留——硬依赖且有真实功能**。`ui-conversation/src/client/apply.ts` 调用 `uiWorkspace.openSession` / `openWorkspace` 驱动会话头血缘面包屑与工作区选择；`openSession` 被 ErrGrind 自己的派生会话血缘用到（"Investigate this new Error" 子会话），且该服务承载 supersession/创建/通知逻辑，在 ui-conversation 里重写等同重复实现。其全部可见输出已 CSS 隐藏（inventory #19），移除换不来任何用户可见收益——导航大脑保留。

尽管零可执行工具仍刻意保留：整条 **层 E 沙箱链**（tools 无条件 inject
approval+sandboxPolicy——删它是对 tools 契约动手术，不是摘插件）以及
**spill**/**image-offload**（仅在真实条件触发的 loop 恢复管道）。
