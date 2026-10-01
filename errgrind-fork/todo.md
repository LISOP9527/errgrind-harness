# ErrGrind fork 待办

本表跟踪新版独立产品。[旧 Python/React 进度快照](history/python-product-2026-09-27/todo.md.txt)记录前驱实现进度；这里以 [产品契约](design/product-contract.md)和[真人验收计划](design/human-acceptance.zh.md)为准。完成标准是用户流程和数据边界可验证，不是删除了多少 DSH 包。

## 先完成可用的产品闭环

- [ ] 用一条真实数学错题完成图片输入、Error 描述多轮修正、Grill 有区分度的追问、不确认后继续、共同确认、Teach、独立 Drill、判分和衍生 Error；同时检查中断恢复、私有数据不进入浏览器，以及实际模型的 `sourceRef` 和缓存用量。按[真人验收计划](design/human-acceptance.zh.md)记录结果。已用真实 Error #8 材料在 Hongyun 中转上跑通真实模型验收（`59318c8`）：hongyun-astra（openai-responses，gpt-6-astra，默认）完成全链路（图片+文本录入→草稿修订→区分度探针→结论→卡片按钮确认→Teach→原题隔离 Drill→判分→衍生 Error），隐私清扫无泄漏；hongyun-opus（anthropic-messages，claude-opus-5-5）修通四个配置问题（host-only baseURL、forceAdaptiveThinking、supportsMidConvoEffort 属 catalog-withheld、无 effort 即 400 故 route 默认 xhigh 且不提供 off）后 Xhigh 与默认档均可完成真实 turn。余下未验：中断恢复、缓存用量记录、undetermined 结论路径、手机端、第二条 Error 的真人验收。
- [x] 新版 Error 历史入口：侧栏按公开描述显示 fork 自身的 Error Session，能打开未完成和已完成的调查；无缓存分类的旧会话仍可打开重建。已判分 Drill 和衍生 Error 关系保存在各自会话时间线中。后续真人验收再决定是否需要更丰富的筛选、搜索和删除；旧 SQLite 数据尚未导入。
- [x] 从历史入口明确指定一条已完成的 Error 出 Drill：打开该 Error 的原会话并排入练习请求，由原会话的 Core 再次校验诊断锚点并记录练习。旧版普通综合出题是让模型代为选择目标 Error，不代表跨 Error 合成一道练习；当前不做跨 Error 综合或长期 Pattern。

## 产品呈现：分批去除上游 DSH 痕迹

- [x] 盘点首启、桌面和手机端所有可见的 DSH 名称、图标、默认文案、workspace 选择、coding 操作和无关设置；保存截图与对应组件/配置位置。区分可由配置替换的文字、可禁用的插件和必须改 UI 的交互。2026-10-01 完成逐屏盘点（桌面 + ~320px）：20 处残留按严重/中等/轻级分级并逐项给出 [配置]/[禁插件]/[改 UI]/[架构级] 处理路径，见 [debrand-inventory](design/debrand-inventory.md)；截图存 VM `~/errgrind-evidence/debrand/`（不入库）。最露骨三处：设置页 openai-codex/DeepSeek 行 + Codex sign-in 区块、401 页 "dsh web" 文案、失败 turn 卡原样渲染 provider 内部错误。
- [ ] 让首启和主界面以“开始/继续一条 Error”为中心；显示 ErrGrind 名称与视觉标识，保留必要的模型选择、图片上传、会话恢复和错误提示。先做一个可用的中文桌面与 390px 手机流程，再逐屏完善空状态、导航、长公式、无障碍和其他语言。每批修改用浏览器检查是否仍能完成完整流程。
- [ ] 对登录/设置/错误页面、浏览器标题与图标、帮助入口和产品启动说明做同一轮核对，确保用户不会从这些次级页面直接进入 DSH 的 coding/workspace 心智模型。不要仅把 DSH 字符串全局替换成 ErrGrind。进度：批 1（`8054ca3b`+`34244ab6`）已落地最小处理集 1/2/6——Models 页仅剩两条中转路由（新 `providerAddition` 引导开关藏加号卡）、Codex sign-in 区块删除、`/compact` `/export` 消失、`/permission` 经 `CommandRuntime.hiddenCommands` 隐藏、401 页显示 "ErrGrind"；浏览器验证菜单与一轮真实模型 turn。批 2 已落地最小处理集 3/4/5 + 第 15 项——失败 turn 卡映射友好文案（`message.failure.*` locale + `failureMessage()`，实机 AUTH 失败验证无 provider/model/HTTP body）、"Default workspace" locale → 'ErrGrind' + 未分类段措辞改为 "Sessions not yet linked to an Error:"、`hiddenSettingsItems` 配置 + `RenderOpts.except` 隐藏五个 agent 系设置分项、`expandButton: false` 关 dock 按钮（插件保留）、astra effort 收窄 low/medium/high；浏览器复核桌面 + 390px 布局、移动端 Settings、`/` 菜单无回归。剩余：轻级措辞统一项（#16–18）、DOM/产物架构级残留（#19–20）、残留口子（linkOpening 偏好仍可开 dock）。
- [x] 增加 ErrGrind 专用浏览器构建 profile；独立 Web 构建已验证标题、manifest、图标，通用 DSH 构建保持原样。当前本地 `apps/web/dist` 已用轻量 Web 命令更新；其他页面和加载瞬间的文案仍按上一项继续核对。

## DSH 瘦身：持续、按依赖逐层做

- [x] 首批可逆组合：产品 patch 禁用当前 Error 流程不需要的 coding 和浏览器插件；保留会话、附件、模型、认证与聊天基础设施。相关 Web 回放已通过；这一步主要缩小运行功能和可见入口，不等于磁盘体积已减少。
- [ ] 对仍挂载的插件记录“用户流程为何需要、谁依赖它、是否模型可见、是否有持久数据、安全权限和浏览器入口”。优先删除用户可见且有权限风险的无用能力；每次只移除一组，并运行针对启动、上传、会话冷读、恢复、模型选择和隐私的定向回归。若基础 UI 对它有硬依赖，先调整依赖再移除。审计已完成（`design/plugin-audit.md`）：dump-config 解析出 105 个挂载条目，按层记录六字段，删除候选分 G1–G8 组（G1=DeepSeek 请求管线封闭簇最先）；保留项含整条沙箱链（tools 契约硬依赖）与 spill/image-offload。后续按组移除并跑定向回归。
- [ ] 产品组合稳定后，再考虑从构建和发行物中排除不用的包、测试和通用 DSH 配置。测量启动时间、内存、构建耗时和发布体积，证明确有收益；不要为了减少仓库文件数删除上游测试或破坏共享包契约。保留必要的第三方许可和来源说明。
- [x] 在 3.8 GiB VPS 上验证 `errgrind:build` 的原生、Host、Client、Web 产物及客户端构建记录；按项目引用构建并限制 Node 堆后已完成，记录包含 267 个客户端文件。`errgrind:build:web` 仍只供本地静态资源更新，不产生完整记录。
- [ ] 在全新 checkout 上验证 3.8 GiB VPS 的 ErrGrind 产品构建内存与耗时；已通过的本机验证使用了 TypeScript 增量产物。
- [x] 修复 Web TypeScript 项目的 TS2878，并在资源足够的环境运行根级 Host/Client TypeScript 汇总检查；ErrGrind 本机构建会检查包级引用，但暂不执行这些根级项目。已在 32GB VM 完成（`9cae9eb`）：两个新 e2e 注册进 host include/apps/web exclude，`ui-errgrind-episode` 进 client program，`pnpm run typecheck`（host tsc + tsdown + client contracts）全绿，pre-push 钩子通过并已推 origin。

## 真人测试与发布前顺序

先跑真实数学错题诊断与 Drill，修复功能问题；再做首轮产品呈现和可逆瘦身，在手机端重测。旧库数据导入、MCP 接入和正式替换旧 WebUI 放在这些验收之后；导入应有独立的映射、备份、回滚和来源校验方案。

## 旧资料迁移后的能力与质量核对

资料归属和原文清单见[迁移说明](design/migration.md)；研究方向见[版本规划](design/research/version-plan.md)。以下不重复已有闭环、手机端、数据导入和 MCP 待办，也不把旧测试通过当作新版验收。

- [ ] 检查 Probe 的 predictions 是否恰好覆盖目标 hypothesis；已恢复 Prompt 要求，Core 的确定性覆盖检查仍须单独实现和验证。
- [ ] 用代表性数学案例评估补齐后的 Spec/Draft 指导：目标行为是否自然重要、success signal 可观察、题答一致、条件充分、表面结构有变化，以及推理难度与计算负担分离。无密钥回放只能验证传递与隔离。
- [ ] 评估 Judge 分别记录数学正确性与机制证据的设计；当前 boolean 不能表达全部维度，证据不足不得单独触发错误衍生 Error。此项不自动批准 schema 变更。
- [ ] 对照本地历史 ADR 核对旧 Drill 历史目标查询、即时仅显示对错与当前卡片/反馈的差异，明确需要保留的用户体验；不直接恢复旧 CLI。
- [ ] 核对 Settings 的目录失效回退、凭据不回显/不串用、当前保存状态及较新编辑不被旧响应覆盖等要求；按当前 Harness 配置机制验收，不能仅凭模型列表出现就认定可调用。
- [ ] 用实际用量检查是否能区分阶段、失败、修复、缓存和缺失 usage，且日志不含正文/凭据；旧用量报告命令不迁入新运行路径。

长期 Pattern、独立事件/冻结版本、盲法关联、opportunity 分母和 Policy 仍按 research 中的门槛推迟；保存资料不代表开始实现。
