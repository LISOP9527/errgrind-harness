# ErrGrind Web composition

English | [中文](README.zh.md)

This patch starts the fork's first Web composition and inserts `@errgrind/episode`. The standard preset retains its basic compaction behavior and `/compact` command. The package records the first user-sourced input in the session, lets the model save a complete `error_draft`, lets the user confirm the current draft with `/error-confirm`, conducts controlled Grill diagnosis with `grill_probe` and `grill_conclude`, and exposes `/error-status`.

The Web composition retains upstream session, attachment, model, and chat infrastructure, as well as the upstream workspace selector and session UI. Original image bytes now require a durable `saveFile` receipt; upload fails if that save fails, and an image in the first Error message cannot open an episode without a receipt. Normalized image refs carry the exact original receipt, and batch validation precedes writes. A real `LocalAttachmentStore` test verifies prompt admission and cold recovery of the original bytes; browser RPC upload and reconnect remain untested. A dedicated Error episode UI card is not implemented.

Build the source checkout using the repository's documented `pnpm run build` command. Set an isolated `DSH_HOME` for this evaluation, then run `pnpm dsh --profile web --patch errgrind-fork/web.patch.yml --no-open` from the repository root. These instructions launch the current partial composition; they do not imply completion or validation of the full Error workflow. Only Core-validated, source-linked observations may become diagnostic Evidence; a chat transcript alone is not a diagnosis.

The product and shared Core decision is recorded in the ErrGrind repository at `design/decisions/2026-09-23-error-episode-and-agent-fork.md`. Git history records the exact DeepSeek Harness base; the upstream MIT license applies.

## Current milestone

The current slice covers authentic first-input capture with durable `saveFile` image receipts, model-authored description drafting (`error_draft`), explicit human confirmation (`/error-confirm`), and Grill diagnosis (`grill_probe` and `grill_conclude`). Evidence sources are derived from `user/message` events; a supported diagnosis requires evidence tied to an actual user response to a probe, with quotes matching source text and the current diagnosis round. This is a code guard enforcing transcript grounding, not a claim that the causal diagnosis is scientifically proven. A correction after conclusion marks the diagnosis stale; after the revised description is confirmed, re-probing starts a new ledger and keeps the old one in `diagnosisHistory`. The projection state version is 3. Draft confirmation alone does not complete or validate an Error investigation.

Privacy blocker: The `errgrindEpisode` projection is host-only, but the current DSH Web session-controller sends raw Session events, assistant streams, and tool-call arguments to the browser. Therefore `grill_probe` predictions and `answerKey` are visible to the browser and may appear in generic tool cards. This must be resolved before user-facing testing.

There is no complete Record/Grill/Teach/Drill flow, mobile acceptance, real model cache-hit data, or database migration yet. MCP support remains pending. The existing Web shell still exposes upstream workspace and session UI, coding-oriented composer text, a "Workspace Write" permission label, DeepSeek onboarding, and upstream branding; configuration alone does not prove that the underlying tool and permission surface is closed.
