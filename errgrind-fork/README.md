# ErrGrind Web composition

English | [中文](README.zh.md)

This directory holds the ErrGrind product composition of the Harness fork. `web.patch.yml` starts the DSH Web profile, inserts `@errgrind/episode`, and disables the coding, browser, and DSH-branded surfaces that the Error workflow does not use. ErrGrind investigates one authentic mathematics Error at a time through Error intake, Grill, Teach, and an isolated Drill; the [product contract](design/product-contract.md) defines that workflow and its Evidence, privacy, and persistence rules.

## Models and keys

The default model is `hongyun-astra/gpt-6-astra` (OpenAI Responses protocol) at medium reasoning effort; `hongyun-opus/claude-opus-5-5` (Anthropic Messages protocol) can be selected in Web. Both are `llm-pi-ai` routes to the Hongyun relay declared in this patch. Their API keys come from the `ERRGRIND_RELAY_OPENAI_API_KEY` and `ERRGRIND_RELAY_ANTHROPIC_API_KEY` environment variables of the launch process; the patch does not store them, and the Web UI provides no sign-in or provider-addition surface.

## Build and launch

Build the source checkout with `corepack pnpm run errgrind:build`, then start the product with `npm run errgrind:start`. The build checks package-level TypeScript references and produces native, Host, Client, and Web artifacts with a bounded Node heap; it skips the root TypeScript aggregate projects, which `corepack pnpm run typecheck` runs as a separate gate. It emits an ErrGrind browser title, manifest, and icon; the ordinary `build` command retains DSH branding. After a successful product build, `corepack pnpm run errgrind:build:web` updates only the Web shell for local branding changes and leaves no complete client build record. The launcher uses `ERRGRIND_HOME` (default `~/.errgrind`) and an absolute fork patch, without importing an old database or credentials. For low-level DSH launcher debugging only, use an isolated `DSH_HOME` with `corepack pnpm dsh --profile web --patch errgrind-fork/web.patch.yml --no-open` from the repository root.

Model-visible ErrGrind guidance is in `prompts/system.md` and `prompts/tools.json`; edit them and restart Web. Executable schemas and validation remain in `packages/core/errgrind-episode/src/index.ts` and `src/drill.ts`. If Web starts outside the repository root, set `ERRGRIND_PROMPT_PATH` to the absolute system prompt path; `tools.json` is loaded from the same directory unless `ERRGRIND_TOOL_PROMPTS_PATH` overrides it.

## Documents

- [Product contract](design/product-contract.md): current workflow, Evidence, privacy, and persistence rules.
- [Product TODO](todo.md): the only record of progress, completed verification, and remaining work, including real-model acceptance and build measurements.
- [Human acceptance plan](design/human-acceptance.md): checks that need a human learner; real-model acceptance does not replace them.
- [Design index](design/README.md): engineering rules, audits, evaluation findings, and research.
- [Local migration inventory](history/python-product-2026-09-27/inventory.md): the original fork decision and all predecessor design, agent, progress, and prompt sources. Historical fork handoffs are in [history/handoffs](history/handoffs/2026-09-23.md).

Git history records the exact DeepSeek Harness base; the upstream MIT license applies.
