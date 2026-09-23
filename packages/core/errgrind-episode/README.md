---
description: "The session-backed authentic Error input, verbatim attachment facts, reviewed draft, controlled Grill diagnostic ledger, and human confirmation commands."
kind: "package-reference"
---

# @errgrind/episode

English | [中文](README.zh.md)

## Summary

`@errgrind/episode` records authentic Error inputs and verbatim original attachments in a session projection, allows the agent to draft a complete Error description with `error_draft`, conducts Grill diagnosis with `grill_probe` and `grill_conclude`, and enforces human confirmation via `/error-confirm`. Diagnostic conclusions require an explicitly confirmed Error draft; post-conclusion draft amendments mark the diagnosis stale until re-evaluated; after the revised description is confirmed, re-probing starts a new ledger and keeps the old one in `diagnosisHistory`. The package distinguishes direct user input from host relays and provides `/error-status` to inspect episode state.

## Event flow

On an entered agent step, the plugin inspects the claimed user-sourced message before the model call. If text or attachments are present and no episode is open, it appends `errgrind/error-open` with the text, turn, provenance (`direct_user` or `host_relay`), and SHA-256 attachment records. When the host attachments service is mounted, original image bytes require a durable `saveFile` receipt before normalization. Upload fails if `saveFile` fails; an initial Error message without that receipt cannot open an episode. Normalized image refs carry the exact original receipt (`errgrindOriginal`), and batch validation precedes writes. A `LocalAttachmentStore` integration test covers prompt admission, the committed receipt, and a cold read of the original bytes; the full Web RPC path remains untested.

The registered `errgrindEpisode` projection folds `errgrind/error-open`, `errgrind/error-draft`, `errgrind/error-confirm`, `errgrind/grill-probe`, `errgrind/grill-conclude`, and grounding excerpts from `user/message`. It maintains the authentic first input, attachment references, provenance, description draft, confirmed revision, `diagnosisHistory`, `evidenceSources`, and the active `DiagnosticLedger`. Each user answer belongs to a diagnosis round, so a re-probe cannot reuse an answer from an earlier ledger even when probe IDs repeat. Unrelated events preserve the existing projection state.

The `error_draft` tool accepts one complete description (1–12,000 characters), increments the draft revision, clears previous confirmation, and marks any concluded diagnosis as stale if the anchored revision is changed. The user confirms the current revision using `/error-confirm`. A correction after conclusion marks the diagnosis stale; after the revised description is confirmed, re-probing starts a new ledger and keeps the old one in `diagnosisHistory`.

During Grill, the agent can call `grill_probe` to record a question and candidate hypotheses. Probe metadata carries internal predictions and variant problem answer keys. Host `presentCall` returns only the question, but the current DSH Web session-controller sends raw Session events and assistant tool-call arguments to the browser, so the generic Web card can expose those fields. Evidence sources are derived from `user/message` events. Concluding diagnosis requires an explicitly confirmed Error draft; `grill_conclude` records either `supported` (with a best hypothesis) or `undetermined` (with explicit remaining uncertainty). A `supported` diagnosis requires evidence tied to an actual user response to a probe, with a quote matching the source text. This guards transcript linkage; it does not establish the causal diagnosis.

## Human Commands

- `/error-confirm` — Confirms the current Error description revision. Fails if no draft exists, arguments are passed, or the revision was already confirmed.
- `/error-status` — Displays the episode provenance, original input size, attachment hashes, draft confirmation status, diagnosis conclusion, and ledger counts.

## Session projection

The session log is the durable source of truth for all episode state. The projection uses state version `3`, starts at `null`, and is deterministically reconstructed by folding committed session events. Calling `currentEpisode` fails explicitly if the projection service or registered key is unavailable.

There is no `./invariant` export: the fold checks the owned event transitions, and this package owns no relation to a second service or store.

## Model Experience

### Diagnostic tools and session conversation

#### What the model sees

The package registers no system prompt. When enabled, the model sees `error_draft`, `grill_probe`, and `grill_conclude` tool schemas and descriptions. Discriminative probe calls keep expected observations and answer keys inside tool arguments, and the tool card presentation configures `rawInput` to show only the question. However, the current DSH Web session-controller delivers raw session events and tool-call arguments to the browser client, so probe predictions and answer keys are not hidden on the wire.

#### Token effect

The tool schemas contribute tokens on requests where the host exposes them. Grill probes and evidence records append structured findings to the session log, allowing multi-turn diagnosis without duplicate context re-injection.

#### KV Cache effect

Tool descriptions and schemas are static, preserving request prefix stability while preceding context remains unchanged. Probe and conclusion events are append-only.

## Known Limitations and Deferred Work

- **Privacy blocker on web client inspection** — The `errgrindEpisode` projection is host-only, but the DSH Web session-controller sends raw Session events, assistant streams, and tool-call arguments to the browser. Therefore `grill_probe` predictions and `answerKey` are not hidden from the browser or generic tool cards; this is a blocker before user-facing testing.
- **Full Web image path untested** — A real `LocalAttachmentStore` integration test verifies prompt admission and original-byte recovery after cold reopen; browser RPC upload and reconnect remain untested.
- **Product flow and mobile acceptance deferred** — There is no complete Record/Grill/Teach/Drill flow or mobile acceptance yet; subsequent pedagogical intervention, practice generation, and dedicated mobile/web Error card UI remain deferred.
- **Live cache read tokens unmeasured** — Request prefix stability is designed statically, but empirical `cacheReadTokens` verification requires a live model key; no real model cache-hit data exists yet.
- **Python legacy migration deferred** — Error #8 and SQLite historical records remain read-only reference data; database migration is not implemented.
