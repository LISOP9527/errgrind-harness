---
description: "The session-backed authentic Error input, verbatim attachment facts, reviewed draft, controlled Grill diagnostic ledger, and human confirmation commands."
kind: "package-reference"
---

# @errgrind/episode

English | [中文](README.zh.md)

## Summary

`@errgrind/episode` records authentic Error inputs and verbatim original attachments in a session projection, supports visible intake clarification, Error drafting and confirmation, Grill diagnosis, public Teach steps, and independent Drill attempts. Teach and Drill are interventions, not evidence about what caused the original Error. The original Error draft is locked once Teach starts. The package distinguishes direct user input from host relays and provides `/error-status` to inspect episode state.

## Table of Contents

- [Event flow](#event-flow)
- [Human Commands](#human-commands)
- [Session projection](#session-projection)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="event-flow"></a>
## Event flow

On an entered agent step, the plugin inspects the claimed user-sourced message before the model call. If text or attachments are present and no episode is open, it appends `errgrind/error-open` with the text, turn, origin (`direct_user` or `host_relay`), and SHA-256 attachment records. This first text and its attachment facts seed structured Error-time Evidence; an initial attachment Evidence item uses an empty quote because the image itself, rather than extracted text, is the source. When the host attachments service is mounted, original image bytes require a durable `saveFile` receipt before normalization. Upload fails if `saveFile` fails; an initial Error message without that receipt cannot open an episode. Normalized image refs carry the exact original receipt (`errgrindOriginal`), and batch validation precedes writes. Keyless Web E2E covers browser image admission, durable original receipts, cold Session reconstruction, and image reads after page reload; a separate Host restart test covers synthetic-image recovery. These tests do not exercise real model image interpretation.

The registered `errgrindEpisode` projection folds Error, Grill, and `errgrind/teach-step` events plus grounding excerpts from `user/message`. Its Host state maintains the authentic first input, attachment references, origin, description draft, confirmed revision, diagnosis history, evidence sources, and active diagnostic ledger. Its browser wire view contains only the first 300 Unicode characters of the public description, coarse stage, current Drill eligibility, and the row kind (Error or Drill) for Error history. `errgrind/error-clarify` and `errgrind/teach-step` are durable public conversation events. The `latest-probe-answer` source alias resolves to its durable `user/message` source before grounding checks. User answers after Teach starts are excluded from Error-time evidence. Unrelated events preserve the existing projection state.

The separate `errgrindDrill` projection stores a private DrillSpec and reference answer, the public question, persisted user answer references, a reviewable image-answer draft, and judged attempts. `drill_answer_draft` records the image transcription as a draft; the learner must reply `确认`/`Confirm` or `修正：`/`Revise:` followed by their complete corrected answer to complete the answer before judgment. `drill_judge` records the provider and model from the request header. A wrong result includes a derived Error snapshot with exact question, answer, reference answer, and source attempt in the same `errgrind/drill-judged` event. Inside a dedicated Drill Session — opened through the history Practice action via the deterministic `errgrind-drill-*` identity and an `errgrind/drill-open` seed — a correct verdict archives the Session once it settles, while a wrong verdict materializes the snapshot as a separate pending-Grill Session through the deterministic `errgrind-derived-*` identity and archives the practice Session once the learner leaves it. A repeated derived-Error opening reuses the materialized Session; repeated Drill openings allocate the next free deterministic index. Source lineage stays in the durable log. A `drill_prepare` call that passes its guards records one `errgrind/drill-draft-finished` settlement — success, failure, or abort — including attempts rejected before a specification persisted; the marker stays unattached in that case so the browser can render the generation-failure card.

The `error_draft` tool accepts one complete description (1–12,000 characters) and increments the draft revision. Grill also gathers the information needed to make that description accurate. `grill_conclude` stores a provisional diagnosis anchored to the current draft while Grill remains active. Confirming that exact revision with `/error-confirm <revision>` commits the diagnosis and finishes Grill together; without confirmation, clarification, probing, and revision can continue and invalidate the proposal. Teach and Drill require this joint completion. A correction after a completed diagnosis marks it stale; re-probing keeps the old ledger in `diagnosisHistory`.

During active Grill, the agent can call `error_clarify` to show one factual clarification or `grill_probe` to record a question that distinguishes candidate hypotheses; ordinary assistant messages and streams remain hidden in the Web composition. A new clarification, probe, or description revision invalidates a pending conclusion. Probe metadata carries internal predictions and variant problem answer keys. The ErrGrind Web `browserView` policy replaces private Grill events with sequence-preserving placeholders and removes assistant reasoning and tool arguments from browser history, live frames, and reconnect baselines. The durable Host log retains the full ledger. Evidence sources are derived from `user/message` events. `grill_conclude` proposes either `supported` (with a best hypothesis) or `undetermined` (with explicit remaining uncertainty), but neither becomes the completed diagnosis until the user confirms the matching Error description. A `supported` proposal requires evidence tied to an actual user response to a probe, with a quote matching the source text. This guards transcript linkage; it does not establish the causal diagnosis.

The current Web composition defaults new sessions to the read-only permission preset. It disables PTC execution, shell settings, file/session references, and `/error-status`, which can expose attachment hashes and diagnostic state. Image attachments and revision-bound `/error-confirm <revision>` remain available; the standard preset exposes eight ErrGrind model tools, including Teach, Drill, and `drill_answer_draft`.

<a id="human-commands"></a>
## Human Commands

- `/error-confirm <revision>` — Confirms the displayed Error description revision. Fails if no draft exists, the supplied revision is stale, or that revision was already confirmed.
- `/error-status` — Displays the episode origin, original input size, attachment hashes, draft confirmation status, diagnosis conclusion, and ledger counts.

<a id="session-projection"></a>
## Session projection

The session log is the durable source of truth for all episode state. `errgrindEpisode` uses state version `9` and starts at `null`; `errgrindDrill` uses version `3` and starts empty. Both reconstruct by folding committed session events. The browser receives the narrow `errgrindEpisode` wire view only when its Host `browserView` policy allows that key; the private fold state remains on the Host. Calling `currentEpisode` fails explicitly if the projection service or registered key is unavailable.

There is no `./invariant` export: the fold checks the owned event transitions, and this package owns no relation to a second service or store.

<a id="model-experience"></a>
## Model Experience

### Diagnostic tools and session conversation

#### What the model sees

The package registers no system prompt. When enabled, the model sees `error_clarify`, `error_draft`, `grill_probe`, `grill_conclude`, `teach_step`, `drill_prepare`, `drill_answer_draft`, and `drill_judge` tool schemas and descriptions. The descriptions and parameter guidance are loaded from `errgrind-fork/prompts/tools.json` at plugin startup; the ErrGrind Web system prompt is `errgrind-fork/prompts/system.md`. `drill_prepare` is rejected outside a Session whose origin is a dedicated Drill opening. `teach_step` publishes a teaching question, hint, or explanation after the current diagnosis. Drill publishes only its question and verdict; the reference answer, judgment feedback, and derived Error snapshot stay on the Host. Ordinary assistant text is hidden by the ErrGrind Web composition. Discriminative probe calls keep expected observations and answer keys inside tool arguments; the browser view keeps those arguments, assistant reasoning, and private Grill events on the Host.

#### Token effect

The tool schemas contribute tokens on requests where the host exposes them. Grill probes and evidence records append structured findings to the session log, allowing multi-turn diagnosis without duplicate context re-injection.

#### KV Cache effect

Tool descriptions and schemas are static, preserving request prefix stability while preceding context remains unchanged. Probe and conclusion events are append-only.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Browser view scope** — ErrGrind Web uses a strict event and field allowlist: the browser receives user messages, the complete Error draft and revision, confirmation, public intake clarifications and Grill questions, safe conclusion fields, and the narrow Error history view. Assistant messages, tool results, private Grill events, reasoning, tool arguments, private projection state, and original attachment references remain on the Host. Image/file reads use event-position locators that the Host resolves inside the owning Session. Other compositions must configure an equivalent `browserView` policy explicitly.
- **Web image and recovery coverage** — Keyless browser tests cover image upload, original receipts, cold Session reconstruction, and image restoration after page reload. A separate Host restart test covers recovery with a synthetic image. These checks do not exercise a real model's image interpretation.
- **Product flow and mobile acceptance** — Keyless browser replay uses scripted model outputs for a simple fraction Error and covers description revision, Grill, Teach, a dedicated Drill Session opened from Error history, a wrong verdict materializing the derived Error as a separate Session, a correct verdict archiving the Drill Session, idempotent retry, cold read, reload, and a 390px layout (2/2 targeted tests passed). Image answers now have a review-and-confirm correction path before judgment; full mobile product acceptance and live-model full-chain validation remain deferred.
- **Cache behavior needs more data** — One isolated real Codex intake run reported 11,520 `cacheReadTokens` on its second model call. This does not establish sustained hit rate or cost across the workflow.
- **No repeatable old-database import** — the old SQLite Error library was migrated once into the fork store by an out-of-repo importer; the product ships no import feature, and old sources remain read-only reference data.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`origin` records whether the first Error input reached the session directly (`direct_user`) or through a host relay (`host_relay`). Folding still reads the retired field name written by pre-rename logs; an absent or invalid value falls back to `direct_user`. The same read-compat pattern covers `probeId`: an empty string stored for untied evidence by earlier writes reads as absent, and the write boundary normalizes `''` to a missing field.

</details>
