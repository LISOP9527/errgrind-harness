---
description: "Conversation cards for the reviewed Error description and public Grill progress."
kind: "package-reference"
---

# @errgrind/ui-errgrind-episode

English | [中文](README.zh.md)

## Summary

`@errgrind/ui-errgrind-episode` shows an Error history in the sidebar and renders public Error, Grill, Teach, and Drill content in the conversation. Learners can reopen, rename, archive, or restore an Error and request a Drill from a completed one. Model-authored content (Teach steps, verdicts, questions, conclusions) renders as ordinary assistant Markdown; prompts awaiting input keep a light frame. The Error card shows the description, confirmation status, safe probe progress, and conclusion; confirmation calls `/error-confirm <revision>`. A model-onboarding card in the composer dock appears while a blank Error has no selectable provider.

## Table of Contents

- [Composition](#composition)
- [Privacy boundary](#privacy-boundary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="composition"></a>
## Composition

The package is a browser-only plugin. A Web profile mounts `@errgrind/ui-errgrind-episode`; its Client entry registers Conversation event Definitions, localized Chat nodes, the confirmation button, an Error history panel in `sidebar.workspaces`, ErrGrind brand marks, and a model-onboarding card in `conversation.input.dock` shown while a blank Error has no selectable provider. The history panel shadows the generic Workspace browser without removing its navigation service. It depends on the Session Controller, Locale, Conversation, Chat, Sidebar, Workspace, and Models settings client packages. The entry also registers Chinese and English overrides for the three general Conversation composer labels, scoped to profiles that mount this ErrGrind plugin. Every registered Chat node carries a `TurnActivity` id in its data (`kind` → activity via `KIND_TURN_ACTIVITY`), so the shared Turn tail names what the Turn produced — recorded, asked, clarified, explained, practice, drafted, or scored.

<a id="privacy-boundary"></a>
## Privacy boundary

The Client assembles cards from public Session events. History reads only the narrow `errgrindEpisode` wire view containing a bounded public description excerpt, stage, and Drill eligibility; the private Host fold remains inaccessible. Sessions with no cached classification remain openable for reconstruction. The Host must configure `session-controller.browserView` to allow only approved projection keys and event fields, keeping private events, assistant streams, tool arguments, and attachment storage references out of browser responses. Image and file thumbnails use Session event-position locators resolved by the Host.

## Model Experience

None, as the package renders Session state and queues only the user's own revision confirmation and Drill requests; the Host plugins own every model-facing event.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Confirmation follows the visible card state** — The Host rejects a stale revision number; the user must review the updated card before confirming again.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
