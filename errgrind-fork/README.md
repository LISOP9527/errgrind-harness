# ErrGrind Web composition

English | [中文](README.zh.md)

This patch starts the fork's first Web composition without the shipped coding presets, model-facing shell or filesystem tools, and coding-specific browser panels. It retains the upstream session, attachment, model, and chat infrastructure for evaluation. The upstream workspace selector and session UI remain until the Error episode UI is implemented.

Build the source checkout using the repository's documented `pnpm run build` command. Set an isolated `DSH_HOME` for this evaluation, then run `pnpm dsh --profile web --patch errgrind-fork/web.patch.yml --no-open` from the repository root. The patch does not implement Error recording, diagnosis, Teach, Drill, or an MCP server. Do not use the chat transcript from this composition as ErrGrind business evidence.

The product and shared Core decision is recorded in the ErrGrind repository at `design/decisions/2026-09-23-error-episode-and-agent-fork.md`. Git history records the exact DeepSeek Harness base; the upstream MIT license applies.

## Initial smoke check (2026-09-23)

The upstream build and patched Web startup passed locally. The expanded config contains only `persona` in `preset-standard` and disables the coding presets and panels listed in the patch. A token-protected local page loaded in Chromium at 1280×800 and 390×844.

The rendered page still has a workspace selector, coding-oriented composer text, a "Workspace Write" permission label, DeepSeek onboarding, and upstream branding. Those are concrete UI migration tasks. Config composition alone does not prove that the underlying tool and permission surface is closed, and no Error workflow or model call has been validated yet.
