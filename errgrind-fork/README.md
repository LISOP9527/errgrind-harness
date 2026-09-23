# ErrGrind Web composition

English | [中文](README.zh.md)

This patch starts the fork's first Web composition and inserts `@errgrind/episode`. The standard preset retains its basic compaction behavior and `/compact` command. The package records the first user-sourced input in the session, lets the model save a complete `error_draft`, and lets the user confirm the current draft with `/error-confirm`.

The Web composition still retains upstream session, attachment, model, and chat infrastructure. It also retains the upstream workspace selector and session UI; the Error episode UI card and ownership of original image evidence are not implemented. Image input is not yet durable ErrGrind evidence.

Build the source checkout using the repository's documented `pnpm run build` command. Set an isolated `DSH_HOME` for this evaluation, then run `pnpm dsh --profile web --patch errgrind-fork/web.patch.yml --no-open` from the repository root. These instructions launch the current partial composition; they do not imply completion or validation of the full Error workflow. Do not use the chat transcript from this composition as ErrGrind business evidence.

The product and shared Core decision is recorded in the ErrGrind repository at `design/decisions/2026-09-23-error-episode-and-agent-fork.md`. Git history records the exact DeepSeek Harness base; the upstream MIT license applies.

## Current milestone

The current slice covers first-input capture, a model-authored description draft, and explicit human confirmation. Draft confirmation does not complete or validate an Error investigation.

Full Record, Grill, Teach, and Drill behavior remains pending, as do the Error episode UI card, original image ownership, and MCP support. Real-case workflow, model, and mobile validation are also pending. The existing Web shell still exposes upstream workspace and session UI, coding-oriented composer text, a "Workspace Write" permission label, DeepSeek onboarding, and upstream branding; configuration alone does not prove that the underlying tool and permission surface is closed.
