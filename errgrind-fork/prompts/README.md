# ErrGrind runtime prompts

English | [中文](README.zh.md)

The current model guidance is owned by these files:

- [system.md](system.md) contains the shared episode rules. The Web persona uses `ERRGRIND_PROMPT_PATH` or the repository-root default.
- [tools.json](tools.json) contains the descriptions and parameter guidance for eight ErrGrind tools. The episode plugin reads it beside the system prompt unless `ERRGRIND_TOOL_PROMPTS_PATH` selects another file.
- [drill-draft.md](drill-draft.md) is loaded beside the selected tool catalog for the isolated Draft request. That request receives only this prompt and the saved specification, not the original Error conversation.

Restart Web after editing loaded guidance. Stable content and ordering allow prefix reuse where supported; actual cache benefit requires usage measurements.

Executable schemas and validators still define accepted input; prose does not replace checks:

- [index.ts](../../packages/core/errgrind-episode/src/index.ts) owns `error_draft`, `error_clarify`, `grill_probe`, `grill_conclude`, and `teach_step`.
- [drill.ts](../../packages/core/errgrind-episode/src/drill.ts) owns `drill_prepare`, `drill_answer_draft`, and `drill_judge`.
- [tool-prompts.ts](../../packages/core/errgrind-episode/src/tool-prompts.ts) owns prompt loading and catalog validation.

All nine Python prompts are preserved as non-loaded text in the [local source inventory](../history/python-product-2026-09-27/inventory.md). Their old three-field Record and JSON protocols do not override these files. See the [product contract](../design/product-contract.md) and [migration disposition](../design/migration.md) for retained guidance, replacements, and remaining validation work.
