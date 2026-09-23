---
description: "The session-backed authentic Error input, verbatim attachment facts, reviewed draft, controlled Grill diagnostic ledger, and human confirmation commands."
kind: "package-reference"
---

# @errgrind/episode

English | [中文](README.zh.md)

## Summary

`@errgrind/episode` records authentic Error inputs and verbatim original attachments in a session projection, allows the agent to draft a complete Error description with `error_draft`, conducts controlled Grill diagnosis with `grill_probe` and `grill_conclude`, and enforces human confirmation via `/error-confirm`. Diagnostic conclusions require an explicitly confirmed Error draft; post-conclusion draft amendments mark the diagnosis stale until re-evaluated. The package distinguishes direct user input from host relays and provides `/error-status` to inspect episode state.

## Event flow

On an entered agent step, the plugin inspects the claimed user-sourced message before the model call. If text or attachments are present and no episode is open, it appends `errgrind/error-open` with the text, turn, provenance (`direct_user` or `host_relay`), and SHA-256 attachment records. When the host attachments service is mounted, original image bytes are saved via `saveFile` before normalization so the exact verbatim file is durable.

The registered `errgrindEpisode` projection folds `errgrind/error-open`, `errgrind/error-draft`, `errgrind/error-confirm`, `errgrind/grill-probe`, and `errgrind/grill-conclude`. It maintains the authentic first input, attachment references, provenance, description draft, confirmed revision, and a structured `DiagnosticLedger`. Unrelated events preserve the existing projection state.

The `error_draft` tool accepts one complete description (1–12,000 characters), increments the draft revision, clears previous confirmation, and marks any concluded diagnosis as stale if the anchored revision is changed. The user confirms the current revision using `/error-confirm`.

During Grill, the agent poses discriminative probes with `grill_probe` to test competing hypotheses (`H1`, `H2`...). Probe questions are presented in user cards, while predictions and variant problem answer keys remain in probe metadata to prevent leaking answers to the learner. When sufficient evidence (`E1`, `E2`...) is gathered, `grill_conclude` concludes the diagnosis as either `supported` (with a verified best hypothesis) or `undetermined` (with explicit remaining uncertainty). Concluding before draft confirmation is strictly rejected.

## Human Commands

- `/error-confirm` — Confirms the current Error description revision. Fails if no draft exists, arguments are passed, or the revision was already confirmed.
- `/error-status` — Displays the episode provenance, original input size, attachment hashes, draft confirmation status, diagnosis conclusion, and ledger counts.

## Session projection

The session log is the durable source of truth for all episode state. The projection uses state version `1`, starts at `null`, and is deterministically reconstructed by folding committed session events. Calling `currentEpisode` fails explicitly if the projection service or registered key is unavailable.

There is no `./invariant` export: the fold checks the owned event transitions, and this package owns no relation to a second service or store.

## Model Experience

### Diagnostic tools and session conversation

#### What the model sees

The package registers no system prompt. When enabled, the model sees `error_draft`, `grill_probe`, and `grill_conclude` tool schemas and descriptions. Discriminative probe calls keep expected observations and answer keys inside tool arguments; the user card presentation renders only the probe question without answer key leaks.

#### Token effect

The tool schemas contribute tokens on requests where the host exposes them. Grill probes and evidence records append structured findings to the session log, allowing multi-turn diagnosis without duplicate context re-injection.

#### KV Cache effect

Tool descriptions and schemas are static, preserving request prefix stability while preceding context remains unchanged. Probe and conclusion events are append-only.

## Known Limitations and Deferred Work

- **Teach and Drill are deferred** — The package manages Error recording and Grill diagnosis; subsequent pedagogical intervention and practice generation remain for future packages.
- **Card presentation and narrow viewport** — The package provides generic card presenters for tools and CLI status; dedicated mobile and web Error card UI components are deferred.
- **Live cache read tokens unmeasured** — Request prefix stability is designed statically, but empirical `cacheReadTokens` verification requires a live model key.
- **Python legacy migration deferred** — Error #8 and SQLite historical records remain read-only reference data and are not auto-migrated.
