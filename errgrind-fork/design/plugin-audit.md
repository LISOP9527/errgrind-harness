# Mounted-plugin necessity audit

2026-10-01 audit of the ErrGrind Web composition, resolved with
`dsh --profile web --patch errgrind-fork/web.patch.yml --dump-config` (entries at every
nesting level, ancestors' `disabled` propagated, `!!js` conditions evaluated for Linux +
profile `web`). Result: **105 mounted entries, 148 disabled** at audit time; after
removal groups G1–G6 landed the same day, the mounted set was **89**; directory-picker later reverted (G6), current **90**
(`session-query-sqlite` from G6 stayed — see the group list).

Columns per the todo item: **flow** = which user flow needs it; **dep** = enabled
consumers (service reads verified by grep, or a documented structural owner);
**model** = reaches a model request; **data** = writes persistent state; **sec** =
security/permission surface; **UI** = browser entry it owns. Structural consumers
(cordis Loader, gateway remotes, boot wiring) are named as such — a plain grep of
`ctx.<service>` undercounts transport-facing providers, and it also misses
**required inject lists**: `session-controller` pulls `sessionQuery` by name in
`static inject`, invisible to a call-site grep. G6's landing caught that class of
dependency live; "no consumer" claims must be re-checked against inject
declarations.

## Layer A — kernel substrate (keep all)

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| timer | cordis timer service (Scheduler infra) | cordis runtime | no | no | none | none |
| hmr | dev reload; idle in production | loader | no | no | none | none |
| config-editor | typed config read/write | agent-default-model | no | settings file | config write path | none |
| settings | settings service | settings-controller, ui-settings* | no | user settings | settings domain | Settings modal |
| storage / storage-json / storage-domain | persistent KV behind projections/workspace | session-projection-cache, workspace | no | `~/.errgrind` storage | none | none |
| subprocess | child-process exec provider | sandbox | no | no | process exec | none |

## Layer B — model plane (keep all)

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| llm | provider registry every request uses | everything | yes | no | provider keys | none |
| llm-pi-ai | Hongyun relay routes (Astra/Opus) | agent loop | yes | no | `ERRGRIND_RELAY_*` keys | Models settings |
| llm-retry | request retry policy | agent loop | yes | no | none | none |
| agent-default-model | default model resolution | session-controller | no | no | none | model pill |
| credentials | key storage for relay auth | llm-pi-ai | no | credential store | **keys** | none |
| authorization | auth grant checks | llm-pi-ai auth, settings-controller | no | auth state | **auth** | none |
| system-prompt | persona prefix/suffix slot | agent loop | yes | no | none | none |

## Layer C — session plane (keep except flagged)

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| session | sessions service | everything | no | session logs | session data | none |
| session-persistence-jsonl | session log persistence | sessions | no | **JSONL logs** | session data | none |
| session-projection | projection registry | session-controller, agent-loop | no | projections | none | none |
| session-projection-cache | projection caching | session-controller | no | cache | none | none |
| session-title / session-title-llm | sidebar titles (first-prompt titles) | session-controller | yes (title request) | titles | none | sidebar text |
| session-checkpoint-policy | resume checkpoints | sessions resume | no | checkpoints | none | none |
| session-stats / session-turn-outline | turn rail + stats projections | session-controller | no | no | none | turn rail |
| attachment-local | image originals on disk | attachments | no | **image files** | user content | none |
| image-offload | request-error recovery: offloads oldest images when a route rejects image weight | agent request-error path | no | offloaded copies | user content | none |
| session-telemetry-otel | OTLP export backend — **no `session-telemetry` coordinator is mounted, so nothing emits** | none | no | no | none | none |

## Layer D — agent loop, tools, guards

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| agent / agent-loop | the turn machinery | everything | yes | no | none | none |
| tools | tool registry; errgrind-episode registers its business tools here | host-runner inject (required), errgrind-episode | yes | no | tool exec | tool cards |
| token-meter | context metering | compaction-basic | no | no | none | none |
| compaction-basic | auto-compaction inside preset realm | agent loop | yes | no | none | none |
| spill-local / spill-policy | large tool-output spill to files | tools pipeline | yes | spill files | none | none |
| user-questions | UserQuestionService — consumers were tool-ask-user/plan-mode, both disabled | none enabled | no | no | none | none |
| goal / goal-round-driver | goal service + driver — consumers command-goal/tool-goal/ui-goal, all disabled | none enabled | no | goal state | none | none |
| jobs | JobRegistry — only enabled consumer is subagent run-settlement | subagent | no | job records | none | none |
| subagent / subagent-spawn-in-process / subagent-fork-in-process | delegation backends — every tool-subagent*/ui-subagent row is disabled | none enabled | no | no | **child sessions** | none |
| repeat-tool-reminder | tools/post-execute + agent/pre-step reminder; zero model tools mounted | inert | yes | no | none | none |
| timeout-policy | wraps tools/execute for call timeouts; zero tools mounted | inert | no | no | none | none |
| fs-observation-policy | freshness/no-clobber guards for fs tools; no fs tools mounted | inert | no | no | none | none |

## Layer E — sandbox + approval chain (keep all)

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| sandbox / bash-sandbox / fs-sandbox | sandbox providers the tools registry resolves through | sandbox-policy resolution | no | no | **sandbox** | none |
| sandbox-policy | read-only mode + workspace root | tools, fs-sandbox, bash-sandbox | no | no | **sandbox** | none |
| approval | approval prompts for privileged calls | tools, permission-presets | no | no | **approval** | none |
| permission | preset → sandbox/approval mapping; kept deliberately (owns the presets) | tools chain | no | no | **permission** | none |
| shell-env | publishes DSH_WEB_URL/MODE | web-app boot | no | no | none | none |
| fs-sandbox | fs sandbox provider | sandbox-policy | no | no | **fs** | none |

## Layer F — web tools + MCP backends (removal group)

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| web | ctx.web runtime — only reader is cordis-host-runner sandbox text guidance | none (optional access) | no | no | network fetch | none |
| web-search-deepseek | search provider — needs a DeepSeek key the product no longer has | none | yes | no | DeepSeek key | none |
| web-fetch-http | fetch provider for tool-web (disabled) | none | yes | no | network fetch | none |
| mcp-resources | MCP resource reads; no mcp-client mounted | none | no | no | MCP data | none |

## Layer G — skills + commands

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| skill | skill registry (skill-filesystem disabled → empty catalog) | session-controller skill-catalog | yes | no | none | none |
| commands | command registry behind `/`/`+` menus | ui-commands | no | no | none | command menu |
| command-feedback | `/feedback` + session feedback remote | command menu | no | feedback notes | none | `/feedback` |

## Layer H — DeepSeek-only plumbing (removed in G1)

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| deepseek-llm-api-extensions | extension registry for DeepSeek requests | session-log-deepseek, plugin-pkg-inventory | yes | no | none | none |
| session-log-deepseek | `dsh_session_log` extension: writes session-log metadata into DeepSeek requests | registers onto deepseek-llm-api-extensions | yes | no | none | none |
| plugin-package-inventory-deepseek | active-package inventory for official DeepSeek requests | registers onto deepseek-llm-api-extensions | yes | no | none | none |

Closed cluster: every consumer is inside the cluster or already-disabled (`llm-deepseek`).
ErrGrind requests route through `llm-pi-ai` → Hongyun relay; none of this executes.
**Removed 2026-10-01 (`f3d4a92`).**

## Layer I — host/web transport (keep except flagged)

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| typert / typert-loader / typert-gateway / api-remotes | Remote RPC spine | everything client-side | no | no | transport | none |
| session-controller | session remote (commands, cold reads, control stream) | client shell | no | no | session ops | every screen |
| settings-controller | settings/credentials remotes | Settings modal | no | settings | credentials | Settings |
| workspace-controller | workspace remotes + directoryPickerController | session/workspace ops | no | no | none | none |
| workspace | workspace entities; sessions are workspace-scoped | session-controller | no | workspaces | none | none |
| cordis-host-runner | JS plugin sandbox host (inject: tools) | tools | no | no | **runs JS** | none |
| cordis-client-runner | browser-side cordis/inspect remotes | client shell | no | no | none | none |
| web-startup / webserver / web-runtime | bind, serve, print URL, open | boot | no | no | bind surface | none |
| client-hmr / modules | client bundle scan + reload | client boot | no | no | none | none |
| connection | transport + productLabel + auth page | client shell | no | no | auth | login page |
| file-upload | browser upload transport | composer | no | uploads | user content | attach |
| agent-preset-registry / preset-standard | per-session realm (persona + compaction) | session-controller | yes | no | none | none |
| session-query-sqlite | full-text index — `openAt: never`, dormant by config | **session-controller required inject** (list/observe/search) | no | `:memory:` index | none | none |
| directory-picker | resolves native|browse backend for workspace picking; ErrGrind renders no workspace-create UI | none enabled | no | no | none | none |

## Layer J — client shell (keep except flagged)

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| cordis-client-runner, ui-theme, locale, ui-layout, ui-renderer, ui-session, resources, ui-sidebar | shell kernel + theme/locale/layout/slots/sidebar | browser boot | no | no | none | shell |
| ui-conversation / ui-chat | conversation surface + session header + turn rendering | browser | no | no | none | main screen |
| ui-settings / ui-settings-general / ui-settings-models | settings modal (rows trimmed by config) | settings | no | no | none | Settings |
| ui-sidebar-right | dock services ui-chat requires; expandButton off | ui-chat | no | no | none | none (gated) |
| ui-attachment | attachment rendering | messages | no | no | user content | image cards |
| ui-tool | tool-call cards (errgrind tools render here) | turns | no | no | none | tool cards |
| ui-input-trigger / ui-commands | `/` and `+` input pipeline | composer | no | no | none | menus |
| ui-model-selection | model pill + picker | composer | no | model choice | none | model pill |
| ui-workspace | workspace tree/picker + hero seats — **all outputs CSS-hidden (inventory #19); `uiWorkspace` read only by `ui-conversation` via `ctx.get` (workspace-switch + session-open callbacks)** | ui-conversation (optional read, unguarded) | no | no | none | hidden DOM |

## Layer K — ErrGrind product (keep)

| id | flow | dep | model | data | sec | UI |
|----|------|-----|-------|------|-----|----|
| errgrind-episode | business core: error draft/confirm, ledger, drill | turns | yes | **episode state** | business data | none |
| ui-errgrind-episode | Error cards, history, brand, onboarding | browser | no | no | none | sidebar + cards |

## Removal candidates, grouped by dependency closure

Ordered for "one group per landing, targeted regression after each" per the todo.

- **G1 — DeepSeek request plumbing** (`deepseek-llm-api-extensions`, `session-log-deepseek`, `plugin-package-inventory-deepseek`): closed cluster, zero ErrGrind-path usage. **LANDED** (`f3d4a92`): launch + real Astra turn passed.
- **G2 — Delegation and jobs** (`subagent`, `subagent-spawn-in-process`, `subagent-fork-in-process`, `jobs`): no enabled consumer; every delegation tool and UI row already disabled. **LANDED** (`ff36891`): launch, cold-read, resume, and a 35s Opus turn that advanced the episode ledger passed.
- **G3 — Goals and user questions** (`goal`, `goal-round-driver`, `user-questions`): no enabled consumer. **LANDED** (`1dd82bb`): launch + real turn passed.
- **G4 — Model web backends** (`web`, `web-search-deepseek`, `web-fetch-http`, `mcp-resources`): tool-web already off; runner reads ctx.web only as optional sandbox guidance. **LANDED** (`5e450a6`): launch + real turn passed.
- **G5 — OTel backend** (`session-telemetry-otel`): no telemetry coordinator mounted; its default exporter pointed at harness-telemetry.deepseeksvc.com. **LANDED** (`5e450a6`, same commit as G4): launch + real turn passed.
- **G6 — Dormant services** (`session-query-sqlite`, `directory-picker`): split at landing — `session-controller` declares `sessionQuery` in its **required inject list** (`listSessions`/`observeSession`), so disabling `session-query-sqlite` leaves the whole session plane PENDING (verified live: launch warned "session-controller … waiting for service: sessionQuery"; workspace entry and last-session restore both dead). `session-query-sqlite` therefore **stays mounted**; removing it means first making that inject optional — shared-package surgery deferred to a later pass. `directory-picker` **REVERTED** (stays mounted): the audit missed that the picker is the recovery surface — when default-Workspace init fails, the `defaultWorkspaceFailed` toast sends the user to 'Choose workspace', and `remote.directoryPicker` picks this plugin by name (`packages/client/ui-workspace/src/client/navigation.ts:145`). With it disabled the picker gesture opens an empty menu, dead-ending the only recovery path. Found during todo-39 settings acceptance (2026-10-01).
- **G7 — Guard policies for absent tools** (`repeat-tool-reminder`, `timeout-policy`, `fs-observation-policy`): registered against zero executable tools. Cheapest to keep; revisit only if the loop surface shrinks further.
- **G8 — ui-workspace** (`ui-workspace`): **KEPT — hard dependency, functional**. `ui-conversation/src/client/apply.ts` calls `uiWorkspace.openSession` / `openWorkspace` for the session-header lineage crumb and the workspace picker; `openSession` is exercised by ErrGrind's own derived-session lineage ("Investigate this new Error" children), and the service carries supersession/creation/notice logic that would have to be re-implemented in ui-conversation. All its user-visible output is already CSS-hidden (inventory #19), so removal buys nothing a user can see — the navigation brain stays.

Deliberately kept despite zero executable tools: the whole **Layer E sandbox chain**
(tools injects approval+sandboxPolicy unconditionally — removal is surgery on the tools
contract, not a plugin delete) and **spill**/**image-offload** (loop recovery plumbing
that fires only on real conditions).
