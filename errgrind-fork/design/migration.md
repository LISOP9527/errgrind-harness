# 旧产品资料迁移与权威归属

本文件的范围是旧仓库的 `design/`、`AGENTS.md`、`todo.md`、`prompts/`。Harness 是后续主工作区；下列现行资料和历史依据均在本仓库内，不依赖旧目录、外部 symlink 或旧 Python 安装。资料迁移不等于旧业务数据导入、所有功能迁移或真人验收完成。

## 阅读与维护顺序

1. [产品契约](product-contract.md)定义当前数学 MVP、连续调查、版本确认、来源、隐私与 Drill 规则。
2. [工程原则](engineering-principles.md)承接旧 agent 指令的可复用部分；[根指令](../../AGENTS.md)及 Harness 各级指令约束实际实现。
3. [产品待办](../todo.md)是当前进度入口；[真人验收](human-acceptance.zh.md)保留尚未验证的产品质量，不继承旧 Python 测试结果。
4. [长期设计](README.md)中的研究文档保留完整提案、边界和实验方法，不自动授权 Pattern、Policy 或多领域实现。
5. [历史资料清单](../history/python-product-2026-09-27/inventory.md)提供每个旧文件的本地原文、校验清单和承接位置。

## Design 的处置

核心原则、长期架构、Pattern State 提案、效果验证策略和版本规划在 `research/` 完整保留，并把旧 Python/SQLite/CLI 实现与当前 Harness 区分。四层效果判断、盲法独立诊断后关联、学习机会分母、独立事件去重、冻结 revision、反例和研究门槛均保留。当前产品与长期研究不是两套运行权威。

所有旧 ADR 原文保存在历史清单中，包括 fork 选型理由，不要求回旧库查阅。主动诊断、回顾性 Evidence、来源与干预账本、Spec/Draft 隔离的原则由当前产品契约及 Prompt 承接；具体 JSON delta、SQL 表、CLI 命令、app-server/直接 Responses 路由和 React/Jinja 交互属于旧实现，不移植为 Harness 强制接口。终端降级不污染 Markdown/LaTeX 的原则由工程原则承接。长期 Pattern 的延期决策仍有效。

旧 Settings 的模型目录真实性、凭据保护和失败回退，以及历史 Drill 目标查询、最小判分呈现等产品要求仍可在本地 ADR 找到；新代码不因归档而被宣称已实现这些细节。需要比对的能力列在当前待办。特别是旧即时判分只显示对错，与新卡片/反馈的呈现可能不同，不能默默认定等价。

## AGENTS 与 todo 的处置

保留先判断目标与实现路径、反复 workaround 时回到职责划分、区分 domain/commodity/research、先搜索再构建、总成本、结构化状态优先、来源、真实代表案例、产品界面不照搬内部结构、先测量再优化和按可逆性分配设计成本。也保留适用的委派规则、中文交互、输入先持久化、有限重试及不重放已产生输出的请求等约束。

旧状态枚举、Ctrl+C 按键、Python 异常形式、SQLite 权威和旧测试命令仅描述前驱。旧 todo 是带时间的实现与验证记录，完整归档；它的完成项不会被复制成 Harness 完成项。仍需验证的质量、能力差异和长期计划进入新待办及 research 文档。已有新待办条目保留，不重置其他工作进展。

## Prompt 的处置

实际模型入口只有当前 [system.md](../prompts/system.md)、[tools.json](../prompts/tools.json)和隔离 Draft 的 [drill-draft.md](../prompts/drill-draft.md)，加载方式见 [Prompt 说明](../prompts/README.md)。九份旧 Prompt 都有原文字节快照；三字段 Record、旧 sourceRef 命名、独立 OCR JSON、旧 Grill delta 和固定 Teach 讲课格式不再加载。

迁移补齐 Draft 对目标行为可观察、中性推理要求、明确验收条件和静默题答自检的要求；它们仍属于单次隔离 Draft，不增加 Guard/Review/Audit 模型链。Spec 补留改变表面结构、难度与源题可比及计算量不替代推理难度。Probe 补留预测精确覆盖目标和诊断允许附带学习效果的要求。预测覆盖当前仍是 Prompt 要求，不能声称已有确定性 Core 覆盖校验。

旧 Judge 把正确但机制证据不足也判错的规则已被现行契约否定，不恢复。当前 boolean Judge 尚不能独立记录 `math_status` 与 `mechanism_evidence`；长期设计保留此缺口。图片答案必须先核对再 Judge，旧 OCR 的不猜测、不伪造原话原则继续生效。

## 完成边界

资料在本地独立可读，不等于已提交或已推送。旧源码、Git 完整历史、用户数据库、附件、认证和外部参考技能不是这次资料迁移的备份范围。数据导入、MCP、真人闭环和 reviewer 流程仍按当前待办及后续授权处理。

历史 fork ADR 中的精确基点标识属于不可改写的选型证据。仓库引用检查仅对这一个快照的精确路径和 SHA-256 内容提供例外；修改其字节或复制到其他文件仍按普通规则检查，不排除整个归档目录。

本轮检查结果与全仓未通过项见[迁移验证记录](../history/python-product-2026-09-27/verification.md)。
