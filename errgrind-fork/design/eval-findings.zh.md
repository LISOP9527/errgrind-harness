# 评估与验收结论（2026-10-01）

[English](eval-findings.md) | 中文

[产品待办](../todo.md)中五项评估与验收的结果：一次聚焦的 Spec/Draft 提示词评估、Judge 判定拆分分析（不改 schema——该项明确禁止自动批准）、旧 Drill UX 考古、Settings 验收、以及基于真实会话日志的用量核算。

## Spec 与 Draft 提示词指引——通过

方法：在 `hongyun-astra` 上重放模型真实可见的上下文——`prompts/system.md` + `prompts/tools.json` 中 `drill_prepare` 的逐字工具契约 + 压缩的已结论 episode 摘要——然后按 `drill.ts` 逐字节一致的隔离 Draft 调用（system = `prompts/drill-draft.md`，user = `JSON.stringify(spec)`）。三个 episode：椭圆题漏乘常数项、平方展开交叉项、不等式变号。

- **target behavior 必要**：三个检查点都落在缺失步骤（乘、展开、变号）这个必经节点上。
- **successSignal 可观察**：全部是学生可写出、可核对的痕迹。
- **题目/答案一致**：人工核验（x=18；60 ㎡；5<t<8）。
- **充分条件**：每个 spec 都带明确接受条件和取值窗口。
- **换皮**：账单、矩形面积、水箱三种表面，均不复用原题表面。
- **推理/载量拆分**：深度 2，认知载量 1–2，全程小整数。
- 题目文本中无 mechanism、success-signal、诊断词泄漏。

注意：单一路由（仅 astra）、每例单样本、episode 输入是构造的摘要而非真实 Grill 笔录，`rejectSourceLeak` 未做对抗性压力测试。

## Judge 判定拆分——风险已记录，不改 schema

当前契约：`drill_judge` 返回 `{isCorrect, feedback}`；工具提示词告知模型"机制证据不足不是数学失败、不得仅凭此衍生 Error"。Python 旧产品在同布尔里同时判断数学正确性与信号证据（"无法观察到信号判为错误"）。

风险：布尔值无处安放"数学对、机制证据未观察到"的情形——模型只能四舍五入成 true（丢掉证据缺失标记）或 false（衍生 Error——违反策略）。提示词缓解但无法确定性地编码该拆分。

下次动 Judge 时的选项（schema 变更需明确批准——本次未改）：

- **(a) 保留布尔**——现状；策略靠提示词承载。
- **(b) 拆分字段**——`mathCorrectness` + `mechanismObserved`；仅在数学错且证据在场时衍生 Error。
- **(c) 三态**——`correct | wrong | evidenceInsufficient`；表达力更强，UI 面更大。

建议：**(b)**。保留原子化衍生语义的同时，让"证据不足"成为一等可记录结果，而不是一次取整决定。

## 旧 Drill UX 考古——保留清单

来自 `errgrind/cli/commands.py` 与 `errgrind/application/drill.py`：

- **`/drills` 历史面**（题目 + 目标 Pattern 五字段 + "不代表已确认的长期 Pattern" 声明 + prompt/schema SHA-256）：fork 目前没有 drill 历史面。列入保留清单——episode 卡片的历史段是天然落点。
- **判定-only 弹窗**：旧 drill 弹窗只显示 正确/错误；feedback 存入 `drill_attempts` 但不展示。fork 在笔录中持久渲染 verdict + feedback——有意的分歧，保留（feedback 正是"证据不足"细微差别所在）。
- **原子尝试记录**：旧 `record_drill_attempt` 在同一事务内写尝试与衍生 Error；fork 的 `errgrind/drill-judged` 事件在同一事件中携带 `derivedError`。原子性等价保留。
- **Judge 溯源**：旧版在尝试上存 provider + model + prompt-sha256 + schema-sha256。fork 在事件上存 provider + model；提示词和 schema 版本化于 `prompts/tools.json`，版本溯源经仓库解析。可接受——提示词在版本控制下无需逐次 sha。

## Settings 验收——通过，已落地一处修复

- **凭据不回显**：credentials controller 只投影 `{configured, source, writable}`；`set` 只写（`packages/api/settings-controller/src/credentials.ts`，`projectCredentialInfo`）。
- **不交叉使用**：按路由 `apiKeyEnv`；astra/opus 两把 key 是独立引用——此前的真实 AUTH 失败已证明隔离。
- **已保存状态**：`describe` + ModelsSection 展示 configured 状态（去品牌批 1 浏览器验证）。
- **陈旧草稿防护**：`ProviderEditor` 拒绝以旧 revision 打开的草稿写入（operations 中的 `expectedRevision`）。
- **目录失效回退**：`defaultWorkspaceDirectory` 解析 `Documents/deepseek-harness/ErrGrind`；Documents 查询失败或被禁用会抛错 → `defaultWorkspaceFailed` toast → “选择工作区” picker。该恢复路径此前被 G6 `directory-picker` 移除打断——`remote.directoryPicker` 按名字解析该插件，picker 打开的是空菜单。该移除行已回退并更正审计文档。

## 用量核算——通过

在 `session-8e1ffc5b…` 验收日志上做了逐条验证——三份运行中只有它完成了完整成功流程；下列凡依赖事件 schema 而非实际日志观察的条目均已标注。

- **阶段可区分**：每条 `assistant/message` 都有逐步 `usage`（input/output/total/cacheRead），步骤上的工具调用标识 Record/Grill/Teach/Drill 阶段；隔离 Draft 调用在 `errgrind/drill-draft-finished` 上单独报告用量。
- **失败可区分**：`drill-draft-finished.status`（`success|failed|aborted`）与 `turn/end` 原因类别。
- **修复/重试**（按 retry/step 事件 schema 推断——已验证日志中未观察到重试）：重试应落为额外步骤、各带自身用量；无显式修复标记——工具调用重复应是信号。
- **缓存**：中继报告时 `cacheReadTokens` 逐次记录。观察到的行为：hongyun 在会话中段停止上报缓存命中（turns 7–9 约 25k-token 上下文无 `cacheReadTokens`）——是真人测试"缓存用量"项的一个数据点。
- **缺失用量**：provider 不上报时 `usage` 字段缺省（schema 设计上可空）。
- **隐私**：日志中零凭据材料——无 key 值、无 `Bearer`/`apiKey` 字符串；`request/header` 只记配置（provider、model、effort、maxTokens）与工具名。
