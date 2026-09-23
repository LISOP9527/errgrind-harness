---
description: "The session-backed first Error input and reviewed description draft for compositions adding an explicit human confirmation step."
kind: "package-reference"
---

# @errgrind/episode

English | [中文](README.zh.md)

## Summary

`@errgrind/episode` records the first user-sourced input in a session projection, lets the agent save a complete Error description with `error_draft`, and accepts the current draft revision only through the user command `/error-confirm`. Drafts remain model-authored until that explicit confirmation; each replacement clears the prior confirmation. This package supplies an intake and confirmation boundary, not the complete ErrGrind workflow.

## Event flow

On an entered agent step, the plugin examines the claimed user-sourced message before the model call. If its text or image content is non-empty and no episode is open, it appends `errgrind/error-open` with the text, an image-presence flag, and the turn number. The event stores no image bytes.

The registered `errgrindEpisode` projection folds only `errgrind/error-open`, `errgrind/error-draft`, and `errgrind/error-confirm`. It exposes the first input, whether that input included an image, its turn, the latest draft revision and text, and the confirmed revision. Unrelated events preserve the existing projection state.

The `error_draft` tool accepts one complete description, trims it, enforces a 1–12,000 character limit, increments the draft revision, and appends `errgrind/error-draft`. A new draft replaces the previous one and clears `confirmedRevision`. Its tool contract tells the agent to distinguish the user's account from its interpretation and ask the user to review the description; the tool itself cannot confirm it.

After reviewing the draft, the user runs `/error-confirm` with no arguments. The command records the current revision and the correlation ID of the matching user-issued `command/run` event in `errgrind/error-confirm`. Repeating confirmation of the current revision returns success without appending a second confirmation event. Stale revisions and invalid event transitions fail.

## Session projection

The session log is the durable source for this package's state. The projection uses state version `1`, starts at `null`, and is reconstructed by folding committed session events; `currentEpisode` fails explicitly if the projection service or registered key is unavailable.

There is no `./invariant` export: the fold checks the owned event transitions, and this package owns no relation to a second service or store.

## Model Experience

### Draft tool and session conversation

#### What the model sees

The package registers no system prompt. When enabled, the model can see the `error_draft` tool schema and description, plus its call and result in the ordinary session conversation. The tool accepts one required `description` string and returns the saved revision and description.

#### Token effect

The tool schema contributes tokens on requests where the host exposes this tool. Calls and rendered results add conversation content when used; the package stores the first input as a domain event without adding a second copy to model context.

#### KV Cache effect

The package-owned tool description and schema are static, so they preserve a reusable request prefix while composition and preceding context remain unchanged. A tool call and result append conversation content; replacing a draft does not rewrite earlier session events. Provider cache availability and eviction are outside this package's contract.

## Known Limitations and Deferred Work

- **No complete Error workflow** — the package does not implement Record editing, Grill, Teach, Drill, UI, or MCP behavior; consumers must provide those capabilities.
- **Image input is only noted** — the opening event keeps an image-presence flag but does not persist or expose raw image data.
- **Confirmation is revision scoped** — confirmation proves that a user command accepted the current description revision; it does not validate the description's factual accuracy or complete another workflow stage.
- **Adapter provenance is not yet represented** — a user-sourced DSH message can also arrive through a forwarding host. A future MCP adapter must record that origin before its text is treated as direct user evidence.
