# ErrGrind Web 组合

[English](README.md) | 中文

本目录是 Harness fork 的 ErrGrind 产品组合。`web.patch.yml` 启动 DSH Web profile，插入 `@errgrind/episode`，并禁用 Error 流程用不到的 coding、浏览器和 DSH 品牌界面。ErrGrind 每次围绕一条真实数学 Error，依次经过 Error 录入、Grill、Teach 和隔离 Drill；[产品契约](design/product-contract.md)定义该流程及其 Evidence、隐私和持久化规则。

## 模型与 key

默认模型为 `hongyun-astra/gpt-6-astra`（OpenAI Responses 协议），推理强度为 medium；可在 Web 中改选 `hongyun-opus/claude-opus-5-5`（Anthropic Messages 协议）。两者都是本 patch 声明、指向 Hongyun 中转的 `llm-pi-ai` 路由。API key 取自启动进程的 `ERRGRIND_RELAY_OPENAI_API_KEY` 与 `ERRGRIND_RELAY_ANTHROPIC_API_KEY` 环境变量；patch 不保存 key，Web UI 也不提供登录或添加 provider 的入口。

## 构建与启动

先运行 `corepack pnpm run errgrind:build` 构建源码，再运行 `npm run errgrind:start` 启动产品。此构建在限定 Node 堆内存的情况下检查各包的 TypeScript 引用项目，并生成 native、Host、Client 和 Web 产物；它不执行根级 TypeScript 汇总项目，这些由 `corepack pnpm run typecheck` 作为独立门禁执行。它输出 ErrGrind 浏览器标题、manifest 和图标；普通 `build` 命令仍保留 DSH 品牌。产品构建成功后，本地只修改 Web 品牌时可运行 `corepack pnpm run errgrind:build:web`，它只更新 Web 资源，不生成完整客户端构建记录。启动器使用 `ERRGRIND_HOME`（默认 `~/.errgrind`）和 fork patch 的绝对路径，不会导入旧数据库或凭据。只有调试底层 DSH 启动器时，才使用隔离的 `DSH_HOME`，并从仓库根目录运行 `corepack pnpm dsh --profile web --patch errgrind-fork/web.patch.yml --no-open`。

模型可见的 ErrGrind 指导集中在 `prompts/system.md` 和 `prompts/tools.json`；修改后重启 Web。可执行 schema 与校验仍在 `packages/core/errgrind-episode/src/index.ts` 和 `src/drill.ts`。若启动目录不是仓库根目录，把 `ERRGRIND_PROMPT_PATH` 设为 system prompt 的绝对路径；插件默认从同一目录加载 `tools.json`，也可用 `ERRGRIND_TOOL_PROMPTS_PATH` 覆盖。

## 文档

- [产品契约](design/product-contract.md)：当前流程、Evidence、隐私和持久化规则。
- [产品待办](todo.md)：进度、已完成验证和剩余工作的唯一记录，包括真实模型验收和构建测量。
- [真人验收计划](design/human-acceptance.md)：需要真人学习者完成的检查；真实模型验收不能代替这些检查。
- [设计索引](design/README.zh.md)：工程规则、审计、评估结论和研究。
- [本地迁移清单](history/python-product-2026-09-27/inventory.md)：原始 fork 决策及全部前驱设计、agent 指令、进度和 Prompt 来源。fork 早期的历史交接在 [history/handoffs](history/handoffs/2026-09-23.md)。

Git 历史记录了准确的 DeepSeek Harness 基点；本 fork 遵循上游 MIT 许可。
