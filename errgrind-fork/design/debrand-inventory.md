# DSH branding inventory

2026-10-01 real-UI audit, screen by screen (desktop + ~320px mobile). Screenshots live on the VM at `~/errgrind-evidence/debrand/` (01–14, not committed); full sweep recording `~/screencasts/rec-4e264b19-…`. Inventory only — nothing changed. Each finding names its removal path.

Verdict labels: **[config]** = locale dictionary or `web.patch.yml` field; **[disable-plugin]** = disable a plugin or command registration source; **[UI change]** = component code edit; **[architectural]** = requires renaming monorepo packages.

Already done, not repeated: title/manifest = ErrGrind (`errgrind-manifest.webmanifest`); `brand.localBuild` overridden to ErrGrind by `ui-errgrind-episode`; `welcomeNotice`/`credentialOnboarding` off (the old "Internal Testing Notice" carried DeepSeek Harness copy); model picker shows only the two Hongyun routes (`hideModelsWithoutCredential`).

## Severe: brand or internals leak

| # | Surface | Verbatim | Code location | Path |
|---|---------|----------|---------------|------|
| 1 | Settings → Models provider list | "openai-codex", "DeepSeek" rows (red dot, no credential) | `packages/client/ui-settings-models/src/client/ModelsSection.tsx` + `ModelRow.tsx`; rows come from `llm-pi-ai` (openai-codex) and `llm-deepseek` route declarations | [UI change] or [config]: hide credential-less provider rows behind a product flag, or drop the declarations from the patch |
| 2 | Settings → Models bottom | "Codex sign-in … Sign in with ChatGPT" OAuth block | **`packages/client/ui-errgrind-episode/src/client/CodexAuthSettings.tsx`** (our own package renders it, registered at index.ts:534) | [UI change]: remove the block from the ErrGrind product |
| 3 | Tokenless 401 page | `dsh web authentication required; reopen the URL printed by dsh web.` | `packages/client/connection/src/browser-auth.ts:309` | [UI change]: product-name the host response |
| 4 | Failed turn card | ~~Renders `INVALID_CONFIG`/`INVALID_REQUEST`/`PI_AI_ERROR` badges + provider/model/compat names + HTTP body~~ **DONE (batch 2)** | turn failure display in `ui-chat`/`ui-conversation` (`TurnProcessNodeView.tsx` area); text comes from step/end reason | [UI change]: map to friendly copy, details stay in logs — done via `message.failure.*` locale keys + `failureMessage()` in `MessageItem.tsx` |

## Medium: coding-agent mental model

| # | Surface | Verbatim | Code location | Path |
|---|---------|----------|---------------|------|
| 5 | "+" / "/" command menu | **Permission** (sandbox+approval exposed) | command registered at `packages/interaction/permission-presets/src/index.ts:248`; `ui-permission` is already disabled but the command remains | [disable-plugin]: disable `permission`/`permission-presets`, or filter command registration |
| 6 | Same menu | **Compact** | `packages/compaction/command-compact/src/index.ts:101` (compaction group inside preset-standard) | [disable-plugin]: drop only `command-compact`, keep `compaction-basic` auto-compaction |
| 7 | Command menu + session header "..." | **Export** / "Download session log" | `packages/session-query/session-log-export/src/index.ts:79` | [disable-plugin]: disable `session-log-export` |
| 8 | Composer | Picking a command inserts bare `/permission <preset>`, `/feedback <text>`, `/error-confirm` templates | command → composer template injection (commands UI layer); args never reach execution — known gap | [UI change]: execute directly or prompt for args |
| 9 | Session header breadcrumb + sidebar | ~~"Default workspace" as session title~~ **DONE (batch 2)** | `session-controller/client/sessions/service.ts:119` `workspaceTitleOf(cwd)` fallback when no title projection | [UI change]: `ui-workspace` `defaultWorkspace.title` locale now 'ErrGrind' — new workspaces get ErrGrind dir+title; pre-existing persisted titles still read "Default workspace" |
| 10 | Sidebar Error history bottom | ~~"These older sessions have not been classified yet…"~~ **DONE (batch 2)** | `ui-errgrind-episode` locales `history.unclassified` | [UI change]: reworded to "Sessions not yet linked to an Error:" |
| 11 | Under each turn | "Worked" / "Took 39s" / "Failed" chips | `ui-chat/src/client/locale.ts` `message.turnProcess.*` + `TurnProcessNodeView.tsx` | [config] copy; [UI change] hide chips entirely |
| 12 | Settings → General | ~~"Send behavior while busy — while the agent is running"~~ **DONE (batch 2)** | `ui-settings-general` | [config/UI change]: hidden via `hiddenSettingsItems` (id `composer-enter`) |
| 13 | Settings → General | ~~Developer tools, Open configuration file, Performance & usage, footer "Current version: 0.1.7-alpha.2"~~ **DONE (batch 2)** — "turns and steps" copy stays (it describes ErrGrind's turn expansion) | `ui-settings-general` + `ui-settings/src/client/developer-tools.ts` | [disable-plugin/UI change]: hidden via `hiddenSettingsItems` (ids `developer-tools`, `current-version`, `performance-usage`, `open-document`) |
| 14 | Top-right "Open right sidebar" | ~~Generic dock workbench: "Start" tab, Split, Fullscreen~~ **DONE (batch 2 + remainder)** — plugin stays (ui-chat requires its services); header-corner expand button gated off via `expandButton` config, and the `link-opening` Settings row is hidden so no fresh install can persist `linkOpening:'sidebar'` | `packages/client/ui-sidebar-right` | [disable-plugin]: leak closed — row hidden via `hiddenSettingsItems`; only a pre-existing persisted 'sidebar' pref could still open the dock (none exist on fresh installs) |
| 15 | Composer model pill → Effort | ~~8-rung ladder Default/Off/…/Max~~ **DONE (batch 2)** | route `reasoningEfforts` (astra offers all) | [config]: astra narrowed to low/medium/high in `web.patch.yml`; opus stays xhigh/max (model-forced) |

## Light / wording unification

| # | Surface | Verbatim | Code location |
|---|---------|----------|---------------|
| 16 | Session right rail | ~~`aria-label="Jump to turn N"`~~ **DONE (remainder)** — 'Turn navigation'/'Jump to turn N' → 'Message navigation'/'Jump to message N'; zh 轮次 → 条消息 | `ui-chat` locale `chat.turnNavigation.*` |
| 17 | "+" menu | ~~"for this conversation" / "this session"~~ **DONE (remainder)** — model command → 'this Error'/本条 Error; feedback → 'this Error'/本条 Error; bonus: `error.sessionInUse` DSH mention replaced with ErrGrind | `ui-model-selection` and `ui-commands` locale descriptions |
| 18 | Error card footer | ~~"…in the conversation"~~ **DONE (remainder)** — 'in the conversation' → 'in this Error' (en ×4), 在对话中 → 在本条 Error 中 (zh ×3) | `ui-errgrind-episode` locales (ours) |
| 19 | Hidden DOM | `data-hero-workspace-picker`, workspaces section, `crumbSubagent` styles still emitted | `ui-workspace` — **RESOLVED: plugin stays functional** (G8 kept it: `openSession`/`openWorkspace` power the lineage crumb and workspace picker); hidden DOM remains CSS-suppressed by design |
| 20 | view-source | bundle URLs `plugins/@deepseek-ai/dsh-*`, `__DSH_BOOT_READY__`, `--dsh-*` CSS vars | build artifact naming — **DEFERRED: architectural**; renaming bundle paths/CSS vars/boot flag touches build tooling and cache/debug conventions for no user-visible gain |

## Verified clean surfaces

- First-run hero: "EG" + "Start with a math mistake", no DSH; composer has no placeholder hint
- Sidebar bottom shows only the Settings gear; no version/build label leaks (version lives inside Settings, see #13)
- Model picker lists only the Astra/Opus relay routes
- "/" and "+" menus identical; no terminal/files/workspace/jobs/subagent command leaks
- No in-app right-click menu, no shortcut-help page
- Mobile ~320px: rail collapses correctly; same leftovers as desktop (Default workspace title, menus, right pane goes fullscreen)

## Suggested minimal fix set (for scheduling)

1. ~~Settings → Models tab: drop openai-codex/DeepSeek provider rows, the Codex sign-in block, and "+ Add model provider"~~ **DONE (batch 1)** — codex route + `llm-deepseek` disabled in `web.patch.yml`; `CodexAuthSettings` removed; new `providerAddition` bootstrap flag hides the add card. The Host side was cleaned up later: `CodexAuthController` and its `errgrindCodexAuth` Remote namespace deleted from `dsh-api-settings-controller` (inert since the route removal) along with `CodexAuthStatus`/`CodexAuthNotice` types, its spec, the live-codex e2e, and the credentials.md section
2. ~~Command surface: drop Compact/Permission/Export (reassess Feedback/Model); no bare `/cmd` template insertion~~ **DONE (batch 1)** — `/compact` removed with `command-compact`, `/export` gone with `session-log-download` disabled, `/permission` hidden via new `CommandRuntime.hiddenCommands` (plugin stays for sandbox presets); Feedback/Model kept — generic, not DSH. Later hardened: `hiddenCommands` filters `list` only, so the wider `workspace-write`/`danger-full-access` presets were removed from `web.patch.yml` too — `read-only` is the only configured preset and `/permission` typed manually submits as chat
3. ~~Failed turn card: friendly copy mapping — hide provider/model/compat/HTTP body~~ **DONE (batch 2)** — `message.failure.*` locale keys (zh+en) + `failureMessage()` switch in `MessageItem.tsx`; live AUTH failure verified shows "This turn failed — API key is invalid". Later refined: the raw diagnostic was entirely invisible, so the card regained the `code` badge plus an 'Error details' disclosure carrying `node.message` (credential-stripped for AUTH at `displayFailure`), and the retry details row shows the raw failure message again
4. ~~"Default workspace": session-title fallback + unclassified-section wording~~ **DONE (batch 2)** — `defaultWorkspace.title` → 'ErrGrind'; `history.unclassified` → 'Sessions not yet linked to an Error:'; pre-existing persisted session titles keep the old text
5. ~~Disable `ui-sidebar-right` + hide agent-specific Settings rows~~ **DONE (batch 2)** — `expandButton: false` gates the header-corner button; new `hiddenSettingsItems` config + `RenderOpts.except` hide `developer-tools`, `current-version`, `composer-enter`, `performance-usage`, `open-document`; remainder adds `link-opening`; effort ladder narrowed (item 15) in the same batch
6. ~~401 copy without "dsh web"~~ **DONE (batch 1)** — `connection.productLabel` config; page reads "ErrGrind authentication required"
