# ErrGrind fork 设计

[English](README.md) | 中文

这里是主工作区 Harness 的设计入口。当前产品规则、研究提案和历史来源各有明确范围。

- [产品契约](product-contract.md)：当前数学调查、Evidence、确认、干预、隐私和持久化规则。
- [工程原则](engineering-principles.md)：可复用的项目与 agent 工作规则；Harness 基础设施指令仍然适用。
- [产品待办](../todo.md)与[真人验收](human-acceptance.md)：当前工作和未验证的产品质量。
- [迁移归属](migration.md)与[来源清单](../history/python-product-2026-09-27/inventory.md)：不依赖旧工作区的本地权威和完整原文保存。
- [DSH 痕迹盘点](debrand-inventory.md)：用户可见的 DeepSeek/DSH 残留及逐项处理路径。
- [已挂载插件必要性审计](plugin-audit.md)：105 个挂载条目的六字段审计与 G1–G8 删除分组。

## 研究与路线图

这些文档保留原则和推迟的提案，不表示长期 Pattern State、自适应 Policy 或多领域支持已经实现或获得实施授权。

- [核心原则](research/core-principles.md)：Error、Evidence、诊断、干预与未来 Error 减少。
- [长期架构](research/long-term-architecture.md)：Evidence → State → Policy → Action → New Evidence。
- [Pattern State 提案](research/pattern-state-proposal.md)：观察、候选、独立证据、版本和可证伪性。
- [验证策略](research/evaluation-strategy.md)：诊断质量、盲法关联、学习机会分母和效果声明限制。
- [版本规划](research/version-plan.md)：V1 可靠性与可用性、MCP 共享 Core 和推迟的 V2 研究。

产品决策变化时同步其主题文档和本索引。保留替代关系及历史理由；共享基础设施决策遵守 Harness 文档规则。
