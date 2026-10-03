# ErrGrind 工程原则

ErrGrind 的独特价值在 Error / Evidence / diagnosis / intervention 的产品与认识论结构，不在重复实现通用基础设施。

**先判断目标，再判断实现路径。** 对任何非平凡方案，不要把用户提出的实现路径直接当成已选定方案。先还原真正目标与约束，再判断当前路径是否合理；主动检查项目已有能力、成熟实现/组件、标准方案、更简单的替代路径，以及可能被忽略的高杠杆决策。如果当前方案会造成明显不必要的复杂度、重复劳动或长期成本，应在实施前指出并选择更好的路径，而不是机械执行。不要假设用户熟悉工程生态；用户没有提出某个方案，不能视为该方案不存在。

**执行中的层级切换。** 开始搜索、编码或适配后，仍把当前实现路径视为待验证的方案，而不是新增的硬约束。如果选型或跨模块集成不断需要绕路、额外适配或重复逻辑，先检查自己是否在维护最初选定的实现，而非直接实现产品目标；必要时回到职责划分或技术路线层面，比较调整现有边界与继续局部修补的总成本。发现更合理的方向时主动调整计划，不等用户提出。简单、低风险且可逆的局部任务直接执行，不要机械增加架构审查。

完成这一步后，再判断问题属于哪一类：

- **产品 / domain semantics**：例如 Error、Grill、Teach、Drill、Evidence 边界与用户心智模型。这些必须由 ErrGrind 自己定义，不能因为某个框架已有 thread、memory、agent、course 等概念就迁就它。
- **commodity engineering**：例如 chat composer、附件、滚动、Markdown/LaTeX、安全上传、streaming、auth、缓存、retrieval、agent runtime 等。实现非平凡版本前，先检查项目已有能力、标准库/协议和成熟开源实现，再比较 reuse / adapt / fork / build。
- **research uncertainty**：机制是否有效、某种 Evidence 是否有诊断价值、Policy 是否改善学习等。先做可证伪的小实验和真实使用，不用工程复杂度替代证据。

遵守以下规则：

- **Search before build.** 对新的非平凡基础设施或 UI primitive，默认先做一次有针对性的生态检查。若仍选择自建，应能说明现成方案为何不适配、集成成本为何更高或会破坏产品边界。
- **Reuse implementations aggressively; import ontologies conservatively.** 可以大胆复用成熟实现，但框架必须适配 ErrGrind，而不是让 ErrGrind 的 domain model 适配框架。完整产品型框架尤其要警惕其信息架构和对象模型反向绑架产品。这里的“适配 ErrGrind”指遵守产品目标与 domain 不变量，不表示必须保持当前 Core 的模块边界，或让候选 Agent 单方面适配现有 Application。
- **比较总成本，不比较“有没有轮子”。** 引入第三方方案时同时计算迁移、构建链、运行依赖、安全面、测试、升级和退出成本；已有实现接近完成时，不因发现新框架就自动重写。
- **把模型调用当作昂贵且有损的 I/O。** 已有结构化状态应尽量结构化传递；避免 `structured state → prose summary → another LLM re-derivation` 这类无必要 round-trip。新增模型调用前先问：是否已有数据可直接复用，是否会丢出处 / uncertainty，是否只是用 token 替代普通程序逻辑。
- **保留出处和事实来源。** 用户行为、模型解释、派生摘要、附件、OCR/vision 结果和系统推断必须保持来源可区分；任何 transformation 都不能把模型生成内容伪装成用户 Evidence。
- **重复 workaround 是缺失 contract 的信号。** 如果多个 frontend 需要同一逻辑，或 adapter 为同一个 Core 限制反复打补丁，应优先补 Core/domain contract，而不是继续堆 Web/CLI 特例。
- **真实数据优先于漂亮 fixture。** 新 UI、恢复路径、长文本、数学渲染和状态流转至少用一个真实或足够脏/长的代表案例验收；短 fake fixture 通过不等于产品可用。
- **Implementation surface 不等于 product surface。** CLI command、数据库表、状态枚举、API endpoint、内部 pipeline stage 都只是实现能力或 contract，不能默认一一映射成页面、导航、tab 或用户心智模型。新 frontend 应先从用户对象、任务与动作设计信息架构，再映射到底层能力。
- **Measure before optimize.** 对 token、latency、context growth、provider 成本和性能的优化，优先基于 usage telemetry、真实 trace 和代表性工作流；不要仅凭直觉增加 cache、summary、压缩层或额外模型调用。
- **按可逆性分配设计成本。** CSS/文案等低成本决策可以快速试；schema、ontology、framework/runtime、Evidence contract 等高切换成本决策应先搜索、做小实验并记录依据。不要为了“未来可能需要”提前冻结复杂抽象。

## 在 Harness 中执行

当前产品语义以[产品契约](product-contract.md)为准；Harness 基础设施、包边界、持久格式和文档规则分别遵守[根指令](../../AGENTS.md)、[包指令](../../packages/AGENTS.md)及[文档标准](../../docs/AGENTS.md)。旧 Python Application、SQLite schema、CLI Ctrl+C/EOF 和 unittest 命令不是本 fork 的接口要求。

Core 的业务规则不依赖浏览器组件或渲染对象；跨层传递结构化结果。前端负责输入、呈现、确认和进度，通过 Core 的业务操作推进调查，不直接拼接存储和模型调用。已接收的用户输入必须在可失败的模型调用前持久化；中断和失败不得丢失已保存的调查。只对可重试瞬态故障做有限重试；已有可见流式输出后，不自动重放整个请求。避免没有现实消费者的抽象层。

业务改动优先检查 Core 的可执行规则，再验证真实组合中的入口、传输、恢复和可见结果。标准 Markdown/LaTeX 保留在数据中，由展示层适配；不能把降级显示结果写回原始内容。对用户使用清晰中文；注释解释必要原因和约束。

适用于多项目的委派规则继续有效：实质任务有独立、明确子任务且可能降低上下文或总成本时，使用原生 Codex 子 agent；简单检索、机械工作可选较便宜且实际可用的模型。上下文只提供相关路径、限制和产出，要求简明结果、文件引用和不确定项；不假定并行或低价模型必然节约成本。产品、架构、安全、整合、命令验证与最终结论由主 agent 负责。Antigravity 是独立的文件编辑执行器，按其 skill 由主 agent 直接调用，保留 file-only guard；不得套在 Codex 子 agent 中或让它运行命令、再委派。不要为琐碎或紧密依赖的工作增加委派成本。

设计的当前入口是[设计索引](README.md)。修改产品决定时同步其主题文件和索引；长期提案保留明确的未实现状态，历史决策保留来源与替代关系。Harness 共享基础设施的决策记录按其 Agent Notes 规则放置。源码说明实际运行事实，当前主题设计及适用决策说明约束；旧资料快照只用于解释来源，不覆盖当前契约。
