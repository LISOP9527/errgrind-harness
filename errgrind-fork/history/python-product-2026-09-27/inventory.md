# Python/React 产品资料快照

本目录保存 2026-09-27 迁移时旧工作区的实际文件内容，包括当时未提交的设计修改。不是运行时依赖、当前 agent 指令或可执行 Prompt。`.md.txt` 后缀保留原文字节，并防止旧 `AGENTS.md` 被当作嵌套指令自动加载。旧文中的路径和链接描述旧仓库，查阅时使用下表定位；它们不要求旧目录存在。

[manifest.json](manifest.json)逐文件保存原路径、SHA-256、当时的源 HEAD 和承接位置。HEAD 不是完整快照内容的标识：实际复制包含未提交修改。共保留 31 份 design 文档、9 份 Prompt、AGENTS、todo，以及为旧设计链接补留的根 README；没有复制数据库、用户附件、配置或凭据，也不声称备份了旧产品源码。

当前规则和迁移结果见[迁移说明](../../design/migration.md)。快照不可作为当前运行行为或测试通过的证据；后续修订写入现行文档，原始快照保持不变。

| 旧路径 | 本地快照 | 处置 | 现行入口 |
| --- | --- | --- | --- |
| `AGENTS.md` | [原文](AGENTS.md.txt) | 通用工作规则承接；Python 专属指令仅归档 | [当前入口](../../design/engineering-principles.md) |
| `README.md` | [原文](README.md.txt) | 历史资料；不作为 Harness 的运行规则 | — |
| `design/README.md` | [原文](design/README.md.txt) | 旧索引归档；现行索引已建立 | [当前入口](../../design/README.md) |
| `design/core-principles.md` | [原文](design/core-principles.md.txt) | 长期设计已完整迁入并标明旧实现范围 | [当前入口](../../design/research/core-principles.md) |
| `design/decisions/2026-07-27-conversation-lifecycle.md` | [原文](design/decisions/2026-07-27-conversation-lifecycle.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-07-27-terminal-content-rendering.md` | [原文](design/decisions/2026-07-27-terminal-content-rendering.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-07-28-drill-spec-isolation.md` | [原文](design/decisions/2026-07-28-drill-spec-isolation.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-08-29-codex-app-server-provider.md` | [原文](design/decisions/2026-08-29-codex-app-server-provider.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-08-31-ocr-as-reviewed-input.md` | [原文](design/decisions/2026-08-31-ocr-as-reviewed-input.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-01-evidence-provenance-drill-ledger.md` | [原文](design/decisions/2026-09-01-evidence-provenance-drill-ledger.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-02-defer-pattern-observation-validation.md` | [原文](design/decisions/2026-09-02-defer-pattern-observation-validation.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-03-application-workflow-boundary.md` | [原文](design/decisions/2026-09-03-application-workflow-boundary.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-04-grill-as-active-diagnosis.md` | [原文](design/decisions/2026-09-04-grill-as-active-diagnosis.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-04-structured-grill-diagnosis-and-variant-probes.md` | [原文](design/decisions/2026-09-04-structured-grill-diagnosis-and-variant-probes.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-05-retrospective-grill-and-post-interference-boundary.md` | [原文](design/decisions/2026-09-05-retrospective-grill-and-post-interference-boundary.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-06-record-field-image-input.md` | [原文](design/decisions/2026-09-06-record-field-image-input.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-07-codex-direct-responses.md` | [原文](design/decisions/2026-09-07-codex-direct-responses.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-08-drill-answer-ocr.md` | [原文](design/decisions/2026-09-08-drill-answer-ocr.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-08-drill-target-query-and-verdict.md` | [原文](design/decisions/2026-09-08-drill-target-query-and-verdict.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-08-model-usage-logging.md` | [原文](design/decisions/2026-09-08-model-usage-logging.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-10-single-workspace-webui.md` | [原文](design/decisions/2026-09-10-single-workspace-webui.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-11-direct-multimodal-web-input.md` | [原文](design/decisions/2026-09-11-direct-multimodal-web-input.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-14-assistant-ui-migration.md` | [原文](design/decisions/2026-09-14-assistant-ui-migration.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-14-assistant-ui-spike.md` | [原文](design/decisions/2026-09-14-assistant-ui-spike.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-14-web-settings.md` | [原文](design/decisions/2026-09-14-web-settings.md.txt) | 保留决策理由；适用原则与实现替代见迁移说明 | [当前入口](../../design/migration.md) |
| `design/decisions/2026-09-23-error-episode-and-agent-fork.md` | [原文](design/decisions/2026-09-23-error-episode-and-agent-fork.md.txt) | 原始 fork 决策保留；后续共同确认规则以当前契约为准 | [当前入口](../../design/product-contract.md) |
| `design/decisions/README.md` | [原文](design/decisions/README.md.txt) | 旧索引归档；现行索引已建立 | [当前入口](../../design/README.md) |
| `design/evaluation-strategy.md` | [原文](design/evaluation-strategy.md.txt) | 长期设计已完整迁入并标明旧实现范围 | [当前入口](../../design/research/evaluation-strategy.md) |
| `design/long-term-architecture.md` | [原文](design/long-term-architecture.md.txt) | 长期设计已完整迁入并标明旧实现范围 | [当前入口](../../design/research/long-term-architecture.md) |
| `design/pattern-state-proposal.md` | [原文](design/pattern-state-proposal.md.txt) | 长期设计已完整迁入并标明旧实现范围 | [当前入口](../../design/research/pattern-state-proposal.md) |
| `design/record-input.md` | [原文](design/record-input.md.txt) | Core/UI 解耦及原始附件来源承接；旧三字段/SQLite 实现仅归档 | [当前入口](../../design/product-contract.md) |
| `design/ui-decoupling.md` | [原文](design/ui-decoupling.md.txt) | Core/UI 解耦及原始附件来源承接；旧三字段/SQLite 实现仅归档 | [当前入口](../../design/product-contract.md) |
| `design/version-plan.md` | [原文](design/version-plan.md.txt) | 长期设计已完整迁入并标明旧实现范围 | [当前入口](../../design/research/version-plan.md) |
| `prompts/drill.md` | [原文](prompts/drill.md.txt) | 按现行 Prompt 迁移表承接或替代；原文不加载 | [当前入口](../../design/product-contract.md) |
| `prompts/drill_spec.md` | [原文](prompts/drill_spec.md.txt) | 按现行 Prompt 迁移表承接或替代；原文不加载 | [当前入口](../../design/product-contract.md) |
| `prompts/grilling.md` | [原文](prompts/grilling.md.txt) | 按现行 Prompt 迁移表承接或替代；原文不加载 | [当前入口](../../design/product-contract.md) |
| `prompts/judge.md` | [原文](prompts/judge.md.txt) | 按现行 Prompt 迁移表承接或替代；原文不加载 | [当前入口](../../design/product-contract.md) |
| `prompts/ocr.md` | [原文](prompts/ocr.md.txt) | 按现行 Prompt 迁移表承接或替代；原文不加载 | [当前入口](../../design/product-contract.md) |
| `prompts/ocr_field.md` | [原文](prompts/ocr_field.md.txt) | 按现行 Prompt 迁移表承接或替代；原文不加载 | [当前入口](../../design/product-contract.md) |
| `prompts/ocr_record_input.md` | [原文](prompts/ocr_record_input.md.txt) | 按现行 Prompt 迁移表承接或替代；原文不加载 | [当前入口](../../design/product-contract.md) |
| `prompts/record_draft.md` | [原文](prompts/record_draft.md.txt) | 按现行 Prompt 迁移表承接或替代；原文不加载 | [当前入口](../../design/product-contract.md) |
| `prompts/teach.md` | [原文](prompts/teach.md.txt) | 按现行 Prompt 迁移表承接或替代；原文不加载 | [当前入口](../../design/product-contract.md) |
| `todo.md` | [原文](todo.md.txt) | 旧验证记录归档；未决质量问题转入现行待办，不继承旧通过结论 | [当前入口](../../todo.md) |
