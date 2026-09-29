# 资料迁移验证记录（2026-09-29）

本记录验证资料迁移及小范围 Prompt 指导补齐，不代表全产品验收、数据导入或发布完成。源文件快照采集于 2026-09-27；两次 continue 后于 2026-09-29 完成整合和复核。

## 已通过

- 43 份原始资料的 SHA-256 与 manifest 及旧工作区逐一一致；旧工作区自迁移开始没有文件变化。
- 所有 manifest 当前归属均位于 Harness 内；快照是普通文件，不是 symlink。现行设计和 Prompt 没有旧目录绝对路径依赖。
- 迁移范围 23 份 Markdown 经仓库 AST 链接校验器检查，路径和标题锚点均有效；另检查 264 个本地链接未逃出仓库。
- 三组已编辑 README 双语配对检查、全仓文档字数检查、`git diff --check` 通过。
- `vitest run packages/core/errgrind-episode/tests/episode.spec.ts packages/core/errgrind-episode/tests/loader-composition.spec.ts packages/core/errgrind-episode/tests/drill-generation.spec.ts packages/core/errgrind-episode/tests/drill.spec.ts`：4 文件、39 测试通过，覆盖实际工具加载、独立 Draft 请求隔离和工作流规则。
- `DSH_SNAPSHOT=replay` 下的 `apps/web/tests/errgrind-multiturn-replay.e2e.ts`：3 测试通过，未调用真实模型。
- `scripts/verify-repository-references.spec.ts`：11 测试通过，含历史 ADR 精确内容例外、内容变化拒绝和路径变化拒绝；改动脚本的定向 oxlint 通过。
- 独立只读复核发现的评估时序遗漏、旧 Judge 语义、派生条件和 Socratic 指导状态均修正并复核。

## 全仓检查的剩余问题

`corepack pnpm run test:docs` 运行完毕：14 项通过，6 项失败。配置目录双语代码块不一致、历史持久格式索引过期、既有交接中的 commit 标识、既有来源术语禁词、UI 包 Model Experience 缺项和包 README 结构缺项仍阻止全仓通过；它们不属于本次资料迁移的实现范围。新增历史快照曾触发 commit 规则，已用精确路径和内容摘要例外解决，定向复测只剩既有交接标识。未以全仓生成器重写其他工作中的目录，也未宣称完整 doc-sync 或全仓 lint 通过。

Prompt 的数学出题质量和诊断效果不能由无密钥回放证明；当前待办保留代表性案例及真人验收。文件仍在工作区，本文不表示提交、推送或外部备份完成。
