# ErrGrind 运行时 Prompt

[English](README.md) | 中文

当前模型指导由这些文件维护：

- [system.md](system.md)包含跨阶段 episode 规则。Web persona 使用 `ERRGRIND_PROMPT_PATH` 或仓库根目录默认路径。
- [tools.json](tools.json)包含八个 ErrGrind 工具的描述和参数指导。episode 插件从 system prompt 同目录读取，除非 `ERRGRIND_TOOL_PROMPTS_PATH` 指定其他文件。
- [drill-draft.md](drill-draft.md)从所选工具目录文件的同目录加载，用于隔离 Draft 请求。该请求只接收这份 Prompt 和已保存的规格，不接收原始 Error 对话。

修改已加载的指导后重启 Web。稳定内容和顺序便于提供方支持时复用前缀；实际缓存收益需要用量测量。

可执行 schema 和校验器仍定义允许的输入，文字指导不能替代检查：

- [index.ts](../../packages/core/errgrind-episode/src/index.ts)负责 `error_draft`、`error_clarify`、`grill_probe`、`grill_conclude` 和 `teach_step`。
- [drill.ts](../../packages/core/errgrind-episode/src/drill.ts)负责 `drill_prepare`、`drill_answer_draft` 和 `drill_judge`。
- [tool-prompts.ts](../../packages/core/errgrind-episode/src/tool-prompts.ts)负责 Prompt 加载及目录校验。

九份旧 Python Prompt 都以不加载的文本保存在[本地来源清单](../history/python-product-2026-09-27/inventory.md)。旧三字段 Record 和 JSON 协议不覆盖这里的文件。已承接的指导、替代关系和剩余验证工作见[产品契约](../design/product-contract.md)及[迁移归属](../design/migration.md)。
